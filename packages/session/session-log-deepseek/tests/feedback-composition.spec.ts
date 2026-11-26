import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import MessageFeedback from '@deepseek-ai/dsh-message-feedback'
import { recordFeedback } from '@deepseek-ai/dsh-command-feedback'
import LlmRuntime, { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import DeepSeekLlmApiExtensions from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import { startMockLlmServer, type MockLlmServer, type MockLlmServerOptions } from '@deepseek-ai/dsh-llm-mock-server'
import * as SessionLogDeepSeek from '../src/index.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

let root: string | undefined
let ctx: Context | undefined
let server: MockLlmServer | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  await server?.close()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  ctx = undefined
  server = undefined
  root = undefined
  vi.unstubAllEnvs()
})

async function boot(
  sessionLog: { enabled: boolean; maxBytes?: number }, mock: MockLlmServerOptions,
): Promise<{ ctx: Context; server: MockLlmServer }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-feedback-upload-'))
  vi.stubEnv('DSH_HOME', root)
  vi.stubEnv('DEEPSEEK_API_KEY', 'feedback-test-key')
  server = await startMockLlmServer(mock)
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-message-feedback', MessageFeedback],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-llm-deepseek-api-key', LlmDeepSeek],
    ['@deepseek-ai/dsh-deepseek-llm-api-extensions', DeepSeekLlmApiExtensions],
    ['@deepseek-ai/dsh-session-log-deepseek', SessionLogDeepSeek],
  ])
  const config = join(root, 'cordis.yml')
  await writeFile(config, JSON.stringify([...modules.keys()].map(name => ({
    name,
    ...name === '@deepseek-ai/dsh-session-persistence-jsonl'
      ? { config: { root: join(root!, 'sessions'), compression: 'none' } }
      : name === '@deepseek-ai/dsh-message-feedback'
        ? { config: { maxNoteBytes: 1024 } }
        : name === '@deepseek-ai/dsh-llm-deepseek-api-key'
          ? { config: { baseURL: server!.baseURL } }
          : name === '@deepseek-ai/dsh-session-log-deepseek'
            ? { config: sessionLog }
            : {},
  }))))
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  return { ctx, server }
}

it('keeps feedback local and never attaches dsh_session_log to provider requests even when enabled: true', async () => {
  const { ctx, server } = await boot({ enabled: true }, { sequence: ['success'], repeatLast: true })
  const session = ctx.sessions.create(brandString<SessionId>('feedback-local'))
  const handle = await ctx.sessionPersistence.create(session.header)
  try {
    const user = createUserMessage({ content: [{ type: 'text', text: 'Question' }], source: { kind: 'user' } })
    const assistant = createAssistantMessage({ content: [{ type: 'text', text: 'Answer' }], source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', user, { surfaceOp: 'append' })
    session.append('assistant/message', { message: assistant, stream: [], turn: 1, step: 1 }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    recordFeedback(session, { text: 'Local feedback only' })
    const created = await ctx.messageFeedback.put({ sessionId: session.id, messageId: assistant.id, rating: 'negative', note: 'Local note', ifVersion: null })
    expect(created.ok).toBe(true)

    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionId: session.id, messages: session.deriveMessages() })) {
      chunks.push(chunk)
    }
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]!.body).not.toHaveProperty('dsh_session_log')
    expect(server.requests[0]!.body).not.toHaveProperty('dsh_feedback')
    expect(SessionLogDeepSeek.acceptedThrough(session)).toBe(-1)
  } finally {
    await handle.close()
  }
})
