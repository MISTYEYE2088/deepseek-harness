import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { PluginPackages } from '@deepseek-ai/dsh-app-boot'
import DeepSeekLlmApiExtensionRegistry from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import * as PluginInventory from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []
const SIGNAL = new AbortController().signal

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function packagePlugin(
  root: string,
  dir: string,
  manifest: object,
  source = 'export default () => {}\n',
): Promise<string> {
  const packageDir = join(root, dir)
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify({ type: 'module', ...manifest })}\n`)
  await writeFile(join(packageDir, 'plugin.mjs'), source)
  return `./${dir}/plugin.mjs`
}

async function harness(
  enabled?: boolean, packageService = false,
): Promise<{ ctx: Context; root: string; disposeInventory: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-packages-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(join(root, 'cordis.yml')).href
  await ctx.plugin(Loader)
  if (packageService) await ctx.plugin(PluginPackages)
  ctx.loader.builtins.include = Include
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentPresets, { default: 'fixture' })
  await ctx.plugin(DeepSeekLlmApiExtensionRegistry)
  const inventory = enabled === undefined
    ? ctx.plugin(PluginInventory)
    : ctx.plugin(PluginInventory, { enabled })
  await inventory
  return { ctx, root, disposeInventory: () => inventory.dispose() }
}

describe('DeepSeek plugin package inventory (hard-disabled in safe fork)', () => {
  it('defaults enabled to false and never contributes dsh_plugin_packages even when enabled: true', async () => {
    expect(PluginInventory.Config({}).enabled).toBe(false)

    const defaultHarness = await harness()
    const plugin = await packagePlugin(defaultHarness.root, 'one', { name: 'one', version: '1.0.0' })
    await defaultHarness.ctx.loader.create({ name: plugin })
    const defaultFields = await defaultHarness.ctx.deepseekLlmApiExtensions.prepare({
      body: { messages: [] }, signal: SIGNAL,
    })
    expect(defaultFields.fields).not.toHaveProperty('dsh_plugin_packages')

    const forcedHarness = await harness(true, true)
    const forcedPlugin = await packagePlugin(forcedHarness.root, 'two', { name: 'two', version: '2.0.0' })
    await forcedHarness.ctx.loader.create({ name: forcedPlugin })
    const forcedFields = await forcedHarness.ctx.deepseekLlmApiExtensions.prepare({
      body: { messages: [] }, signal: SIGNAL,
    })
    expect(forcedFields.fields).not.toHaveProperty('dsh_plugin_packages')
  })
})
