interface Gate {
  commit: string
  record: { commit: string; finishedAt: string }
  nightly: { commit: string; finishedAt: string }
}
export function releaseGate(root: string, commit: string): Gate | null
export function printGate(gate: Gate): void
