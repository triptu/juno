/**
 * The "In a huddle" status, as the official client keeps it (research
 * section 2, `users.profile.set`; `scheduleHuddleStateExpirationIncrement`
 * in `boot-async`). While the call is live it writes the profile's
 * `huddle_state_expiration_ts` as now plus 300 s, at once and then every
 * 240 s give or take 10%. That is the only field it writes:
 * `huddle_state` and `huddle_state_channel_id` are never written by the
 * client. When the call ends it stops; the official client sends no
 * clearing write either, so the status lapses at the expiry.
 *
 * A failed write waits for the next turn, is logged once per call, and
 * never touches the call.
 */
import { Clock, Effect, Random, Result } from 'effect'
import { SlackApi } from '@juno/slack'
import type { HuddleSession } from './Huddle'

/** How far ahead each write sets the expiry. */
export const STATUS_EXPIRY_SECONDS = 300
/** How often the expiry is written while the call is live, before the ±10% jitter. */
export const STATUS_RENEW_MILLIS = 240_000

const statusRequest = (session: HuddleSession, expiresAt: number) =>
  SlackApi.use((api) =>
    api.call('users.profile.set', { profile: { huddle_state_expiration_ts: expiresAt } }, { lane: 'background', reason: 'increment-huddle-state-expiration-ts' }),
  ).pipe(Effect.provide(session.slack))

/** Keeps the status for one live call until interrupted. */
export const keepStatus = (session: HuddleSession) =>
  Effect.gen(function* () {
    const every = session.statusRenewMillis ?? STATUS_RENEW_MILLIS
    let logged = false
    while (true) {
      const now = yield* Clock.currentTimeMillis
      const written = yield* Effect.result(statusRequest(session, now / 1000 + STATUS_EXPIRY_SECONDS))
      if (Result.isFailure(written) && !logged) {
        logged = true
        yield* Effect.logWarning('huddle: the huddle status was not renewed', { error: written.failure._tag })
      }
      yield* Effect.sleep(yield* Random.nextBetween(every * 0.9, every * 1.1))
    }
  })
