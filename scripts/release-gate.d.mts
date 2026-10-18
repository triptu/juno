interface Gate {
  commit: string
  record: { commit: string; finishedAt: string }
  waived: Array<{ id: string; reason: string; date: string; title: string; suite: string }>
}
export function releaseGate(root: string, commit: string): Gate | null
export function printGate(gate: Gate): void
