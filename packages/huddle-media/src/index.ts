/**
 * The media session's types. The Chime implementation is
 * `@juno/huddle-media/chime`, imported with `import()` on join so the SDK
 * stays out of the initial bundle; the fake is `@juno/huddle-media/fake`.
 */
export type { MediaSession, MediaSnapshot } from './types.ts'
