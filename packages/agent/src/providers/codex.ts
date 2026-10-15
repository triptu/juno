import { codexWriter } from './codex/lifecycle'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexLocal } from './codex/local'
import type { SpendLedger } from '../spend'
import { upper, limits } from '@juno/agent-memory'
import { Codex } from '@openai/codex-sdk'
import type { Api, Model } from '@earendil-works/pi-ai'
import { AdmissionError, providerFailure, type ProviderFailure, type Revision } from './guard'

export interface CodexOptions {
  readonly agentDir: string
  readonly guard: { readonly spend: SpendLedger; readonly admitHarness: (revision: Revision, model: Model<Api>, prompt: string) => string }
  /** A removal invalidates every reusable thread before its files are purged. */
  readonly threadExists?: (id: string) => boolean
  /** The installed local CLI; startFakeCodex().path in tests. */
  readonly executable: string
}
export type CodexResult = { readonly kind: 'done'; readonly text: string; readonly threadId: string | null }
  | { readonly kind: 'failed'; readonly failure: ProviderFailure; readonly threadId: string | null }

/** Isolated local harness. Never retries a turn, including after a process crash. */
export function createCodexAdapter(options: CodexOptions) {
  const local = createCodexLocal(options)
  const { home, status, environment: env } = local
  const sessions = new Map<string, { id: string; gen: number; pinRev: number; model: string; tokens: number }>()
  const busy = new Set<string>()
  return {
    ...local,
    turn: async (input: {
      /** What the builder built the prompt against, such as the admitted `Request`. */
      readonly sessionId?: string
      readonly revision: Revision
      readonly prompt: string
      readonly model: Model<Api>
      readonly mcp: { readonly url: string; readonly token: string }
      readonly signal?: AbortSignal
    }): Promise<CodexResult> => {
      let threadId: string | null = null
      const sessionId = input.sessionId
      if (sessionId && busy.has(sessionId)) return { kind: 'failed', failure: providerFailure(new AdmissionError({ _tag: 'interrupted' })), threadId }
      if (sessionId) busy.add(sessionId)
      const controller = new AbortController()
      const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal
      const finish = codexWriter(home, controller)
      let cwd: string | undefined
      try {
        const availability = await status()
        if (availability !== 'signedIn') throw new AdmissionError({ _tag: 'failed', reason: availability === 'missing' ? 'codexMissing' : 'codexSignedOut' })
        const endpoint = new URL(input.mcp.url)
        if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.username || endpoint.password) {
          throw new Error('Codex tools require a loopback endpoint')
        }
        cwd = await mkdtemp(join(tmpdir(), 'juno-codex-turn-'))
        const codex = new Codex({ codexPathOverride: options.executable, env: { ...env, JUNO_MCP_TOKEN: input.mcp.token }, config: {
          mcp_servers: { juno: { url: input.mcp.url, bearer_token_env_var: 'JUNO_MCP_TOKEN', default_tools_approval_mode: 'approve' } },
          features: { shell_tool: false, apps: false, plugins: false, image_generation: false, browser_use: false,
            computer_use: false, in_app_browser: false, memories: false },
          include_permissions_instructions: false, include_apps_instructions: false, include_environment_context: false,
        } })
        const threadOptions = { model: input.model.id, workingDirectory: cwd, skipGitRepoCheck: true,
          sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled' } as const
        const previous = sessionId ? sessions.get(sessionId) : undefined
        // Reserve room for Codex's own prompt and the next reply. Never rely on its automatic compaction.
        const promptTokens = upper([input.prompt], 1.25)
        if (promptTokens + limits.reserve + 32_000 >= input.model.contextWindow) throw new AdmissionError({ _tag: 'blocked', reason: 'tooLarge' })
        const reuse = previous && previous.gen === input.revision.gen && previous.pinRev === input.revision.pinRev &&
          previous.model === input.model.id && options.threadExists?.(previous.id) !== false &&
          previous.tokens + promptTokens + limits.reserve + 32_000 < input.model.contextWindow
        const thread = reuse ? codex.resumeThread(previous.id, threadOptions) : codex.startThread(threadOptions)
        if (reuse) threadId = previous.id
        if (sessionId) sessions.delete(sessionId)
        const prompt = options.guard.admitHarness(input.revision, input.model, input.prompt)
        signal.throwIfAborted()
        const turnId = options.guard.spend.countCodex(home)
        if (threadId) options.guard.spend.recordThread(turnId, threadId)
        const stream = await thread.runStreamed(prompt, { signal })
        let text = ''
        let completed = false
        let tokens = 0
        let failure: Error | undefined
        for await (const event of stream.events) {
          if (event.type === 'thread.started') {
            threadId = event.thread_id
            options.guard.spend.recordThread(turnId, threadId)
          } else if (event.type === 'item.completed' && event.item.type === 'agent_message') text = event.item.text
          else if (event.type === 'turn.completed') {
            completed = true
            tokens = event.usage.input_tokens + event.usage.output_tokens
          } else if ((event.type === 'item.started' || event.type === 'item.completed') &&
            (event.item.type === 'command_execution' || event.item.type === 'file_change' || event.item.type === 'web_search' ||
              (event.item.type === 'mcp_tool_call' && event.item.server !== 'juno'))) { failure = new Error('Codex used a disabled tool'); controller.abort() }
          else if (event.type === 'turn.failed') failure = new Error(event.error.message)
          else if (event.type === 'error') failure = new Error(event.message)
        }
        if (failure) throw failure
        if (!completed) throw new Error('Codex process exited')
        if (sessionId && threadId && tokens > 0) sessions.set(sessionId, { id: threadId, ...input.revision, model: input.model.id, tokens: Math.max(tokens, (reuse ? previous.tokens : 32_000) + promptTokens + upper([text], 1.25)) })
        return { kind: 'done', text, threadId }
      } catch (error) {
        if (sessionId) sessions.delete(sessionId)
        return { kind: 'failed', failure: signal.aborted ? providerFailure(new AdmissionError({ _tag: 'interrupted' })) : codexFailure(error), threadId }
      } finally {
        finish()
        if (sessionId) busy.delete(sessionId)
        if (cwd) await rm(cwd, { recursive: true, force: true })
      }
    },
  }
}

function codexFailure(error: unknown): ProviderFailure {
  if (error instanceof AdmissionError) return providerFailure(error)
  const message = error instanceof Error ? error.message : String(error)
  if (/quota|usage limit|rate.?limit|429/i.test(message)) return { ending: { _tag: 'failed', reason: 'codexQuota' }, rateLimited: false }
  if (/not logged in|signed out|401|403/i.test(message)) return { ending: { _tag: 'failed', reason: 'codexSignedOut' }, rateLimited: false }
  return { ending: { _tag: 'failed', reason: 'codexCrash' }, rateLimited: false }
}
