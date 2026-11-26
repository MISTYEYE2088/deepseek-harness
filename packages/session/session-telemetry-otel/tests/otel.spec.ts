import OTel from '@deepseek-ai/dsh-otel'
/**
 * Defense-in-depth unit suite for `@deepseek-ai/dsh-session-telemetry-otel`:
 * defaults to `DISABLED` and hard-blocks all OTLP network exports even when
 * `mode: FEEDBACK_ONLY` and an `exporter.url` are explicitly configured.
 */

import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { recordFeedback } from '@deepseek-ai/dsh-command-feedback'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import MessageFeedbackService from '@deepseek-ai/dsh-message-feedback'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import OpenTelemetrySessionBackend, { Config, DEFAULT_TELEMETRY_MODE, SessionTelemetryMode } from '../src/index.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

const servers: Server[] = []
let tempHome: string
let previousDshHome: string | undefined

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dsh-otel-home-'))
  previousDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = tempHome
})

afterAll(() => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  rmSync(tempHome, { recursive: true, force: true })
})

afterEach(async () => {
  for (const server of servers.splice(0)) {
    const closed = once(server, 'close')
    server.close()
    server.closeAllConnections()
    await closed
  }
})

async function mockCollector(): Promise<{ url: string; captures: string[] }> {
  const captures: string[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      captures.push(Buffer.concat(chunks).toString())
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}/v1/logs`, captures }
}

describe('OpenTelemetrySessionBackend defense-in-depth', () => {
  it('defaults schema and direct construction to DISABLED', () => {
    expectTypeOf<Config['mode']>().toEqualTypeOf<SessionTelemetryMode | undefined>()
    expectTypeOf<'FULL'>().not.toExtend<SessionTelemetryMode>()
    expect(Object.values(SessionTelemetryMode)).toEqual(['FEEDBACK_ONLY', 'DISABLED'])
    expect(() => Config({ mode: 'FULL' } as unknown as Config)).toThrow()
    expect(DEFAULT_TELEMETRY_MODE).toBe(SessionTelemetryMode.DISABLED)
    expect(Config({}).mode).toBe(SessionTelemetryMode.DISABLED)
  })

  it('never exports session logs on feedback or message rating even when FEEDBACK_ONLY and exporter.url are configured', async () => {
    const { url, captures } = await mockCollector()
    const root = mkdtempSync(join(tmpdir(), 'dsh-otel-noop-'))
    const ctx = new Context()
    ctx.plugin(OTel)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(JsonlPersistence, { root, compression: 'none' })
      await ctx.plugin(MessageFeedbackService, { maxNoteBytes: 1024 })
      const fiber = await ctx.plugin(OpenTelemetrySessionBackend, {
        mode: SessionTelemetryMode.FEEDBACK_ONLY,
        exporter: { url, headers: { authorization: 'Bearer test-token' } },
        processor: { scheduledDelayMillis: 1 },
      })
      expect(ctx.sessionTelemetry.sharing).toBe('disabled')

      const session = ctx.sessions.create(brandString<SessionId>('local-only'))
      const handle = await ctx.sessionPersistence.create(session.header)
      try {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        const message = createAssistantMessage({ content: [{ type: 'text', text: 'answer' }], source: { provider: 'deepseek-official', model: 'm' } })
        session.append('assistant/message', { message, stream: [], turn: 1, step: 1 }, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        recordFeedback(session, { text: 'explicit feedback stays local' })
        const put = await ctx.messageFeedback.put({ sessionId: session.id, messageId: message.id, rating: 'negative', note: 'local note', ifVersion: null })
        expect(put.ok).toBe(true)
        ctx.sessionTelemetry.emit({
          channel: 'ledger',
          time: Date.now(),
          severity: 'info',
          attributes: { 'session.id': 'local-only', 'event.type': 'manual', 'event.seq': 99 },
          body: { direct: true },
        })
        await ctx.sessionTelemetry.shutdown()
        await fiber.dispose()
      } finally {
        await handle.close()
      }
      expect(warn).toHaveBeenCalledWith(
        'OpenTelemetry session upload is DISABLED; this feedback is not uploaded through OpenTelemetry',
      )
      expect(captures).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(['INVALID', 'FULL'])('rejects unsupported mode %s before reading transport config', async (mode) => {
    const ctx = new Context()
    ctx.plugin(OTel)
    await ctx.plugin(SessionStore)
    let exporterRead = false
    const config = {
      mode,
      get exporter() {
        exporterRead = true
        throw new Error('transport config was read')
      },
    } as unknown as Config

    expect(() => new OpenTelemetrySessionBackend(ctx, config)).toThrow(`unsupported mode "${mode}"`)
    expect(exporterRead).toBe(false)
    await ctx.fiber.dispose()
  })

  it.each([SessionTelemetryMode.DISABLED, SessionTelemetryMode.FEEDBACK_ONLY, undefined])(
    'never reads transport settings in mode %s',
    async (mode) => {
      const ctx = new Context()
      ctx.plugin(OTel)
      await ctx.plugin(SessionStore)
      const transportRead = vi.fn(() => {
        throw new Error('transport config was read')
      })
      const config = {
        ...(mode === undefined ? {} : { mode }),
        get exporter() {
          return transportRead()
        },
        get processor() {
          return transportRead()
        },
        get shutdownTimeoutMillis() {
          return transportRead()
        },
      } as Config

      new OpenTelemetrySessionBackend(ctx, config)
      expect(ctx.sessionTelemetry.sharing).toBe('disabled')
      expect(transportRead).not.toHaveBeenCalled()
      await ctx.fiber.dispose()
    },
  )
})
