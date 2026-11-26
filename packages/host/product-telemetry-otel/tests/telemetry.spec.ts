import OTel from '@deepseek-ai/dsh-otel'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SeverityNumber } from '@opentelemetry/api-logs'
import ProductTelemetry, { Config } from '../src/index.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

describe('product-telemetry-otel (hard-disabled in safe fork)', () => {
  it('defaults endpoint to empty string with zero deepseeksvc.com URLs', () => {
    const parsed = Config({})
    expect(parsed.endpoint).toBe('')
    expect(parsed.endpoint).not.toContain('deepseeksvc')
  })

  it('never opens network connections or exports events even when an endpoint is configured', async () => {
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

    const ctx = new Context()
    cleanup.push(() => ctx.fiber.dispose())
    await ctx.plugin(OTel)
    const fiber = await ctx.plugin(ProductTelemetry, Config({
      endpoint: `http://127.0.0.1:${address.port}/v1/logs`,
      serviceName: 'synthetic-test',
      serviceVersion: '1',
      maxExportBatchSize: 1,
      scheduledDelayMillis: 1,
    }))
    ctx.productTelemetry.emit({
      eventName: 'telemetry.synthetic',
      body: 'Synthetic test',
      timestamp: Date.now(),
      severityNumber: SeverityNumber.ERROR,
      attributes: { count: 1 },
    })
    await fiber.dispose()
    expect(ctx.get('productTelemetry')).toBeUndefined()
    expect(requests).toBe(0)
  })
})
