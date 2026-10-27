/**
 * Each lane's limit on one test's time, as its default timeout (docs/development.md, "Rules for tests"). A test
 * over it is waiting on something it does not control: a real timer, a poll, a child process, or more journey than
 * one test should hold. A test that must take longer (a crash and relaunch journey, a feel scenario) sets its own
 * timeout with a `// Slow:` reason, which `scripts/check-test-patterns.mjs` requires. The numbers are for a lane
 * running alone on the laptop's job. A lane the plan runs at a lower priority beside another (Electron beside the
 * browser lane, the unit and DOM lanes beside the gallery) gets the CPU the other leaves and twice the time
 * (`limitScale`; docs/development.md, "Rules for tests").
 */

/** Unit and engine flow tests (`bun run test`). */
export const UNIT_LIMIT_MS = 5_000
/** The DOM lane (`bun run test:dom`): a host and a renderer per test. */
export const DOM_LIMIT_MS = 15_000
/** The browser lane's specs and feel scenarios. */
export const BROWSER_LIMIT_MS = 20_000
/** The Electron lane: a real app per test; 30 s beside the browser lane, as in every desktop job. */
export const ELECTRON_LIMIT_MS = 15_000

/**
 * How many times its limit a test may take: 2 in a lane the plan runs at a lower priority beside another
 * (JUNO_TEST_TIME_SCALE, scripts/plan.mjs), times a stress run's slowdown (JUNO_STRESS_SCALE, scripts/remote/workers.sh).
 */
export const limitScale = (): number => Number(process.env.JUNO_TEST_TIME_SCALE ?? 1) * Number(process.env.JUNO_STRESS_SCALE ?? 1)
