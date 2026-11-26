import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { EventLogReporter } from '../src/event-log.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  try { for (const dispose of cleanup.splice(0).reverse()) await dispose() }
  finally { vi.restoreAllMocks() }
})

const event = { eventName: 'synthetic', body: 'Synthetic test', timestamp: 1_800_000_000_000 }

it('never sends HTTP requests from EventLogReporter even when emit and shutdown run', async () => {
  let requests = 0
  const server = createServer((req, res) => {
    requests++
    req.resume()
    req.on('end', () => { res.end('{}') })
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

  const onFailure = vi.fn()
  const sender = new EventLogReporter({
    exporter: { url: `http://127.0.0.1:${address.port}/v1/logs`, timeoutMillis: 1000 },
    resourceAttributes: {},
    scope: { name: 'event-test' },
    processor: { maxExportBatchSize: 1, scheduledDelayMillis: 10 },
    onFailure,
  })
  sender.emit(event)
  await sender.shutdown()
  expect(requests).toBe(0)
  expect(onFailure).not.toHaveBeenCalled()
})

it('reports cancellation cleanly when aborted before export', async () => {
  const onFailure = vi.fn()
  const sender = new EventLogReporter({
    exporter: { url: 'http://127.0.0.1:9/v1/logs', timeoutMillis: 1000 },
    resourceAttributes: {},
    scope: { name: 'event-test' },
    processor: { scheduledDelayMillis: 60_000 },
    onFailure,
  })
  sender.emit(event)
  await sender.shutdown(AbortSignal.abort(new Error('cancelled')))
  expect(onFailure).toHaveBeenCalled()
})
