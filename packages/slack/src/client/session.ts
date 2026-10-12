/**
 * The signed-in workspace: ids, URL and the `xoxc` token. The engine builds
 * it from `secrets.bin` and the stored team record; tests build it from the
 * fake's credentials. The `d` cookie is not here: the HTTP transport and the
 * socket handshake own it (ADR 0007).
 */
import { Context, Layer } from 'effect'

export interface SlackSessionShape {
  readonly teamId: string
  readonly userId: string
  /** `https://<workspace>.slack.com/` (trailing slash optional). */
  readonly workspaceUrl: string
  /** The `xoxc-` team token. Never log it. */
  readonly token: string
  /** Enterprise Grid only. */
  readonly enterprise?: {
    readonly id: string
    /** Org-scoped token, when the team record has one. */
    readonly token?: string
    readonly name?: string
  }
}

export class SlackSession extends Context.Service<SlackSession, SlackSessionShape>()('juno/slack/SlackSession') {
  static readonly layer = (session: SlackSessionShape): Layer.Layer<SlackSession> => Layer.succeed(SlackSession, session)
}

/** `slack_route`: `<enterprise>:<team>` on Grid, else the team id (research section 1). */
export const slackRoute = (session: SlackSessionShape): string =>
  session.enterprise === undefined ? session.teamId : `${session.enterprise.id}:${session.teamId}`

/** `<workspace url>/api` without a trailing slash. */
export const apiBaseFromWorkspace = (workspaceUrl: string): string => `${workspaceUrl.replace(/\/+$/, '')}/api`
