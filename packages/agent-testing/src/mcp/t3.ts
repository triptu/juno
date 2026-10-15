/**
 * Fake T3 Code MCP (plan v3 §8, §10.2, and spikes.md S8).
 *
 * - Tool names and argument names are the real ones, read from the T3 Code
 *   tools exposed to the agent session that ran the spikes. The schemas keep
 *   the arguments Juno uses.
 * - Sign-in is OAuth as S8 found it: dynamic registration, PKCE S256, scopes
 *   `orchestration:read orchestration:operate`, the `authorization_code`
 *   grant only. With no refresh grant, the one-time code sign-in is all there
 *   is: an expired token answers 401 `invalid_mcp_credential` and pi-mcp has
 *   to send the owner to sign in again.
 * - It listens on loopback and on a LAN address with the same port, so the
 *   connection rule (§10.2: loopback first) can be tested. When the LAN
 *   address is not one of this machine's (the default 192.168.1.22), the LAN
 *   listener is really on loopback and `fetch` routes the LAN origin to it.
 *   Pass `fetch` to pi-mcp's transport and OAuth flow. pi-mcp still sees the
 *   LAN URL, so its refusal to exchange a code over plain http to a
 *   non-loopback host happens as it does for real.
 * - Threads are scripted: `launch` and `send` record work, and the test moves
 *   it on with `advance` and `ask` (a pending question, which T3 answers
 *   through `t3_pending_request_respond`).
 */
import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import type { McpFetch, McpTransport } from '@earendil-works/pi-mcp'
import { createHandler, json, type FakeTool, type ToolCallRecord } from './handler'
import { listen, type HttpListener } from './http'
import { connectInMemory } from './memory'
import { createOAuthServer, type FakeOAuth } from './oauth'

export type T3Status = 'idle' | 'preparing' | 'queued' | 'starting' | 'running' | 'waiting' | 'completed' | 'interrupted' | 'failed' | 'cancelled' | 'rolled_back'
const TERMINAL: ReadonlySet<T3Status> = new Set(['completed', 'interrupted', 'failed', 'cancelled', 'rolled_back'])

/** The plan's Tier 0 allowlist (§10.2). */
export const T3_READ_TOOLS = ['t3_thread_read', 't3_thread_list', 't3_thread_search', 't3_thread_wait', 't3_pending_request_list', 't3_project_list', 't3_worktree_list', 't3_worktree_status'] as const
/** Tier 2 through the T3 adapter. */
export const T3_WORK_TOOLS = ['t3_thread_launch', 't3_thread_send', 't3_thread_interrupt'] as const
/** Tier 3: answering a pending question. */
export const T3_ANSWER_TOOLS = ['t3_pending_request_read', 't3_pending_request_respond'] as const
export type T3ToolName = (typeof T3_READ_TOOLS)[number] | (typeof T3_WORK_TOOLS)[number] | (typeof T3_ANSWER_TOOLS)[number]

export interface T3Item { readonly position: number; readonly role: 'user' | 'assistant'; readonly text: string }
export interface T3Request { readonly requestId: string; readonly prompt: string; readonly options: ReadonlyArray<string> }
export interface T3Thread {
  readonly threadId: string
  readonly projectId: string
  readonly title: string
  readonly status: T3Status
  readonly items: ReadonlyArray<T3Item>
  readonly pending: ReadonlyArray<T3Request>
}
export interface T3Project { readonly projectId: string; readonly title: string; readonly workspaceRoot: string }

export interface FakeT3Options {
  /** Listen on 127.0.0.1. Default true. */
  readonly loopback?: boolean
  /** Listen on the LAN address. Default true. */
  readonly lan?: boolean
  /** Default 192.168.1.22, the owner's address in the plan. */
  readonly lanHost?: string
  /** Tools the server does not offer, to test a degraded connection. */
  readonly omitTools?: ReadonlyArray<T3ToolName>
  readonly projects?: ReadonlyArray<T3Project>
  readonly accessTokenSeconds?: number
}

export interface FakeT3 {
  /** The port both addresses share: the configured port. */
  readonly port: number
  /** `http://127.0.0.1:<port>/mcp`, served only when `loopback` is on. */
  readonly loopbackUrl: string
  /** `http://<lanHost>:<port>/mcp`, served only when `lan` is on. */
  readonly lanUrl: string
  /** A fetch that reaches the LAN listener; plain fetch for everything else. */
  readonly fetch: McpFetch
  readonly oauth: FakeOAuth
  readonly calls: ReadonlyArray<ToolCallRecord>
  /** HTTP requests refused with 401, on either address. */
  readonly rejected: () => number
  readonly threads: () => ReadonlyArray<T3Thread>
  /** Moves a thread on: an assistant message and a new status. Wakes `t3_thread_wait` on a terminal status. */
  readonly advance: (threadId: string, update: { readonly status?: T3Status; readonly reply?: string; readonly pullRequest?: { readonly number: number; readonly url: string } }) => void
  /** T3 asks the owner something. The thread waits until it is answered. Returns the request id. */
  readonly ask: (threadId: string, prompt: string, options?: ReadonlyArray<string>) => string
  /** Answers given through `t3_pending_request_respond`. */
  readonly answers: () => ReadonlyArray<{ readonly requestId: string; readonly answers: Record<string, unknown> }>
  readonly connectInMemory: () => McpTransport
  readonly close: () => Promise<void>
}

const str = { type: 'string' } as const
const optStr = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const
const optInt = { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] } as const
const schema = (properties: Record<string, unknown>, required: ReadonlyArray<string> = []) => ({ type: 'object' as const, properties, required: [...required] })

export async function startFakeT3(options: FakeT3Options = {}): Promise<FakeT3> {
  const projects = options.projects ?? [{ projectId: 'project-juno', title: 'juno', workspaceRoot: '/work/juno' }]
  const threads = new Map<string, { threadId: string; projectId: string; title: string; status: T3Status; items: T3Item[]; pending: T3Request[]; linkedPullRequest?: { number: number; url: string } }>()
  const answers: Array<{ requestId: string; answers: Record<string, unknown> }> = []
  const sends = new Map<string, unknown>()
  const waiters = new Set<() => void>()
  let ids = 0
  let closed = false
  const wake = () => {
    for (const waiter of waiters) waiter()
  }
  const find = (threadId: unknown) => {
    const thread = threads.get(String(threadId))
    if (!thread) throw new Error(`Thread ${String(threadId)} was not found.`)
    return thread
  }
  const append = (thread: { items: T3Item[] }, role: T3Item['role'], text: string) => thread.items.push({ position: thread.items.length + 1, role, text })
  const summary = (t: { threadId: string; projectId: string; title: string; status: T3Status }) => ({ threadId: t.threadId, projectId: t.projectId, title: t.title, status: t.status })
  const findRequest = (requestId: unknown) => {
    for (const thread of threads.values()) {
      const request = thread.pending.find((r) => r.requestId === requestId)
      if (request) return { thread, request }
    }
    throw new Error(`Pending request ${String(requestId)} was not found.`)
  }

  const all: Record<T3ToolName, Omit<FakeTool, 'name'>> = {
    t3_project_list: {
      inputSchema: schema({ cursor: optInt, limit: optInt }),
      call: () => json({ projects, nextCursor: null }),
    },
    t3_thread_launch: {
      inputSchema: schema({ title: str, message: optStr, projectId: optStr, runtimeMode: optStr, interactionMode: optStr, workspaceStrategy: { type: 'object' } }, ['title']),
      call: ({ title, message, projectId }) => {
        const thread = { threadId: `thread-${++ids}`, projectId: String(projectId ?? projects[0]?.projectId), title: String(title), status: 'running' as T3Status, items: [] as T3Item[], pending: [] as T3Request[] }
        if (typeof message === 'string') append(thread, 'user', message)
        threads.set(thread.threadId, thread)
        return json(summary(thread))
      },
    },
    t3_thread_send: {
      inputSchema: schema({ threadId: str, message: str, mode: optStr, clientRequestId: optStr }, ['threadId', 'message']),
      call: ({ threadId, message, clientRequestId }) => {
        if (typeof clientRequestId === 'string' && sends.has(clientRequestId)) return json(sends.get(clientRequestId))
        const thread = find(threadId)
        const delivery = TERMINAL.has(thread.status) || thread.status === 'idle' ? 'started' : 'steered'
        append(thread, 'user', String(message))
        thread.status = 'running'
        const result = { threadId: thread.threadId, delivery, status: thread.status }
        if (typeof clientRequestId === 'string') sends.set(clientRequestId, result)
        return json(result)
      },
    },
    t3_thread_interrupt: {
      inputSchema: schema({ threadId: str, runId: optStr, reason: optStr, clientRequestId: optStr }, ['threadId']),
      call: ({ threadId }) => {
        const thread = find(threadId)
        if (!TERMINAL.has(thread.status) && thread.status !== 'idle') {
          thread.status = 'interrupted'
          wake()
        }
        return json(summary(thread))
      },
    },
    t3_thread_read: {
      inputSchema: schema({ threadId: str, afterPosition: optInt, limit: optInt, view: optStr }, ['threadId']),
      call: ({ threadId, afterPosition, limit }) => {
        const thread = find(threadId)
        const after = Number(afterPosition ?? 0)
        const items = thread.items.filter((item) => item.position > after).slice(0, Number(limit ?? 50))
        return json({ thread: { ...summary(thread), branch: 'fix-sidebar-flake', linkedPullRequest: thread.linkedPullRequest ?? null }, items, nextPosition: items.at(-1)?.position ?? after, pendingRequests: thread.pending.length })
      },
    },
    t3_thread_list: {
      inputSchema: schema({ projectId: optStr, statuses: { anyOf: [{ type: 'array', items: str }, { type: 'null' }] }, titleContains: optStr, cursor: optInt, limit: optInt }),
      call: ({ statuses, titleContains }) => {
        const list = [...threads.values()].toReversed()
          .filter((t) => !Array.isArray(statuses) || statuses.includes(t.status))
          .filter((t) => typeof titleContains !== 'string' || t.title.includes(titleContains))
        return json({ threads: list.map(summary), nextCursor: null })
      },
    },
    t3_thread_search: {
      inputSchema: schema({ query: str, limit: { type: 'integer', minimum: 1, maximum: 50 }, projectId: optStr }, ['query']),
      call: ({ query, limit }) => {
        const q = String(query)
        const matches = [...threads.values()].filter((t) => t.title.includes(q) || t.items.some((item) => item.text.includes(q)))
          .slice(0, Number(limit ?? 20)).map(summary)
        return json({ matches })
      },
    },
    t3_thread_wait: {
      inputSchema: schema({ threadId: str, runId: optStr, timeoutMs: { anyOf: [{ type: 'number' }, { type: 'null' }] } }, ['threadId']),
      call: async ({ threadId, timeoutMs }) => {
        const thread = find(threadId)
        const settled = () => TERMINAL.has(thread.status) || thread.status === 'idle'
        if (!settled()) {
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer)
              waiters.delete(check)
              resolve()
            }
            const check = () => {
              if (settled() || closed) done()
            }
            const timer = setTimeout(done, Number(timeoutMs ?? 600_000))
            waiters.add(check)
          })
        }
        return json({ ...summary(thread), timedOut: !settled() })
      },
    },
    t3_pending_request_list: {
      inputSchema: schema({ threadId: optStr }),
      call: ({ threadId }) => json({ requestIds: find(threadId).pending.map((request) => request.requestId) }),
    },
    t3_pending_request_read: {
      inputSchema: schema({ requestId: str, threadId: optStr }, ['requestId']),
      call: ({ requestId }) => {
        const request = findRequest(requestId).request
        return json({ requestId: request.requestId, questions: [{
          id: 'question', header: 'T3 Code asks', question: request.prompt, allowCustomAnswer: true, multiSelect: false,
          options: request.options.map((label) => ({ label, description: '', value: label })),
        }] })
      },
    },
    t3_pending_request_respond: {
      inputSchema: schema({ requestId: str, answers: { type: 'object' }, threadId: optStr }, ['requestId', 'answers']),
      call: ({ requestId, answers: given }) => {
        const { thread, request } = findRequest(requestId)
        thread.pending = thread.pending.filter((r) => r !== request)
        answers.push({ requestId: request.requestId, answers: given as Record<string, unknown> })
        if (thread.pending.length === 0 && thread.status === 'waiting') thread.status = 'running'
        return json({ requestId: request.requestId, accepted: true })
      },
    },
    t3_worktree_list: {
      inputSchema: schema({ threadId: optStr, query: optStr, cursor: optInt, limit: optInt }),
      call: () => json({ refs: [{ name: 'main', kind: 'local', worktreePath: projects[0]?.workspaceRoot ?? '/work' }], nextCursor: null }),
    },
    t3_worktree_status: {
      inputSchema: schema({}),
      call: () => {
        throw new Error('t3_worktree_status needs an agent running inside a T3 thread.')
      },
    },
  }
  const omit = new Set(options.omitTools ?? [])
  const tools = (Object.entries(all) as Array<[T3ToolName, Omit<FakeTool, 'name'>]>)
    .filter(([name]) => !omit.has(name)).map(([name, tool]) => ({ name, ...tool }))
  const handler = createHandler({ name: 't3-code (fake)', tools })
  const oauth = createOAuthServer({
    scopes: ['orchestration:read', 'orchestration:operate'],
    refresh: false,
    invalidTokenError: 'invalid_mcp_credential',
    paths: { authorize: '/oauth/mcp/authorize', token: '/oauth/mcp/token', register: '/oauth/mcp/register' },
    ...(options.accessTokenSeconds ? { accessTokenSeconds: options.accessTokenSeconds } : {}),
  })
  const auth = { kind: 'oauth' as const, server: oauth }
  const lanHost = options.lanHost ?? '192.168.1.22'
  const listeners: HttpListener[] = []
  const loopback = (options.loopback ?? true) ? await listen(handler, { auth }) : undefined
  if (loopback) listeners.push(loopback)
  const port = loopback?.port ?? (await freePort())
  const local = Object.values(networkInterfaces()).flat().some((address) => address?.address === lanHost)
  const lanOrigin = `http://${lanHost}:${port}`
  const lan = (options.lan ?? true)
    ? await listen(handler, local ? { auth, host: lanHost, port } : { auth, publicOrigin: () => lanOrigin })
    : undefined
  if (lan) listeners.push(lan)

  const route: McpFetch = (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (lan && !local && url.origin === lanOrigin) {
      const target = new URL(`${url.pathname}${url.search}`, `http://127.0.0.1:${lan.port}`)
      return fetch(target, init)
    }
    // A LAN address that nothing serves: refuse as a closed port would.
    if (!lan && !local && url.origin === lanOrigin) return Promise.reject(new TypeError('fetch failed'))
    return fetch(input, init)
  }

  return {
    port,
    loopbackUrl: `http://127.0.0.1:${port}/mcp`,
    lanUrl: `${lanOrigin}/mcp`,
    fetch: route,
    oauth,
    calls: handler.calls,
    rejected: () => listeners.reduce((n, l) => n + l.rejected(), 0),
    threads: () => [...threads.values()].map((t) => ({ ...t, items: [...t.items], pending: [...t.pending] })),
    advance: (threadId, update) => {
      const thread = find(threadId)
      if (update.reply !== undefined) append(thread, 'assistant', update.reply)
      if (update.status) thread.status = update.status
      if (update.pullRequest) thread.linkedPullRequest = update.pullRequest
      wake()
    },
    ask: (threadId, prompt, choices = ['Yes', 'No']) => {
      const thread = find(threadId)
      const request = { requestId: `request-${++ids}`, prompt, options: [...choices] }
      thread.pending.push(request)
      thread.status = 'waiting'
      return request.requestId
    },
    answers: () => answers,
    connectInMemory: () => connectInMemory(handler),
    close: async () => {
      closed = true
      wake()
      await Promise.all(listeners.map((l) => l.close()))
    },
  }
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => server.close(resolve))
  return port
}
