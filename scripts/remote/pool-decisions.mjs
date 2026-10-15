export const orphanGraceMs = 5 * 60_000

/** Inputs carry liveness observations; this function never contacts Namespace. */
export function machinesToDestroy({ instances, states, pending, owner, now, idleMs, lifetimeMs }) {
  const tracked = new Map(states.map((state) => [state.id, state]))
  const result = new Set()
  for (const state of states) {
    if (state.live) continue
    if (state.destroying || state.abandoned || now - state.created >= lifetimeMs || (!state.kept && now - state.lastUsed >= idleMs)) result.add(state.id)
  }
  for (const instance of instances) {
    const labels = instance.labels ?? {}
    if (tracked.has(instance.cluster_id) || labels['juno-remote'] !== '1') continue
    if (labels['juno-pool'] && labels['juno-pool'] !== owner) continue
    if (pending.some((entry) => entry.live && entry.token === labels['juno-create'])) continue
    if (now - Date.parse(instance.created_at) >= orphanGraceMs) result.add(instance.cluster_id)
  }
  return [...result]
}

export function capacity(instances, states) {
  const ids = new Set(states.map((state) => state.id))
  return instances.reduce((total, instance) => {
    total[ids.has(instance.cluster_id) ? 'tracked' : 'untracked'] += instance.shape?.virtual_cpu ?? 8
    return total
  }, { tracked: 0, untracked: 0 })
}
