// A 429's Retry-After from a Slack file host keeps main from asking that host again until it passes,
// whichever way the header is written, and never for longer than the cap.
import { expect, it } from 'bun:test'
import { HostPauses, retryAfterMillis } from '../src/main/rateLimit'

const now = Date.parse('2026-11-07T10:00:00Z')

it('reads Retry-After as seconds or an HTTP date, falls back when it is missing or unreadable, and caps a long pause', () => {
  expect(retryAfterMillis('30', now)).toBe(30_000)
  expect(retryAfterMillis(' 2 ', now)).toBe(2_000)
  expect(retryAfterMillis('Sat, 07 Nov 2026 10:00:45 GMT', now)).toBe(45_000)
  expect(retryAfterMillis('Sat, 07 Nov 2026 09:59:00 GMT', now)).toBe(10_000)
  expect(retryAfterMillis(null, now)).toBe(10_000)
  expect(retryAfterMillis('soon', now)).toBe(10_000)
  expect(retryAfterMillis('0', now)).toBe(10_000)
  expect(retryAfterMillis('86400', now)).toBe(5 * 60_000)
})

it('leaves a host alone until its pause passes, counts the seconds left, and forgets it after', () => {
  const pauses = new HostPauses()
  expect(pauses.remainingSeconds('files.slack.com', now)).toBeUndefined()
  pauses.pause('files.slack.com', '5', now)
  expect(pauses.remainingSeconds('files.slack.com', now + 100)).toBe(5)
  expect(pauses.remainingSeconds('files.slack.com', now + 4_100)).toBe(1)
  expect(pauses.remainingSeconds('slack-files.com', now)).toBeUndefined()
  expect(pauses.remainingSeconds('files.slack.com', now + 5_000)).toBeUndefined()
  // Forgotten, not just passed: a later 429 starts a new pause from its own time.
  pauses.pause('files.slack.com', null, now + 60_000)
  expect(pauses.remainingSeconds('files.slack.com', now + 60_000)).toBe(10)
})
