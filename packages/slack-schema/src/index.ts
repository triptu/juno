/**
 * @juno/slack-schema: Effect Schemas for every Slack payload Juno reads or
 * sends, and the branded message timestamp `Ts` with its helpers.
 *
 * Decoding is tolerant: unknown keys are dropped, unknown block elements and
 * socket frame types become `{ type: 'unknown', raw }`. Encoding is used by
 * the fake so its responses cannot drift from what the client expects.
 *
 * This package depends on `effect` only. The client (`@juno/slack`), the fake,
 * `richtext`, `domain` and the store all import their Slack shapes from here.
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
export * from './dnd.ts'
export * from './huddles.ts'
export * from './drafts.ts'
export * from './methods.ts'

export * from './emoji.ts'
