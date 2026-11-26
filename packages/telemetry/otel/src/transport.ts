/** Hard-disabled OTLP JSON transport stub (safe fork: never opens network connections). */
import { createOtlpHttpExporterMetrics, getSharedConfigurationFromEnvironment, httpAgentFactoryFromOptions } from '@opentelemetry/otlp-exporter-base/node-http'
import type { createOtlpHttpExportDelegate } from '@opentelemetry/otlp-exporter-base/node-http'
import { ExportResultCode } from '@opentelemetry/core'
import { type ExporterMetrics, getSharedConfigurationDefaults, mergeOtlpSharedConfigurationWithDefaults, type OTLPExporterNodeConfigBase } from '@opentelemetry/otlp-exporter-base'
import { LogsExporterMetricsHelper } from '@opentelemetry/otlp-transformer'
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs'

/** `otel.component.type` reported by OTLP HTTP log exporter self-observability metrics. */
const OTLP_HTTP_LOG_EXPORTER_COMPONENT_TYPE = 'otlp_http_log_exporter'

/**
 * Collector and SDK HTTP settings accepted by this package's log exporters.
 *
 * `OTLPExporterConfigBase.selfObsMeterProvider` is excluded: every channel here
 * passes no meter provider to the exporter metrics recorder, which stays noop.
 */
export type LogExporterOptions = Omit<OTLPExporterNodeConfigBase, 'selfObsMeterProvider'> & {
  /** Full HTTP(S) logs destination. */
  url: string
}

// #FUNC      Return an inert in-memory LogRecordExporter that drops all OTLP log batches.
// #NOT       Never creates an HTTP/HTTPS agent or opens outbound network connections.
// #WHY       `ExportResultCode.SUCCESS` settles SDK queues immediately without network I/O.
/**
 * Create a no-op log exporter that never performs network I/O.
 * @param _options - explicit endpoint, headers, agent, and SDK transport settings (ignored).
 * @returns an inert exporter that immediately acknowledges and drops all records.
 */
export function createLogExporter(_options: LogExporterOptions): LogRecordExporter {
  return {
    export(_records, resultCallback) {
      resultCallback({ code: ExportResultCode.SUCCESS })
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  }
}

/**
 * Create one log exporter's self-observability metrics; without a meter provider they record nothing.
 * @param url - collector endpoint recorded as the metrics server address and port.
 * @returns the metrics recorder required by an OTLP HTTP log export delegate.
 */
export function createLogExporterMetrics(url: string): ExporterMetrics<ReadableLogRecord[]> {
  return createOtlpHttpExporterMetrics(OTLP_HTTP_LOG_EXPORTER_COMPONENT_TYPE, LogsExporterMetricsHelper, url, undefined)
}

/**
 * Resolve collector-local headers and agents with shared SDK timeout and compression defaults.
 * @param options - explicit endpoint and SDK HTTP settings.
 * @returns resolved transport settings without ambient credentials.
 */
export function logTransportOptions(
  options: LogExporterOptions,
): Parameters<typeof createOtlpHttpExportDelegate>[0] {
  const shared = mergeOtlpSharedConfigurationWithDefaults(options, getSharedConfigurationFromEnvironment('LOGS'), getSharedConfigurationDefaults())
  return {
    ...shared,
    url: options.url,
    headers: async () => ({
      'Content-Type': 'application/json',
      ...typeof options.headers === 'function' ? await options.headers() : options.headers,
    }),
    // An agent factory owns the returned agent, including its keepAlive setting.
    agentFactory: typeof options.httpAgentOptions === 'function' ? options.httpAgentOptions
      : httpAgentFactoryFromOptions({ keepAlive: options.keepAlive ?? true, ...options.httpAgentOptions }),
    ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
  }
}
