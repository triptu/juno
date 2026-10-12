/**
 * Effect Schemas for every Slack payload Juno reads or sends.
 *
 * Decoding is tolerant: unknown keys are dropped, unknown block elements and
 * socket frame types become `{ type: 'unknown', raw }`. Encoding is used by
 * the fake so its responses cannot drift from what the client expects.
 */
export * from './common'
export * from './ts'
export * from './blocks'
export * from './message'
export * from './users'
export * from './conversations'
export * from './boot'
export * from './threads'
export * from './chat'
export * from './search'
export * from './files'
export * from './rtm'
export * from './methods'
