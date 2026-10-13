/**
 * Messages around the port, not on it.
 *
 * The port itself carries `effect/rpc` (ADR 0009). These schemas cover what
 * main and the engine say to each other over `process.parentPort`. The port
 * handoff from preload to page is a `window.postMessage` tagged with
 * `PORT_HANDOFF_TAG` (channels.ts); the page checks the tag by hand.
 *
 * Session traffic (architecture 2.3, 2.4, 14): the engine asks main for the
 * stored secrets at start and whenever a sign-in or import should happen;
 * main answers with `secrets` or `sessionFailed`. Main never decides the
 * session state; it only does the Electron work and reports.
 */
import { Schema } from 'effect'
import { SessionSecrets, SignInFailureKind, SignInMethod } from './routes/session'

/** What main sends the engine once, before any port, over parentPort. */
export const EngineConfig = Schema.Struct({
  /** Electron's userData path. Databases live under it. */
  userData: Schema.String,
  /** True under Playwright: plaintext secrets, fake AI, test hooks. */
  e2e: Schema.Boolean,
  /** True when the app is not packaged: extra measurement for DevTools. */
  dev: Schema.Boolean,
  /** Tests only: the fake Slack's base URL, so its host is allowed for the socket. */
  fakeSlackUrl: Schema.optionalKey(Schema.String),
  /** Which AI provider the engine builds: the deterministic fake (tests, `JUNO_AI=fake`) or pi-ai over OpenRouter. */
  ai: Schema.optionalKey(Schema.Literals(['fake', 'live'])),
  /** The OpenRouter key, in memory, for the live provider. Absent means every AI task answers "no decision" (ADR 0006). */
  openRouterApiKey: Schema.optionalKey(Schema.String),
})
export type EngineConfig = typeof EngineConfig.Type

/** main -> engine over parentPort. A `port` message carries the port in `ports[0]`. */
export const MainToEngine = Schema.Union([
  Schema.TaggedStruct('config', { config: EngineConfig }),
  Schema.TaggedStruct('port', {}),
  /** A port to the agent utility process, in `ports[0]`. The engine serves the AgentHost group on it (ADR 0012). */
  Schema.TaggedStruct('agentPort', {}),
  /** The answer to `requestSecrets`, `signIn` and `importFromSlackApp`: the stored or just captured session, or nothing. */
  Schema.TaggedStruct('secrets', { secrets: Schema.NullOr(SessionSecrets) }),
  /** A sign-in or import ended without a session. */
  Schema.TaggedStruct('sessionFailed', { method: SignInMethod, kind: SignInFailureKind, message: Schema.String }),
  /** Main has cleared secrets and cookies after `signOut`. */
  Schema.TaggedStruct('signedOut', {}),
  /** The answer to `handshake`: what the socket upgrade needs (ADR 0007). */
  Schema.TaggedStruct('handshake', {
    id: Schema.Int,
    /** The serialised `Cookie` header for the socket URL, HttpOnly cookies included. Empty when there are none. */
    cookie: Schema.String,
    origin: Schema.String,
    userAgent: Schema.String,
    /** Chromium's proxy resolution, for example `DIRECT` or `PROXY host:port`. */
    proxy: Schema.String,
  }),
])
export type MainToEngine = typeof MainToEngine.Type

/** engine -> main over parentPort. */
export const EngineToMain = Schema.Union([
  /** The engine is serving; main may hand it ports. */
  Schema.TaggedStruct('ready', {}),
  /** Please send the stored secrets (`secrets`, possibly null). */
  Schema.TaggedStruct('requestSecrets', {}),
  /** Please open the sign-in window; answer with `secrets` or `sessionFailed`. */
  Schema.TaggedStruct('signIn', {}),
  /** Please import the Slack app's session; answer with `secrets` or `sessionFailed`. */
  Schema.TaggedStruct('importFromSlackApp', {}),
  /** The session verified; please encrypt and store it. */
  Schema.TaggedStruct('storeSecrets', { secrets: SessionSecrets }),
  /** Please delete the secrets and clear the Slack session; answer with `signedOut`. */
  Schema.TaggedStruct('signOut', {}),
  /** Slack rejected the session. Main may want to raise the window. */
  Schema.TaggedStruct('authRequired', { reason: Schema.String }),
  /** Please answer with `handshake` for this socket URL. */
  Schema.TaggedStruct('handshake', { id: Schema.Int, url: Schema.String }),
  /** `Set-Cookie` values from a socket upgrade response, to be stored in the session for `url`. */
  Schema.TaggedStruct('setCookies', { url: Schema.String, cookies: Schema.Array(Schema.String) }),
])
export type EngineToMain = typeof EngineToMain.Type
