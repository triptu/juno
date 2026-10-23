/**
 * Which spec files run in the browser project (README, "Browser lane"). A
 * file here runs in Chrome against a test host; its tests tagged `@electron`
 * run only in the electron project, and those tagged `@canary` run in both.
 * Every other file runs only in the electron project.
 */
export const BROWSER_SPECS: ReadonlyArray<string> = [
  'topic.spec.ts',
]
