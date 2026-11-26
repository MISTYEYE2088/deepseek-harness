import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  Session,
  type SessionId,
  SessionLogOffset,
  SessionSeq,
  type CreateSessionOptions,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import DeepSeekLlmApiExtensionRegistry from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import * as SessionLogDeepSeek from '../src/index.ts'
import type { DeepSeekSessionLogExtension, DeepSeekSessionLogWireEvent, DeepSeekSessionLogWireSurfaceOp } from '../src/types.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

const contexts: Context[] = []
const SIGNAL = new AbortController().signal

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(
  id: string,
  seed?: readonly SessionEvent[],
  creation?: Omit<CreateSessionOptions, 'seed'>,
): Promise<{
  ctx: Context
  session: Session
  disposeUpload: () => Promise<void>
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(DeepSeekLlmApiExtensionRegistry)
  const upload = ctx.plugin(SessionLogDeepSeek, { enabled: true })
  await upload
  const options = seed === undefined ? undefined : { seed, ...creation }
  const session = ctx.sessions.create(brandString<SessionId>(id), options)
  return { ctx, session, disposeUpload: () => upload.dispose() }
}

describe('DeepSeek session-log upload (hard-disabled in safe fork)', () => {
  it('publishes raw numeric sequence fields on its external wire DTO', () => {
    expectTypeOf<DeepSeekSessionLogExtension['sessionFormatVersion']>().toEqualTypeOf<number>()
    expectTypeOf<DeepSeekSessionLogExtension['afterSeq']>().toEqualTypeOf<number>()
    expectTypeOf<DeepSeekSessionLogExtension['throughSeq']>().toEqualTypeOf<number>()
    expectTypeOf<DeepSeekSessionLogExtension['events'][number]['seq']>().toEqualTypeOf<number>()
    expectTypeOf<DeepSeekSessionLogExtension['events'][number]['data']>().toEqualTypeOf<JsonValue>()
    expectTypeOf<DeepSeekSessionLogExtension['session']['seedLength']>()
      .toEqualTypeOf<number | undefined>()
    type System = Extract<DeepSeekSessionLogWireEvent, { type: 'system/message' }>
    type Replace = Exclude<DeepSeekSessionLogWireSurfaceOp, 'append'>
    expectTypeOf<System['surfaceOp']>().toEqualTypeOf<DeepSeekSessionLogWireSurfaceOp>()
    expectTypeOf<Replace>().toEqualTypeOf<{
      readonly op: 'replace'
      readonly startSeq: number
      readonly endSeq: number
    }>()
  })

  it('never contributes dsh_session_log even when enabled: true is passed', async () => {
    const { ctx, session, disposeUpload } = await harness('hard-blocked')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'sensitive prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const release = ctx.sessionLogDeepSeek.registerExclusion(() => false)
    const prepared = await ctx.deepseekLlmApiExtensions.prepare({
      body: { messages: [] }, signal: SIGNAL, sessionId: session.id,
    })
    expect(prepared.fields).not.toHaveProperty('dsh_session_log')
    await prepared.accept()
    expect(SessionLogDeepSeek.acceptedThrough(session)).toBe(-1)
    await release()
    await disposeUpload()
  })

  it('folds persisted acceptance watermarks and rejects malformed records', () => {
    const id = brandString<SessionId>('incremental-fold')
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
      {
        type: 'session-log-deepseek/delivery-accepted',
        seq: SessionSeq(1),
        time: 2,
        data: {
          sessionId: id,
          throughSeq: SessionSeq(0),
          sessionFormatVersion: SESSION_FORMAT_VERSION,
        },
      },
    ]
    const session = {
      id,
      header: { version: SESSION_FORMAT_VERSION },
      get seq() { return SessionLogOffset(events.length) },
      eventAt(seq: ReturnType<typeof SessionSeq>) {
        return events[seq]
      },
    } as unknown as Session

    expect(SessionLogDeepSeek.acceptedThrough(session)).toBe(0)

    const missing = Session.create(brandString<SessionId>('missing-event'))
    missing.append('turn/start', { turn: 1 })
    vi.spyOn(missing, 'eventAt').mockReturnValue(undefined)
    expect(() => SessionLogDeepSeek.acceptedThrough(missing))
      .toThrow('session-log-deepseek: missing event 0 below captured length 1')
  })
})
