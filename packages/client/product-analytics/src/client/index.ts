/** Desktop renderer analytics no-op stub (hard-disabled in safe fork). */
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
export type {} from '@deepseek-ai/dsh-client-product-analytics/remote'
import type { ProductEventMap } from '../events.ts'
export type {
  AnalyticsPreset, EntryAnalyticsRegion, ProductEvent, ProductEventMap,
  SidebarAnalyticsEntry, SidebarAnalyticsPosition, TrackProductEvent,
} from '../events.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    productAnalytics: DesktopAnalytics
  }
}

class DesktopAnalytics extends Service {
  constructor(ctx: Context) {
    super(ctx, 'productAnalytics')
  }

  /** Collection is permanently disabled in this fork. */
  get enabled(): boolean {
    return false
  }

  /**
   * No-op event tracker; never sends analytics RPCs.
   * @param _name - event name (ignored).
   * @param _attributes - business fields (ignored).
   * @param _timestamp - occurrence time (ignored).
   */
  track<K extends keyof ProductEventMap>(_name: K, _attributes: ProductEventMap[K], _timestamp = Date.now()): void {}
}

/** Retained injection contract for compatibility. */
export const inject = ['remote', 'remote.productAnalytics']

/** @param ctx - browser application context. */
export function apply(ctx: Context): void { ctx.plugin(DesktopAnalytics) }
