/**
 * Relative time for row times (SPEC section 17, inventory section 21):
 * "now", "4m", "2h", "Yesterday", "3d" under 14 days, then "2w".
 *
 * The same rule as `relativeTime` in `@juno/domain`, repeated here because
 * views and containers cannot depend on domain (docs/architecture.md section
 * 3). Keep the two in step.
 */
const MINUTE = 60_000

export function relativeTime(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / MINUTE))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  if (minutes < 2880) return 'Yesterday'
  if (minutes < 20160) return `${Math.floor(minutes / 1440)}d`
  return `${Math.floor(minutes / 10080)}w`
}
