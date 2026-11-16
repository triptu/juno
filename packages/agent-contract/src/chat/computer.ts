/**
 * The user's computer as its platform names it, for the agent's copy
 * (decision D4): "Mac" on the Mac, "PC" on Windows. The page knows from
 * `?platform=` in its address, as `@juno/ui`'s platform does; the agent's
 * own process from its platform. Linux runs only in tests, as a Mac.
 */
const scope = globalThis as { readonly location?: { readonly search: string }; readonly process?: { readonly platform?: string } }
const windows = scope.location === undefined ? scope.process?.platform === 'win32' : /[?&]platform=win32(&|$)/.test(scope.location.search)

export const computer = windows ? 'PC' : 'Mac'
