/** Desktop-only analytics RPC stub (hard-disabled in safe fork). */
import { type Context, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-host-product-telemetry-otel'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction/types'
import type { ProductEvent } from './events.ts'

/** Application-owned collection policy; hard-disabled in this fork. */
export interface Config {
  /** Live application collection policy; defaults to `false` and is hard-disabled. */
  enabled: Volatile<boolean>
  /** Running Desktop release, absent when unavailable. */
  appVersion?: string
  /** Maximum execution time per static environment query, in milliseconds. */
  environmentQueryTimeoutMillis: number
  /** Maximum captured bytes per environment query output stream. */
  environmentQueryMaxOutputBytes: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    productAnalytics: ProductAnalytics
  }
}

/** Inert analytics intake: always disabled, never queries device/OS identity, never emits telemetry. */
export default class ProductAnalytics extends TypertRemoteService {
  static inject = ['deepseekAccount', 'productTelemetry']
  static Config = z.object({
    enabled: z.boolean().default(false).volatile(), appVersion: z.string(),
    environmentQueryTimeoutMillis: z.number().step(1).min(1).max(2_147_483_647).default(5000),
    environmentQueryMaxOutputBytes: z.number().step(1).min(1).max(2_147_483_647).default(16384),
  })
  private active = true
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context, _config: Config) {
    super(ctx, 'productAnalytics')
    ctx.effect(() => () => {
      this.active = false
      for (const listener of this.listeners) listener()
    })
    ctx.on('loader/volatile-update', () => { for (const listener of this.listeners) listener() })
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  }

  /**
   * Read the collection policy (always `false` in this safe fork).
   * @returns `false`.
   */
  @Remote
  enabled(): boolean { return false }

  /**
   * Stream the effective policy (`false`) until cancellation or service disposal.
   * @param signal - subscriber lifetime.
   * @returns `false` until cancelled or disposed.
   */
  @Remote({ mode: 'stream' })
  async *watchPolicy(signal: AbortSignal): AsyncIterable<boolean> {
    let update = Promise.withResolvers<void>()
    const changed = (): void => { update.resolve() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (this.active && !signal.aborted) {
        yield false
        await update.promise
        update = Promise.withResolvers<void>()
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }

  /**
   * Drop Desktop product analytics events unconditionally without querying environment or account identity.
   * @param _event - typed product event (dropped).
   * @returns resolved promise.
   */
  @Remote
  report(_event: ProductEvent): Promise<void> {
    return Promise.resolve()
  }
}
