/**
 * The guard of `huddle-live.ts`: the list of calls a run may make, and the
 * one fetch every Slack request goes through, which refuses anything else
 * before it leaves. It also keeps each raw answer in memory, so the run can
 * print field names, and turns client errors into codes.
 */
import { Methods } from '@juno/slack-schema'
import type { SlackApiError } from '@juno/slack'
import { decodeIssues } from './live-common.ts'

/** The test channel's name, and the one to use when the first belongs to someone else. */
export const NAMES = ['juno-huddle-test', 'juno-huddle-test-2'] as const

export interface GuardOptions {
  readonly createOnly: boolean
  /** `--status`: read the test channel's huddles and nothing else. */
  readonly statusOnly: boolean
  readonly useFake: boolean
  readonly withSocket: boolean
}

/** What the run may call, printed before the first call. */
export function callPlan({ createOnly, statusOnly, useFake, withSocket, minutes }: GuardOptions & { readonly minutes: number }): Array<string> {
  const find = ['auth.test', 'client.userBoot (find the test channel by name)', 'conversations.info, the test channel only (membership and member count)']
  if (statusOnly) return [...find, 'api.getFlannelHttpUrl (the edge base url), then edge huddles/info, the test channel only']
  if (createOnly) return [...find, 'conversations.create, private, only juno-huddle-test or juno-huddle-test-2, once per name, only if no usable one exists']
  return [
    ...find,
    ...(useFake ? ['conversations.create, as above, on the fake only'] : []),
    'api.getFlannelHttpUrl (the edge base url), then edge huddles/info, the test channel only, before and after the join',
    `GET https://nearest-media-region.l.chime.aws (not Slack; skipped with --fake)`,
    'rooms.join, the test channel only, once, one attempt (_x_reason calls-api/joinRoom)',
    useFake ? 'stop (the fake has no Chime)' : `Chime media in a local Chromium page for ${minutes} min, fake microphone`,
    "rooms.leave with reason user_initiated, the test channel only, on every way out (_x_reason calls-api/leaveRoom)",
    ...(withSocket ? ['client.getWebSocketURL, then the RTM socket, read-only'] : []),
  ]
}

export class Guard {
  /** Set before `conversations.info` asks about a candidate, then fixed once the channel is chosen. */
  candidate: string | undefined
  channel: string | undefined
  created = false
  joins = 0
  readonly createdNames = new Set<string>()
  readonly refused: Array<string> = []
  /** The last raw answer per method, for field-name paths. Kept in memory only. */
  readonly answers = new Map<string, string>()
  readonly #options: GuardOptions

  constructor(options: GuardOptions) {
    this.#options = options
  }

  /** Every request the Slack client makes passes here. Anything not on the plan is refused before it leaves. */
  readonly fetch = async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const api = /^\/api\/([^/]+)$/.exec(url.pathname)?.[1]
    let key: string
    let refusal: string | undefined
    if (api !== undefined) {
      key = api
      const body = init?.body instanceof FormData ? init.body : undefined
      const field = (name: string) => {
        const value = body?.get(name)
        return typeof value === 'string' ? value : undefined
      }
      refusal = this.#check(api, field)
    } else if (url.pathname.endsWith('/huddles/info')) {
      key = 'edge huddles/info'
      const ids = (JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { channel_ids?: unknown }).channel_ids
      refusal = this.channel !== undefined && Array.isArray(ids) && ids.length === 1 && ids[0] === this.channel ? undefined : 'not the test channel'
    } else {
      key = `edge ${url.pathname.split('/').slice(-2).join('/')}`
      refusal = 'not on the list'
    }
    if (refusal !== undefined) {
      this.refused.push(`${key} (${refusal})`)
      throw new TypeError(`huddle-live: refused ${key}`)
    }
    const response = await fetch(input, init)
    this.answers.set(key, await response.clone().text())
    return response
  }

  #check(method: string, field: (name: string) => string | undefined): string | undefined {
    const { createOnly, statusOnly, useFake, withSocket } = this.#options
    switch (method) {
      case 'auth.test':
      case 'client.userBoot':
      case 'api.getFlannelHttpUrl':
        return undefined
      case 'client.getWebSocketURL':
        return withSocket && !statusOnly ? undefined : 'socket not asked for'
      case 'conversations.info':
        return field('channel') !== undefined && field('channel') === (this.channel ?? this.candidate) ? undefined : 'not the test channel'
      case 'conversations.create': {
        const name = field('name') ?? ''
        if (!(createOnly || useFake)) return 'create only with --create-only'
        if (!(NAMES as ReadonlyArray<string>).includes(name)) return 'not a test name'
        if (field('is_private') !== 'true') return 'not private'
        if (this.created || this.createdNames.has(name)) return 'already created once'
        this.createdNames.add(name)
        return undefined
      }
      case 'rooms.join':
        if (createOnly || statusOnly) return 'no join with --create-only or --status'
        if (this.channel === undefined || field('channel_id') !== this.channel) return 'not the test channel'
        if (field('thread_ts') !== undefined) return 'no thread_ts'
        if (this.joins > 0) return 'one join per run'
        this.joins++
        return undefined
      case 'rooms.leave':
        if (createOnly || statusOnly) return 'no leave with --create-only or --status'
        return this.channel !== undefined && field('channel_id') === this.channel ? undefined : 'not the test channel'
      default:
        return 'not on the list'
    }
  }

  /** A client error as a code. Decode errors become issue paths, since their message can quote values. */
  describe(error: SlackApiError): string {
    switch (error._tag) {
      case 'SlackRejected':
      case 'SlackAuthRequired':
        return `error ${error.error}`
      case 'SlackRateLimited':
        return `rate limited, retry after ${error.retryAfterMillis} ms`
      case 'SlackTransportError':
        return `transport: ${error.status === undefined ? '' : `HTTP ${error.status} `}${error.message.startsWith('huddle-live:') ? error.message.slice(13) : error.message.slice(0, 80)}`
      case 'SlackDecodeError': {
        const text = this.answers.get(error.method)
        const schema = (Methods as Record<string, { response: Parameters<typeof decodeIssues>[0] }>)[error.method]?.response
        const issues = text !== undefined && schema !== undefined ? decodeIssues(schema, text) : []
        return `decode failed${issues.length === 0 ? '' : `: ${issues.join('; ')}`}`
      }
    }
  }
}
