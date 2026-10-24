export function commitOnMain(root: string, message: string, write: (checkout: string) => string[], settled: () => boolean): boolean
export function syncReleasedVersion(root: string, released: string): boolean

export function checkPublishedRelease(repo: string, version: string): void
