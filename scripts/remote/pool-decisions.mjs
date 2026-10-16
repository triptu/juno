export const orphanGraceMs = 5 * 60_000

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
