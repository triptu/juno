/**
 * `SocketHandshake` backed by main (ADR 0007): before each socket connect the
 * engine asks main for the serialised cookie header, the origin and the user
 * agent, and sends any `Set-Cookie` from the upgrade response back for the
 * URL of that connect. The header string lives only for the upgrade.
 *
 * Proxies: main answers with Chromium's proxy resolution, but `ws` is given
 * no agent yet; a configured proxy is logged so the gap is visible.
 */
import { Effect, Ref } from 'effect'
import type { SocketHandshakeShape } from '@juno/slack'
import type { HostLink } from '../host/Host'

export function hostHandshake(host: HostLink['Service']): SocketHandshakeShape {
  const lastUrl = Ref.makeUnsafe<string | undefined>(undefined)
  return {
    headers: (url) =>
      Effect.gen(function* () {
        yield* Ref.set(lastUrl, url)
        const answer = yield* host.handshake(url)
        if (answer.proxy !== '' && answer.proxy !== 'DIRECT') yield* Effect.logWarning('socket: a proxy is configured but not used yet')
        return {
          ...(answer.cookie === '' ? {} : { cookie: answer.cookie }),
          origin: answer.origin,
          'user-agent': answer.userAgent,
        }
      }),
    setCookies: (cookies) =>
      Effect.gen(function* () {
        const url = yield* Ref.get(lastUrl)
        if (url === undefined || cookies.length === 0) return
        yield* host.send({ _tag: 'setCookies', url, cookies: [...cookies] })
      }),
    agent: () => Effect.succeed(undefined),
  }
}
