/**
 * The media session's types (`types.ts`). Each is exported here once
 * something outside the package imports it; knip fails on an unused export.
 * The Chime implementation is `@juno/huddle-media/chime`, imported with
 * `import()` on join so the SDK stays out of the initial bundle; the fake is
 * `@juno/huddle-media/fake`.
 */
export type { Devices, EndReason, MediaSession, MediaSnapshot } from './types.ts'
