/**
 * Session routes (architecture 2.3, 14 and 16 M2): the signed-in state as a
 * live value and the three commands that change it. Main does the work that
 * needs Electron (the sign-in window, the Slack-app import, `secrets.bin`,
 * the cookie session); the engine owns the state and verifies the session
 * with `auth.test`. The renderer only ever sees this.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { liveValueRoute } from '../live'
import { Person } from '../refs'

/** What main hands the engine: the team record from `localConfig_v2` plus the token. The cookie stays in the Chromium session. */
export const SessionSecrets = Schema.Struct({
  teamId: Schema.String,
  userId: Schema.String,
  /** `https://<workspace>.slack.com/`, or the fake's URL in tests. */
  workspaceUrl: Schema.String,
  /** `xoxc-…`. Never logged, never sent to the renderer. */
  token: Schema.String,
  teamName: Schema.optionalKey(Schema.String),
  teamDomain: Schema.optionalKey(Schema.String),
  /** Enterprise Grid. */
  enterprise: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      token: Schema.optionalKey(Schema.String),
      name: Schema.optionalKey(Schema.String),
    }),
  ),
})
export type SessionSecrets = typeof SessionSecrets.Type

export const SignInMethod = Schema.Literals(['window', 'import'])
export type SignInMethod = typeof SignInMethod.Type

export const SessionStatus = Schema.Union([
  Schema.TaggedStruct('signedOut', {}),
  Schema.TaggedStruct('signingIn', { method: SignInMethod }),
  Schema.TaggedStruct('ready', {
    teamId: Schema.String,
    teamName: Schema.String,
    userId: Schema.String,
    /** The user's handle from `auth.test`. */
    userName: Schema.String,
    /** `https://<workspace>.slack.com/`, the base of Slack links (the fake's URL in tests). */
    workspaceUrl: Schema.String,
    enterprise: Schema.optionalKey(Schema.Struct({ id: Schema.String, name: Schema.optionalKey(Schema.String) })),
  }),
  /** A session existed but Slack no longer accepts it. Local data stays. */
  Schema.TaggedStruct('authRequired', { reason: Schema.String }),
])
export type SessionStatus = typeof SessionStatus.Type

/** Why a sign-in or import did not end in a session. `message` is short and never holds a secret. */
export const SignInFailureKind = Schema.Literals([
  /** The user closed the window or declined the keychain prompt. */
  'cancelled',
  /** The page signed in but no token could be read. */
  'no-token',
  /** No Slack app data on this Mac. */
  'no-slack-app',
  /** The Slack app is installed but holds no signed-in workspace. */
  'slack-signed-out',
  /** The keychain password could not be read or did not decrypt the cookie. */
  'keychain',
  /** The token and cookie were found but Slack rejected them. */
  'rejected',
  /** Slack could not be reached to verify the session. */
  'offline',
  /** Something else; see `message`. */
  'other',
])
export type SignInFailureKind = typeof SignInFailureKind.Type

export class SignInFailed extends Schema.TaggedError<SignInFailed>()('SignInFailed', {
  kind: SignInFailureKind,
  message: Schema.String,
}) {}

/** The signed-in person from the users cache, updated with their profile. */
export const sessionProfile = liveValueRoute('session.profile', { value: Schema.NullOr(Person) })

/** The session state. Emits once at subscribe time, then on every change. */
export const sessionStatus = liveValueRoute('session.status', { value: SessionStatus })

/** Opens the sign-in window and waits for a verified session. */
export const sessionSignIn = Rpc.make('session.signIn', { success: Schema.Void, error: SignInFailed })

/** Reads the installed Slack app's session (macOS asks for keychain access) and waits for it to verify. */
export const sessionImportFromSlackApp = Rpc.make('session.importFromSlackApp', { success: Schema.Void, error: SignInFailed })

/** Forgets the session: secrets, cookies and the workspace cache. */
export const sessionSignOut = Rpc.make('session.signOut', { success: Schema.Void })

export const SessionRoutes = RpcGroup.make(sessionProfile, sessionStatus, sessionSignIn, sessionImportFromSlackApp, sessionSignOut)
