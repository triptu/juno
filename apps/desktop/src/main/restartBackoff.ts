/** Production backoff, scaled like engine scheduling only in fast e2e launches against fake Slack. */
export function restartBackoff(attempt: number): number {
  const fast = process.env.JUNO_E2E === '1' && process.env.JUNO_E2E_FAST_TIMING === '1' && !!process.env.JUNO_FAKE_SLACK_URL
  return Math.min(1_000 * 2 ** attempt, 30_000) / (fast ? 20 : 1)
}
