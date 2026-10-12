/**
 * Effect Schemas for every Slack payload Juno reads or sends.
 *
 * Decoding is tolerant: unknown keys are dropped, unknown block elements and
 * socket frame types become `{ type: 'unknown', raw }`. Encoding is used by
 * the fake so its responses cannot drift from what the client expects.
 */
export * from './common.ts'
export * from './ts.ts'
export * from './blocks.ts'
export * from './message.ts'
export * from './users.ts'
export * from './conversations.ts'
export * from './boot.ts'
export * from './threads.ts'
export * from './chat.ts'
export * from './search.ts'
export * from './files.ts'
export * from './rtm.ts'
export * from './methods.ts'
