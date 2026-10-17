export const orphanGraceMs = 5 * 60_000
/** The default cap (approved 10-17), the plan's limit, and the default clients before 10-17 sent with every request. */
export const defaultCap = 48, planCap = 64, legacyCap = 24

/** The cap a request is admitted against: the admitter's own, unless the request was explicitly lowered below the default. */
export function requestCap(request, ownCap) {
  const lowered = request.capSet ? request.cap < defaultCap : request.cap < legacyCap
  return lowered ? Math.min(ownCap, request.cap) : ownCap
}

/** Whether a later request may be admitted past the waiting ones in `blocked`. */
export function mayPass(blocked, now, holdMs) {
  return blocked.every((request) => now - request.created < holdMs)
}

/** Inputs carry liveness observations; this function never contacts Namespace. */
export function machinesToDestroy({ instances, states, pending, owner, now, idleMs, lifetimeMs }) {
  const tracked = new Map(states.map((state) => [state.id, state]))
  const result = new Set()
  for (const state of states) {
    if (state.live) continue
    if (state.destroying || state.abandoned || now - state.created >= lifetimeMs || (!state.kept && now - state.lastUsed >= (state.idleMs ?? idleMs))) result.add(state.id)
  }
  for (const instance of instances) {
    const labels = instance.labels ?? {}
    if (tracked.has(instance.cluster_id) || labels['juno-remote'] !== '1') continue
    if (labels['juno-pool'] && labels['juno-pool'] !== owner) continue
    const attempt = pending.find((entry) => entry.token === labels['juno-create'])
    if (attempt?.live) continue
    // A failed creator never handed this machine to a job.
    if (attempt || now - Date.parse(instance.created_at) >= orphanGraceMs) result.add(instance.cluster_id)
  }
  return [...result]
}

/**
 * Cores in use against the cap. Namespace's image builders (nsc.purpose=builder)
 * stay up idle after a build and are not ours to release; counting them would
 * stop every run while they linger without saving their cost.
 */
export function capacity(allInstances, states) {
  const instances = allInstances.filter((instance) => instance.labels?.['nsc.purpose'] !== 'builder')
  const ids = new Set(states.map((state) => state.id))
  // A create can finish after the inventory read and replace its pending reservation.
  const visible = new Set(instances.map((instance) => instance.cluster_id))
  const reserved = states.filter((state) => !visible.has(state.id)).reduce((sum, state) => sum + Number(/:(\d+)x/.exec(state.machine)?.[1] ?? 8), 0)
  return instances.reduce((total, instance) => {
    total[ids.has(instance.cluster_id) ? 'tracked' : 'untracked'] += instance.shape?.virtual_cpu ?? 8
    return total
  }, { tracked: reserved, untracked: 0 })
}

/** Creates not yet visible in the workspace still reserve their requested cores. */
export function pendingVcpu(instances, pending) {
  const visible = new Set(instances.map((instance) => instance.labels?.['juno-create']))
  return pending.filter((entry) => !visible.has(entry.token)).reduce((sum, entry) => sum + Number(/:(\d+)x/.exec(entry.machine)?.[1] ?? 8), 0)
}

/** How long Namespace calls must keep failing before clients are told, and the default fail-fast window (none: wait). */
export const outageAfterMs = 3 * 60_000, outageRemindMs = 5 * 60_000
/** Exit code for a run that gave up because Namespace was unreachable (EX_TEMPFAIL). */
export const outageExit = 75

/** `10m`, `90s`, `1h` or a bare number of minutes; undefined when unset or empty. */
export function parseDuration(value) {
  if (value === undefined || value === '') return undefined
  const match = /^(\d+(?:\.\d+)?)(s|m|h)?$/.exec(String(value).trim())
  if (!match) throw new Error(`not a duration: ${value} (use 90s, 10m or 1h)`)
  return Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[match[2] ?? 'm']
}

const timedOut = (message) => /ETIMEDOUT|deadline exceeded|DeadlineExceeded|timed? ?out|\b504\b/i.test(message)

/**
 * Folds one Namespace call into the outage record. Each call (`list`, `create`)
 * is tracked on its own, so a working list does not hide failing creates.
 */
export function noteCall(outage, { call, ok, error = '', now }) {
  const calls = { ...outage?.calls }
  if (ok) delete calls[call]
  else {
    const previous = calls[call] ?? { since: now, timedOut: 0, failed: 0 }
    const line = error.split('\n').map((text) => text.trim()).filter(Boolean).at(-1) ?? 'unknown error'
    calls[call] = { ...previous, [timedOut(error) ? 'timedOut' : 'failed']: previous[timedOut(error) ? 'timedOut' : 'failed'] + 1, last: now, lastError: line.slice(0, 160) }
  }
  return Object.keys(calls).length ? { calls } : undefined
}

/** The calls that have failed for at least `afterMs`, at least twice; undefined when Namespace looks reachable. */
export function activeOutage(outage, now, afterMs = outageAfterMs) {
  const calls = Object.entries(outage?.calls ?? {}).filter(([, state]) => now - state.since >= afterMs && state.timedOut + state.failed >= 2)
  if (!calls.length) return undefined
  return { since: Math.min(...calls.map(([, state]) => state.since)), calls }
}

const clock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
/** One line naming when calls started failing, how often, and the last error. */
export function describeOutage(active) {
  const counts = active.calls.flatMap(([call, state]) => [
    ...(state.timedOut ? [`nsc ${call} timed out ${state.timedOut} time${state.timedOut === 1 ? '' : 's'}`] : []),
    ...(state.failed ? [`nsc ${call} failed ${state.failed} time${state.failed === 1 ? '' : 's'}`] : []),
  ])
  const last = active.calls.toSorted((a, b) => b[1].last - a[1].last)[0][1].lastError
  return `Namespace unreachable since ${clock(active.since)} (${counts.join(', ')}; last: ${last})`
}

/**
 * Whether a create attempt that did not finish (it failed, or its creator died)
 * can be forgotten. A late machine carries the attempt's label, so the record
 * stays until an inventory taken after the failure has shown it gone, or no
 * inventory has shown it for `graceMs` after the failure. While Namespace
 * cannot be listed, nothing is forgotten.
 */
export function attemptSettled({ entry, observed, present, inventoryStartedAt, now, graceMs = orphanGraceMs }) {
  if (entry.live) return false
  if (observed && !present) return true
  if (present) return false
  const failedAt = entry.failedAt ?? entry.created
  return inventoryStartedAt > failedAt && now - failedAt >= graceMs
}
