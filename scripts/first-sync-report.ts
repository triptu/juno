/**
 * The first sync timeline's report: milestones, phases and calls by method,
 * from the samples and calls `first-sync-live.ts` recorded. Pure; no I/O.
 */

export interface Call {
  /** Method name, `edge:<path>` for edge calls. */
  readonly m: string
  readonly reason?: string
  readonly s: number
  e?: number
  status?: number
  retry?: number
  retryAfter?: number
  /** A rate-limit `error` code in an ok:false answer. Codes only. */
  limited?: string
  /** History calls only: which conversation, kept in memory to classify it at the end, never printed or written. */
  channel?: string
  /** History calls only: `dm-unread`, `dm-read`, `mention`, `unread` or `other`, from the store at the end. */
  cls?: string
}

export interface Sample {
  readonly t: number
  readonly phase: string
  readonly syncing: boolean
  readonly sidebarRows: number
  readonly sidebarUnread: number
  readonly homeReady: boolean
  readonly homeItems: number
  readonly mainRows: number
  readonly threadRows: number
  readonly unreadTopics: number
  readonly unreadDots: number
  /** Dots among unread DMs and group DMs and conversations that mention you: the counts a user needs first. */
  readonly priorityDots: number
  /** A hash of every unread topic's id and count: when it stops changing, the counts are settled. */
  readonly unreadHash: number
  readonly historyChannels: number
  readonly messages: number
  readonly bootDone: boolean
  readonly quickStart: boolean
}

export const hash = (text: string) => {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0
  return h
}

interface MethodStat { n: number; ms: number; first: number; last: number; retries: number; limited: number; retryAfter: Array<number>; reasons: Record<string, number> }

export const report = (samples: ReadonlyArray<Sample>, calls: ReadonlyArray<Call>, ended: number) => {
  const first = (test: (s: Sample) => boolean) => samples.find(test)?.t
  const final = samples.at(-1)!
  /** The first sample from which `value` stays at its final value. */
  const settled = <A>(value: (s: Sample) => A) => {
    const target = value(final)
    let at: number | undefined
    for (const s of samples) {
      if (value(s) === target) at ??= s.t
      else at = undefined
    }
    return at
  }
  const phases: Array<{ t: number; phase: string; syncing: boolean }> = []
  for (const s of samples) {
    const prev = phases.at(-1)
    if (prev === undefined || prev.phase !== s.phase || prev.syncing !== s.syncing) phases.push({ t: s.t, phase: s.phase, syncing: s.syncing })
  }

  const byMethod = new Map<string, MethodStat>()
  for (const c of calls) {
    const m = byMethod.get(c.m) ?? { n: 0, ms: 0, first: c.s, last: 0, retries: 0, limited: 0, retryAfter: [], reasons: {} }
    m.n++
    m.ms += (c.e ?? ended) - c.s
    m.last = Math.max(m.last, c.e ?? ended)
    if (c.retry !== undefined) m.retries++
    if (c.status === 429 || c.limited !== undefined) m.limited++
    if (c.retryAfter !== undefined) m.retryAfter.push(c.retryAfter)
    const reason = c.reason ?? '-'
    m.reasons[reason] = (m.reasons[reason] ?? 0) + 1
    byMethod.set(c.m, m)
  }
  const lastOf = (test: (c: Call) => boolean) => calls.filter(test).reduce((at, c) => Math.max(at, c.e ?? 0), 0) || undefined

  const milestones = {
    quickStartStored: first((s) => s.quickStart),
    firstSidebarRows: first((s) => s.sidebarRows > 0),
    homeReady: first((s) => s.homeReady),
    firstHomeRows: first((s) => s.homeReady && s.homeItems > 0),
    allConversationsListed: settled((s) => s.mainRows),
    unreadCountsSettled: settled((s) => s.unreadHash),
    noUnreadDots: settled((s) => s.unreadDots),
    unreadDmsAndMentionsRight: settled((s) => s.priorityDots),
    historyAllChannels: settled((s) => s.historyChannels),
    lastHistoryCall: lastOf((c) => c.m === 'conversations.history'),
    lastRepliesCall: lastOf((c) => c.m === 'conversations.replies'),
    lastSearchCall: lastOf((c) => c.m === 'search.modules.messages'),
    bootRecorded: first((s) => s.bootDone),
    firstSyncEnded: first((s) => s.bootDone && s.phase === 'live' && !s.syncing),
    lastCall: lastOf(() => true),
  }

  /** Calls started per 10 s bucket, by method: the shape of the sync over time. */
  const buckets: Record<string, Record<string, number>> = {}
  for (const c of calls) {
    const key = String(Math.floor(c.s / 10_000) * 10)
    buckets[key] ??= {}
    buckets[key][c.m] = (buckets[key][c.m] ?? 0) + 1
  }

  /** Per class of history call: how many, their first and last place in the order, and when the last one ended. */
  const history = calls.filter((c) => c.cls !== undefined)
  const byClass: Record<string, { n: number; first: number; last: number; lastEnd: number }> = {}
  history.forEach((c, i) => {
    const entry = (byClass[c.cls!] ??= { n: 0, first: i, last: i, lastEnd: 0 })
    entry.n++
    entry.last = i
    entry.lastEnd = Math.max(entry.lastEnd, c.e ?? 0)
  })
  const spacing = history.length > 1 ? ((history.at(-1)!.s - history[0]!.s) / (history.length - 1)) : 0

  return {
    milestones,
    phases,
    final,
    byMethod,
    buckets,
    /** Per call, compact: method, reason, start, end. For the gaps between history calls. */
    callLog: calls.map((c) => [c.m, c.reason ?? '', c.s, c.e ?? -1, c.status ?? 0, c.cls ?? '']),
    historyOrder: { byClass, spacing: Math.round(spacing) },
  }
}
