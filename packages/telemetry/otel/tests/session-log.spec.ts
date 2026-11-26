import { Context } from '@deepseek-ai/cordis'
import OTel from '../src/index.ts'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MeterProvider } from '@opentelemetry/api'
import { type SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { type SessionLogProcessorOptions, type SessionLogRecord, type SessionLogOptions } from '../src/session-log.ts'
import type { LogExporterOptions } from '../src/transport.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

/** Type-only probe: accepted channel options exclude SDK self-observability metering. */
function meteringOptionsAreExcluded(url: string, meterProvider: MeterProvider): void {
  // @ts-expect-error -- exporter self-observability metering is not accepted.
  const exporter: LogExporterOptions = { url, selfObsMeterProvider: meterProvider }
  // @ts-expect-error -- this processor implements no self-observability metering.
  const processor: SessionLogProcessorOptions = { selfObsMeterProvider: meterProvider }
  void exporter
  void processor
}
void meteringOptionsAreExcluded

const cleanup: (() => Promise<void>)[] = []
let ctx: Context

beforeEach(async () => {
  ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(OTel)
})

afterEach(async () => {
  try {
    for (const dispose of cleanup.splice(0).reverse()) await dispose()
  } finally {
    vi.restoreAllMocks()
  }
})

function sessionRecord(text: string, seq = 0): SessionLogRecord {
  return {
    sessionId: brandString<SessionId>('synthetic-session'),
    event: { type: 'user/message', seq: SessionSeq(seq), time: 1_800_000_000_000, surfaceOp: 'append',
      data: { content: [{ type: 'text', text }] } },
  }
}

function reporter(endpoint: string, overrides: Partial<SessionLogOptions> = {}) {
  const onFailure = vi.fn()
  const sender = ctx.otel.createSessionLogReporter({
    scope: { name: '@deepseek-ai/dsh-session-telemetry-otel', version: '0.0.0' },
    exporter: { url: endpoint, timeoutMillis: 1000 },
    resourceAttributes: { 'service.name': 'session-test' },
    processor: { scheduledDelayMillis: 60000 },
    onFailure,
    ...overrides,
  })
  cleanup.push(() => sender.shutdown())
  return { sender, onFailure }
}

it('never sends network requests from SessionLogReporter when createLogExporter is hard-disabled', async () => {
  let requests = 0
  const server = createServer((req, res) => {
    requests++
    req.resume()
    req.on('end', () => { res.writeHead(200).end('{}') })
  })
  cleanup.push(async () => {
    const closed = once(server, 'close')
    server.close()
    server.closeAllConnections()
    await closed
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('collector has no port')

  const { sender, onFailure } = reporter(`http://127.0.0.1:${address.port}/v1/logs`)
  sender.reportSessionLog(sessionRecord('local only'))
  await sender.shutdown()
  expect(requests).toBe(0)
  expect(onFailure).not.toHaveBeenCalled()
})

it.each([0, -1, 1.5, 4000001, Infinity])('rejects byte limit %s', (maxRequestBytes) => {
  expect(() => reporter('http://collector.test/logs', { maxRequestBytes })).toThrow('maxRequestBytes')
})

it.each(['maxQueueSize', 'maxExportBatchSize', 'scheduledDelayMillis', 'exportTimeoutMillis'] as const)('rejects invalid %s', (key) => {
  expect(() => reporter('http://collector.test/logs', { processor: { [key]: 0 } })).toThrow(`processor.${key}`)
})

it('rejects a batch count above the queue capacity', () => {
  expect(() => reporter('http://collector.test/logs', { processor: { maxQueueSize: 1, maxExportBatchSize: 2 } })).toThrow('maxExportBatchSize must not exceed maxQueueSize')
})
