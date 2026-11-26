/**
 * OpenTelemetry Service Provider for the DeepSeek Harness telemetry capability.
 *
 * Defense-in-depth fork build: defaults to `DISABLED` and hard-blocks all OTLP
 * session-log capture and network export even if a user profile overrides `mode`
 * to `FEEDBACK_ONLY` or submits message/session feedback.
 *
 * @module @deepseek-ai/dsh-session-telemetry-otel
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-command-feedback'
import type {} from '@deepseek-ai/dsh-message-feedback'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  SessionTelemetryBackend,
  type SessionTelemetryRecord,
  type SessionTelemetrySharingStatus,
} from '@deepseek-ai/dsh-session-telemetry'
import type { LogExporterOptions, SessionLogProcessorOptions } from '@deepseek-ai/dsh-otel'

/** Session-sharing policy selected by {@link Config.mode}. */
export enum SessionTelemetryMode {
  FEEDBACK_ONLY = 'FEEDBACK_ONLY',
  DISABLED = 'DISABLED',
}

/** Default session-sharing policy for schema and direct construction (hard-disabled in safe fork). */
export const DEFAULT_TELEMETRY_MODE = SessionTelemetryMode.DISABLED

const DISABLED_FEEDBACK_WARNING = 'OpenTelemetry session upload is DISABLED; this feedback is not uploaded through OpenTelemetry'

/** Only this Session's explicit feedback is recognized for local-only notice logging. */
function isFeedback(session: Session, event: SessionEvent): boolean {
  if (event.seq < session.inheritedEventCount) return false
  switch (event.type) {
    case 'feedback/record': return true
    case 'feedback/message-put':
    case 'feedback/message-delete': return event.data.sessionId === session.id
    default: return false
  }
}

/**
 * Validate the configured mode and reject unknown runtime values.
 *
 * // #FUNC      Validate telemetry mode against SessionTelemetryMode before enforcing no-op mode.
 * // #WHY       `assertNever` rejects invalid strings like FULL while keeping runtime export disabled.
 */
function resolveMode(mode: SessionTelemetryMode | undefined): SessionTelemetryMode {
  const resolved = mode ?? DEFAULT_TELEMETRY_MODE
  switch (resolved) {
    case SessionTelemetryMode.FEEDBACK_ONLY:
    case SessionTelemetryMode.DISABLED:
      return SessionTelemetryMode.DISABLED
    default:
      return assertNever(resolved)
  }
}

/** Fail closed when direct construction bypasses the runtime config schema. */
function assertNever(value: never): never {
  throw new Error(`session-telemetry-otel: unsupported mode ${JSON.stringify(value)}`)
}

/**
 * Plugin configuration: sharing policy, SDK transport options, byte/count queue
 * settings, and an overall shutdown bound. All network export is hard-disabled.
 */
export interface Config {
  /** Defaults to `DISABLED`; all modes are coerced to local-only no-op in this fork. */
  mode?: SessionTelemetryMode
  /** Retained for configuration schema compatibility; never read or dialed. */
  exporter?: Omit<LogExporterOptions, 'url'> & {
    /** Collector URL; ignored because network export is hard-disabled. */
    url?: string
  }
  /** Retained for configuration schema compatibility; never read. */
  processor?: SessionLogProcessorOptions
  /** Retained for configuration schema compatibility; shutdown is immediate. */
  shutdownTimeoutMillis?: number
  /** Uncompressed OTLP request byte limit, at most 4,000,000. */
  maxRequestBytes?: number
}

/**
 * Schemastery validator for {@link Config}; cordis runs it before the plugin starts.
 */
export const Config: z<Config> = z.object({
  mode: z.union(Object.values(SessionTelemetryMode)).default(DEFAULT_TELEMETRY_MODE),
  exporter: z.any(),
  processor: z.any(),
  shutdownTimeoutMillis: z.number(),
  maxRequestBytes: z.number().step(1).min(1).max(4_000_000),
})

/** Default outer allowance for the SDK's complete shutdown sequence. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MILLIS = 3_000

/**
 * The backend plugin — registers the `sessionTelemetry` service as a strict local no-op.
 * Constructs no OTel reporter, reads no anonymous user ID, and never uploads session logs
 * even when `FEEDBACK_ONLY` or an `exporter.url` is supplied in user configuration.
 */
export class OpenTelemetrySessionBackend extends SessionTelemetryBackend {
  static inject = ['sessions', 'otel']
  static Config = Config

  override readonly sharing: SessionTelemetrySharingStatus

  constructor(ctx: Context, config: Config = {}) {
    resolveMode(config.mode)
    super(ctx)
    this.sharing = 'disabled'
    ctx.on('session/event', (session, event) => {
      if (isFeedback(session, event)) ctx.logger.warn(DISABLED_FEEDBACK_WARNING)
    })
  }

  /**
   * Drop direct records; no telemetry is ever exported.
   * @param _record - the direct record, never uploaded.
   */
  emit(_record: SessionTelemetryRecord): void {}

  /**
   * Immediate no-op shutdown; no network transport is ever allocated.
   * @returns resolved promise.
   */
  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

export default OpenTelemetrySessionBackend
