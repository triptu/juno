interface Row {
  readonly id: string | number
  readonly channel: string
  readonly nextAt: number
}

/**
 * Only a channel's head can run. Later rows cannot advance its wake, even
 * when overdue. Dependency and stall timers are separate wakes. A second
 * immediate wake for the same unchanged head yields for 50 ms and reports
 * it once, so a missed settlement cannot silently spin the event loop.
 */
export function wakeSchedule() {
  let immediate: string | undefined
  let warned = false
  return (rows: ReadonlyArray<Row>, now: number, blocked: ReadonlySet<string | number> = new Set(), timers: ReadonlyArray<number> = []) => {
    const seen = new Set<string>()
    const heads = rows.filter((row) => {
      if (seen.has(row.channel)) return false
      seen.add(row.channel)
      return !blocked.has(row.id)
    })
    const due = [...heads.map((row) => row.nextAt), ...timers]
    const delay = due.length === 0 ? undefined : Math.max(0, Math.min(...due) - now)
    const head = heads.find((row) => row.nextAt <= now)
    const key = delay === 0 && head !== undefined ? `${head.id}:${head.nextAt}` : undefined
    if (key !== undefined && key === immediate) {
      const repeatedHead = warned ? undefined : head?.id
      warned = true
      return { delay: 50, repeatedHead }
    }
    immediate = key
    warned = false
    return { delay, repeatedHead: undefined }
  }
}
