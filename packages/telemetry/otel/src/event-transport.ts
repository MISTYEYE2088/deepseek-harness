/** Hard-disabled ordinary-event OTLP HTTP transport stub (safe fork: never opens network connections). */
import { ExportResultCode } from '@opentelemetry/core'
import type { LogRecordExporter } from '@opentelemetry/sdk-logs'
import type { LogExporterOptions } from './transport.ts'

// #FUNC      Return an inert LogRecordExporter for product events that never performs HTTP requests.
// #NOT       Never invokes got.post or allocates network sockets.
// #WHY       `ExportResultCode` settles BatchLogRecordProcessor locally so telemetry cannot phone home.
/**
 * Create a no-op event exporter that never performs network I/O.
 * @param _options - explicit collector and SDK HTTP settings (ignored).
 * @param signal - channel cancellation signal.
 * @returns an inert SDK exporter that drops all records locally.
 */
export function createEventLogExporter(_options: LogExporterOptions, signal: AbortSignal): LogRecordExporter {
  return {
    export(_records, resultCallback) {
      if (signal.aborted) {
        resultCallback({
          code: ExportResultCode.FAILED,
          error: signal.reason instanceof Error ? signal.reason : new Error('Event log export aborted'),
        })
        return
      }
      resultCallback({ code: ExportResultCode.SUCCESS })
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  }
}
