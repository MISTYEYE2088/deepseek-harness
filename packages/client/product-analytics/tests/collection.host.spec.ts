import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import type { ProductTelemetryRecord } from '@deepseek-ai/dsh-host-product-telemetry-otel'
import { Session, type SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CompactionId } from '@deepseek-ai/dsh-compaction/types'
import Analytics from '../src/index.ts'
import { collectEnvironment } from '../src/environment.ts'

vi.mock('../src/environment.ts', () => ({ collectEnvironment: vi.fn() }))

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.resetAllMocks()
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function setup(enabled?: boolean) {
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  const getDeviceIdentity = vi.fn().mockResolvedValue({ deviceId: 'login-device', userId: 'user-1' })
  const emit = vi.fn<(record: ProductTelemetryRecord) => void>()
  ctx.provide('deepseekAccount', { getDeviceIdentity } as never)
  ctx.provide('webServer', {} as never)
  ctx.provide('productTelemetry', { emit } as never)
  const fiber = await ctx.plugin(Analytics, enabled === undefined ? { appVersion: 'test-version' } : { enabled, appVersion: 'test-version' })
  return { ctx, fiber, getDeviceIdentity, emit }
}

it('defaults enabled to false and stays hard-disabled even when enabled: true is passed', async () => {
  expect(Analytics.Config({}).enabled.get()).toBe(false)

  for (const configured of [undefined, false, true]) {
    const b = await setup(configured)
    expect(b.ctx.productAnalytics.enabled()).toBe(false)
    await b.ctx.productAnalytics.report({ eventName: 'desktop_app_launch', timestamp: 100, attributes: {} })
    const session = Session.create(brandString<SessionId>('analytics-compaction'))
    b.ctx.emit('session/event', session, {
      type: 'compaction/start',
      seq: SessionSeq(0),
      time: 1,
      data: { compactionId: brandString<CompactionId>('analytics-compaction'), turn: null },
    })
    expect(collectEnvironment).not.toHaveBeenCalled()
    expect(b.getDeviceIdentity).not.toHaveBeenCalled()
    expect(b.emit).not.toHaveBeenCalled()
  }
})

it('streams false policy and wakes pending readers on disposal', async () => {
  const b = await setup(true)
  const dispose = vi.fn()
  const configure = vi.fn(() => dispose)
  b.ctx.provide('settings', { configure } as never)
  await vi.waitFor(() => { expect(configure).toHaveBeenCalledWith({ auto: false }, b.fiber) })
  const iterator = b.ctx.productAnalytics.watchPolicy(new AbortController().signal)[Symbol.asyncIterator]()
  expect(await iterator.next()).toEqual({ value: false, done: false })
  const pending = iterator.next()
  await b.fiber.dispose()
  expect(await pending).toEqual({ done: true, value: undefined })
  expect(dispose).toHaveBeenCalledOnce()
})
