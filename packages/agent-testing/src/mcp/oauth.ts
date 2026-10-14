/**
 * A fake OAuth authorization server for the fake MCP servers: discovery
 * (RFC 9728 and RFC 8414), dynamic client registration, the authorization
 * code grant with PKCE S256, and optionally refresh with rotation. It is what
 * pi-mcp's `McpOAuthProvider` talks to in tests.
 *
 * GET on the authorization endpoint approves at once and redirects to the
 * client's `redirect_uri`, standing in for the owner signing in. `approve()`
 * does the same without HTTP. Codes are single use. Access tokens expire after
 * `accessTokenSeconds` or on `expireAccessTokens()`; an expired token gets the
 * 401 the real server gives, with a `WWW-Authenticate: Bearer` challenge.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface OAuthOptions {
  readonly scopes: ReadonlyArray<string>
  /** Offer the `refresh_token` grant. T3 Code does not (spikes.md). */
  readonly refresh: boolean
  /** `expires_in` of each access token. Default 3600. */
  readonly accessTokenSeconds?: number
  /** The `error` a rejected MCP request reports. Default `invalid_token`. */
  readonly invalidTokenError?: string
  /** Endpoint paths. Default `/authorize`, `/token` and `/register`. */
  readonly paths?: { readonly authorize: string; readonly token: string; readonly register: string }
  /** The clock for token expiry. Default `Date.now`. */
  readonly now?: () => number
}

export interface OAuthStats {
  readonly registrations: number
  readonly codes: number
  /** Successful code exchanges. */
  readonly exchanges: number
  /** Successful refreshes. */
  readonly refreshes: number
}

export interface FakeOAuth {
  /**
   * The owner approves `authorizationUrl`. Returns the redirect the browser
   * would follow: `redirect_uri?code=…&state=…`, or `?error=…` for a request
   * the server refuses.
   */
  readonly approve: (authorizationUrl: string | URL) => URL
  /** The owner refuses: `redirect_uri?error=access_denied`. */
  readonly deny: (authorizationUrl: string | URL) => URL
  /** Every access token issued so far is expired from now on. */
  readonly expireAccessTokens: () => void
  /** Every refresh token issued so far is revoked: a refresh answers `invalid_grant`. */
  readonly revokeRefreshTokens: () => void
  readonly stats: () => OAuthStats
}

/** The parts `http.ts` uses. */
export interface OAuthServer extends FakeOAuth {
  readonly route: (req: IncomingMessage, res: ServerResponse, origin: string) => Promise<boolean>
  readonly verify: (authorization: string | undefined) => 'ok' | 'missing' | 'invalid'
  readonly challenge: (res: ServerResponse, origin: string, presented: boolean) => void
}
const oauthError = (res: ServerResponse, error: string, description: string) => send(res, 400, { error, error_description: description })

interface Client { readonly redirectUris: ReadonlyArray<string> }
interface Code { readonly clientId: string; readonly redirectUri: string; readonly challenge: string; readonly scope: string; used: boolean }
interface Access { expiresAt: number; readonly scope: string }

const b64url = (bytes: Buffer) => bytes.toString('base64url')
function redirect(target: string, params: Record<string, string>) {
  const url = new URL(target)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}
function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value))
}
const token = (prefix: string) => `${prefix}-${b64url(randomBytes(18))}`

export function createOAuthServer(options: OAuthOptions): OAuthServer {
  const paths = options.paths ?? { authorize: '/authorize', token: '/token', register: '/register' }
  const now = options.now ?? Date.now
  const lifetime = options.accessTokenSeconds ?? 3600
  const clients = new Map<string, Client>()
  const codes = new Map<string, Code>()
  const access = new Map<string, Access>()
  const refreshTokens = new Map<string, { scope: string; clientId: string }>()
  let exchanges = 0
  let refreshes = 0

  const authorize = (raw: string | URL, allow: boolean): URL => {
    const url = new URL(raw)
    const p = url.searchParams
    const clientId = p.get('client_id') ?? ''
    const redirectUri = p.get('redirect_uri') ?? ''
    const state: Record<string, string> = p.has('state') ? { state: p.get('state')! } : {}
    const client = clients.get(clientId)
    if (!client || !client.redirectUris.includes(redirectUri)) throw new Error('fake OAuth: unknown client or redirect_uri')
    if (!allow) return redirect(redirectUri, { error: 'access_denied', ...state })
    if (p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) {
      return redirect(redirectUri, { error: 'invalid_request', ...state })
    }
    const code = token('code')
    codes.set(code, { clientId, redirectUri, challenge: p.get('code_challenge')!, scope: p.get('scope') ?? options.scopes.join(' '), used: false })
    return redirect(redirectUri, { code, ...state })
  }
  const issue = (scope: string, clientId: string) => {
    const accessToken = token('at')
    access.set(accessToken, { expiresAt: now() + lifetime * 1000, scope })
    const tokens: Record<string, unknown> = { access_token: accessToken, token_type: 'Bearer', expires_in: lifetime, scope }
    if (options.refresh) {
      const refreshToken = token('rt')
      refreshTokens.set(refreshToken, { scope, clientId })
      tokens.refresh_token = refreshToken
    }
    return tokens
  }

  const exchange = (form: URLSearchParams, res: ServerResponse) => {
    const grant = form.get('grant_type')
    if (grant === 'authorization_code') {
      const code = codes.get(form.get('code') ?? '')
      if (!code || code.used) return oauthError(res, 'invalid_grant', 'The authorization code is invalid or was already used.')
      code.used = true
      const verifier = form.get('code_verifier') ?? ''
      if (code.clientId !== form.get('client_id') || code.redirectUri !== form.get('redirect_uri') ||
        b64url(createHash('sha256').update(verifier).digest()) !== code.challenge) {
        return oauthError(res, 'invalid_grant', 'The code does not match this client, redirect or verifier.')
      }
      exchanges++
      return send(res, 200, issue(code.scope, code.clientId))
    }
    if (grant === 'refresh_token' && options.refresh) {
      const presented = form.get('refresh_token') ?? ''
      const entry = refreshTokens.get(presented)
      if (!entry) return oauthError(res, 'invalid_grant', 'The refresh token is invalid.')
      refreshTokens.delete(presented)
      refreshes++
      return send(res, 200, issue(entry.scope, entry.clientId))
    }
    return oauthError(res, 'unsupported_grant_type', `Grant ${grant} is not supported.`)
  }

  return {
    approve: (url) => authorize(url, true),
    deny: (url) => authorize(url, false),
    expireAccessTokens: () => {
      for (const entry of access.values()) entry.expiresAt = 0
    },
    revokeRefreshTokens: () => refreshTokens.clear(),
    stats: () => ({ registrations: clients.size, codes: codes.size, exchanges, refreshes }),
    verify: (header) => {
      if (!header?.startsWith('Bearer ')) return 'missing'
      const entry = access.get(header.slice('Bearer '.length))
      return entry && entry.expiresAt > now() ? 'ok' : 'invalid'
    },
    challenge: (res, origin, presented) => {
      const code = options.invalidTokenError ?? 'invalid_token'
      const error = presented ? `error="${code}", ` : ''
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': `Bearer ${error}resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      }).end(JSON.stringify({ error: code, error_description: presented ? 'The access token is invalid or expired.' : 'Authorization is required.' }))
    },
    route: async (req, res, origin) => {
      const url = new URL(req.url ?? '/', origin)
      if (req.method === 'GET' && (url.pathname === '/.well-known/oauth-protected-resource/mcp' || url.pathname === '/.well-known/oauth-protected-resource')) {
        send(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: options.scopes, bearer_methods_supported: ['header'] })
        return true
      }
      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
        send(res, 200, {
          issuer: origin,
          authorization_endpoint: `${origin}${paths.authorize}`,
          token_endpoint: `${origin}${paths.token}`,
          registration_endpoint: `${origin}${paths.register}`,
          scopes_supported: options.scopes,
          response_types_supported: ['code'],
          grant_types_supported: options.refresh ? ['authorization_code', 'refresh_token'] : ['authorization_code'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        })
        return true
      }
      if (url.pathname.startsWith('/.well-known/')) {
        send(res, 404, { error: 'not_found' })
        return true
      }
      if (req.method === 'POST' && url.pathname === paths.register) {
        const metadata = JSON.parse(await body(req)) as { redirect_uris?: string[] }
        const clientId = token('client')
        clients.set(clientId, { redirectUris: metadata.redirect_uris ?? [] })
        send(res, 201, { ...metadata, client_id: clientId, client_id_issued_at: Math.floor(now() / 1000), token_endpoint_auth_method: 'none' })
        return true
      }
      if (req.method === 'GET' && url.pathname === paths.authorize) {
        try {
          res.writeHead(302, { location: authorize(url, true).href }).end()
        } catch (error) {
          send(res, 400, { error: 'invalid_request', error_description: (error as Error).message })
        }
        return true
      }
      if (req.method === 'POST' && url.pathname === paths.token) {
        exchange(new URLSearchParams(await body(req)), res)
        return true
      }
      return false
    },
  }
}

export async function body(req: IncomingMessage): Promise<string> {
  let text = ''
  for await (const chunk of req) text += chunk
  return text
}
