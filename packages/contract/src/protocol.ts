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
  /** Tests only: keep the production request pacing against the fake, to measure a first sync as a user meets it. */
  fakeSlackPaced: Schema.optionalKey(Schema.Boolean),
  /** Which AI provider the engine builds: the deterministic fake (tests, `JUNO_AI=fake`) or pi-ai over OpenRouter. */
  ai: Schema.optionalKey(Schema.Literals(['fake', 'live'])),
  /** Tests only: how long the fake AI takes to answer, to watch a slow model hit a task's timeout. */
  fakeAiDelayMillis: Schema.optionalKey(Schema.Number),
  /** Tests only: the fake provider answers only with an OpenRouter key from main (`aiKey`) and inside the spend cap, as the live one does. */
  fakeAiRequiresKey: Schema.optionalKey(Schema.Boolean),
  /** Tests only: how long a reaction waits unsent before the message says so (the app waits 30 s). */
  actionStallMillis: Schema.optionalKey(Schema.Number),
  /** Tests only: open the cache with one more migration, as the next build would, to test that an update keeps the cache. */
  cacheMigrationProbe: Schema.optionalKey(Schema.Boolean),
})
export type EngineConfig = typeof EngineConfig.Type

/** A message a notification opens: its topic at that message. */
export const NotificationSource = Schema.Struct({ channelId: Schema.String, ts: Schema.String, topicId: Schema.String })
export type NotificationSource = typeof NotificationSource.Type

export const NotificationTarget = Schema.Union([
  Schema.TaggedStruct('message', { source: NotificationSource }),
])
export type NotificationTarget = typeof NotificationTarget.Type

/** One OS notification. The id is stable, so main shows a repeated one once. */
export const OsNotification = Schema.Struct({ id: Schema.String, title: Schema.String, body: Schema.String, target: NotificationTarget })
export type OsNotification = typeof OsNotification.Type

/** main -> engine over parentPort. A `port` message carries the port in `ports[0]`. */
export const MainToEngine = Schema.Union([
  Schema.TaggedStruct('config', { config: EngineConfig }),
  Schema.TaggedStruct('port', {}),
  /** The app window has painted; background provider warm-up may start. */
  Schema.TaggedStruct('painted', {}),
  /** OpenRouter credentials, memory only. Null removes the key and cancels current calls. */
  Schema.TaggedStruct('aiKey', { key: Schema.NullOr(Schema.String) }),
  /** A port to the agent utility process, in `ports[0]`. The engine serves the AgentHost group on it (ADR 0012). */
  Schema.TaggedStruct('agentPort', {}),
  /** The answer to `requestSecrets`, `signIn` and `importFromSlackApp`: the stored or just captured session, or nothing. */
  Schema.TaggedStruct('secrets', { secrets: Schema.NullOr(SessionSecrets) }),
  /** A sign-in or import ended without a session. `details` is the import's report for "Copy details": no secrets, no values. */
  Schema.TaggedStruct('sessionFailed', { method: SignInMethod, kind: SignInFailureKind, message: Schema.String, details: Schema.optionalKey(Schema.String) }),
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
  /** The topic on screen in a focused window, or null. Notifications for it are suppressed. */
  Schema.TaggedStruct('viewing', { topicId: Schema.NullOr(Schema.String) }),
  /** The Mac woke from sleep: apply the presence schedule again. */
  Schema.TaggedStruct('wake', {}),
])
export type MainToEngine = typeof MainToEngine.Type

/** engine -> main over parentPort. */
export const EngineToMain = Schema.Union([
  /** Tests only: a fake provider call started. No input or credentials. */
  Schema.TaggedStruct('aiCall', { task: Schema.String }),
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
  /** Please show this OS notification. */
  Schema.TaggedStruct('notify', { notification: OsNotification }),
  /** Whether any topic has an unread mention: the dock shows a `•` badge. */
  Schema.TaggedStruct('badge', { mentions: Schema.Boolean }),
])
export type EngineToMain = typeof EngineToMain.Type
