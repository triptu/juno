/**
 * Each lane's limit on one test's time, as its default timeout (docs/development.md, "Rules for tests"). A test
 * over it is waiting on something it does not control: a real timer, a poll, a child process, or more journey than
 * one test should hold. A test that must take longer (a crash and relaunch journey, a feel scenario) sets its own
 * timeout with a `// Slow:` reason, which `scripts/check-test-patterns.mjs` requires. The numbers are for the laptop,
 * which other jobs share and where several workers share each core: the same test there took 6.5 s in one run and
 * 14 s an hour later (docs/development.md, "Rules for tests"). A stress run (JUNO_STRESS_SCALE) scales them.
 */

/** Unit and engine flow tests (`bun run test`). */
export const UNIT_LIMIT_MS = 5_000
/** The DOM lane (`bun run test:dom`): a host and a renderer per test. */
export const DOM_LIMIT_MS = 15_000
/** The browser lane's specs and feel scenarios. */
export const BROWSER_LIMIT_MS = 20_000
/** The Electron lane: a real app per test, at a lower priority beside the browser lane in the same job. */
export const ELECTRON_LIMIT_MS = 30_000

/** How much a stress run slows things down (scripts/remote/workers.sh); 1 otherwise. */
export const stressScale = (): number => Number(process.env.JUNO_STRESS_SCALE ?? 1)
