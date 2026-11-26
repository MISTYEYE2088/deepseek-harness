import OTel from '@deepseek-ai/dsh-otel'
/** Defense-in-depth verification: Desktop product analytics & telemetry are unmounted AND hard-disabled. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as Telemetry from '@deepseek-ai/dsh-host-product-telemetry-otel'
import Analytics from '@deepseek-ai/dsh-client-product-analytics'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs() })

it.each(['desktop', 'web'])('unmounts product telemetry & analytics in %s and hard-blocks export even if force-enabled', async (profile) => {
  let requestCount = 0
  const server = createServer((req, res) => {
    requestCount++
    req.resume()
    req.once('end', () => { res.end('{}') })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing collector address')
  vi.stubEnv('DSH_CLIENT_VERSION', 'test-version')
  vi.stubEnv('DSH_PRODUCT_ANALYTICS_OTLP_URL', `http://127.0.0.1:${address.port}/logs`)
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('profileContext', {
    name: profile, dir: '/profile', patchPath: '/profile/cordis.patch.yml', installAnchor: '/profile/package.json',
    cwd: '/workspace', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  })
  const identity = vi.fn().mockResolvedValue(undefined)
  ctx.provide('deepseekAccount', { getDeviceIdentity: identity } as never)
  await ctx.plugin(OTel)
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.telemetry = Telemetry
  ctx.loader.builtins.analytics = Analytics
  const allRows = loadOverlayPatches('analytics', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? [])
  expect(allRows.find(row => row.id === 'ui-settings-session-log')?.disabled).toBe(true)
  const rows = allRows.filter(row => row.id === 'desktop-product-telemetry' || row.id === 'product-analytics')
  const entries = rows.map(row => ({ ...row, name: row.id === 'desktop-product-telemetry' ? 'cordis:telemetry' : 'cordis:analytics' }))
  await ctx.loader.root.update(entries)
  await ctx.loader.await()
  expect(ctx.loader.resolve('desktop-product-telemetry').disabled).toBe(true)
  expect(ctx.loader.resolve('product-analytics').disabled).toBe(true)
  expect(ctx.get('productTelemetry')).toBeUndefined()
  expect(ctx.get('productAnalytics')).toBeUndefined()

  // Force-enable both rows as if a pre-existing user cordis.patch.yml overrode disabled: false and enabled: true.
  await ctx.loader.root.update(entries.map(row => ({
    ...row,
    disabled: false,
    config: row.id === 'desktop-product-telemetry'
      ? { ...(row.config as Record<string, unknown>), endpoint: `http://127.0.0.1:${address.port}/logs` }
      : { ...(row.config as Record<string, unknown>), enabled: true },
  })))
  await ctx.loader.await()
  expect(ctx.productAnalytics.enabled()).toBe(false)
  await ctx.productAnalytics.report({ eventName: 'desktop_app_launch', timestamp: 1, attributes: {} })
  ctx.productTelemetry.emit({ eventName: 'desktop_upgrade_install_restart_click', body: 'upgrade', timestamp: Date.now() })
  expect(identity).not.toHaveBeenCalled()
  await ctx.fiber.dispose()
  expect(requestCount).toBe(0)
})
