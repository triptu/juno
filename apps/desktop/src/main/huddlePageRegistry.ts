import type { MainToEngine } from '@juno/contract'

/** Live renderer generations, shared by the Electron window watcher and the browser host. */
export function createHuddlePageRegistry(send: (message: MainToEngine) => void) {
  const live = new Map<number, number>()
  let maxIssued = Date.now() * 1000
  const report = () => send({ _tag: 'huddlePages', live: [...live.values()], maxIssued })
  return {
    report,
    generation: (id: number) => live.get(id),
    forget: (id: number, generation?: number) => {
      if (live.has(id) && (generation === undefined || live.get(id) === generation)) {
        live.delete(id)
        report()
      }
    },
    register: (id: number): number => {
      // The engine cannot outlive its host. A previous launch's page is absent from this live set.
      const generation = ++maxIssued
      live.set(id, generation)
      report()
      return generation
    },
  }
}
