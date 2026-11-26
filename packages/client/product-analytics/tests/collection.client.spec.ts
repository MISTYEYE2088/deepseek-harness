import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import * as Analytics from '../src/client/index.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.unstubAllGlobals()
})

async function setup() {
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  const report = vi.fn().mockResolvedValue({ ok: true, value: undefined })
  const watchPolicy = vi.fn()
  const $stream = vi.fn()
  class TracedRemote extends Service {
    constructor(ctx: Context) { super(ctx, 'remote') }
    $stream = $stream
  }
  await ctx.plugin(TracedRemote)
  await ctx.plugin({ apply(child: Context) { child.provide('remote.productAnalytics', { report, watchPolicy } as never) } })
  await ctx.plugin(Analytics)
  return { ctx, report, watchPolicy, $stream }
}

it('stays hard-disabled in both Web and Desktop shells without opening policy streams or sending RPCs', async () => {
  const web = await setup()
  expect(web.ctx.productAnalytics.enabled).toBe(false)
  web.ctx.productAnalytics.track('desktop_app_launch', {})
  expect(web.report).not.toHaveBeenCalled()
  expect(web.$stream).not.toHaveBeenCalled()

  vi.stubGlobal('dshDesktop', {})
  const desktop = await setup()
  expect(desktop.ctx.productAnalytics.enabled).toBe(false)
  desktop.ctx.productAnalytics.track('auth_page_click', { button_name: 'sign_in' })
  desktop.ctx.productAnalytics.track('sidebar_menu_click', { menu_name: 'plugin' })
  expect(desktop.report).not.toHaveBeenCalled()
  expect(desktop.watchPolicy).not.toHaveBeenCalled()
  expect(desktop.$stream).not.toHaveBeenCalled()
})
