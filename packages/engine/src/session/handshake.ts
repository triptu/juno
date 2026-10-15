/**
 * `SocketHandshake` backed by main (ADR 0007): before each socket connect the
 * engine asks main for the serialised cookie header, the origin, the user
 * agent and Chromium's proxy resolution for the URL, and sends any
 * `Set-Cookie` from the upgrade response back for the URL of that connect.
 * The header string lives only for the upgrade.
 *
 * Proxies: `ws` does not read the system proxy, so the answer's proxy list
 * (`proxyFor`) becomes an HTTP CONNECT agent for `ws`. A SOCKS-only answer
 * connects directly and logs that the proxy was not used.
 */
import type { Agent } from 'node:http'
import { Effect, Ref } from 'effect'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { SocketHandshakeShape } from '@juno/slack'
import type { HostLink } from '../protocol/host'

export function hostHandshake(host: HostLink['Service']): SocketHandshakeShape {
  const last = Ref.makeUnsafe<{ readonly url: string; readonly proxy: string } | undefined>(undefined)
  const agents = new Map<string, Agent>()
  return {
    headers: (url) =>
      Effect.gen(function* () {
        const answer = yield* host.handshake(url)
        yield* Ref.set(last, { url, proxy: answer.proxy })
        return {
          ...(answer.cookie === '' ? {} : { cookie: answer.cookie }),
          origin: answer.origin,
          'user-agent': answer.userAgent,
        }
      }),
    setCookies: (cookies) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(last)
        if (current === undefined || cookies.length === 0) return
        yield* host.send({ _tag: 'setCookies', url: current.url, cookies: [...cookies] })
      }),
    // `SlackSocket` asks for the agent right after the headers, for the same URL.
    agent: (url) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(last)
        if (current === undefined || current.url !== url) return undefined
        const proxy = proxyFor(current.proxy)
        if (proxy === 'unsupported') {
          yield* Effect.logWarning('socket: the system proxy is not HTTP; connecting directly')
          return undefined
        }
        if (proxy === undefined) return undefined
        let agent = agents.get(proxy)
        if (agent === undefined) {
          agent = new HttpsProxyAgent(proxy)
          agents.set(proxy, agent)
        }
        return agent
      }),
  }
}

/**
 * The proxy URL for `ws` from Chromium's answer to `resolveProxy`, a PAC
 * list such as `PROXY host:8080; DIRECT`. The first entry Juno can use
 * wins, in the list's order: `PROXY` and `HTTPS` give a URL, `DIRECT` gives
 * `undefined`. A list with neither (only SOCKS or QUIC) is `unsupported`.
 */
export function proxyFor(answer: string): string | undefined | 'unsupported' {
  const entries = answer.split(';').map((entry) => entry.trim()).filter((entry) => entry !== '')
  if (entries.length === 0) return undefined
  for (const entry of entries) {
    const [kind = '', hostPort] = entry.split(/\s+/)
    switch (kind.toUpperCase()) {
      case 'DIRECT':
        return undefined
      case 'PROXY':
        if (hostPort !== undefined) return `http://${hostPort}`
        break
      case 'HTTPS':
        if (hostPort !== undefined) return `https://${hostPort}`
        break
    }
  }
  return 'unsupported'
}
