export const MOST_HIGHLIGHTS: number
export function userFacingChanges(subjects: readonly string[]): string[]
export function highlightLines(text: string): string[]
export function releaseDue(input: { candidate: string | null; previous?: string }): string | null
export function selectCommit(root: string, tip: string, records: readonly unknown[]): string | null
