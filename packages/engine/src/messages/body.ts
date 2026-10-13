/**
 * The compile-time check that `@juno/richtext`'s `MessageBody` and the
 * contract's `MessageBody` schema describe the same thing
 * (`packages/contract/src/body.ts`). The engine builds bodies with
 * richtext and sends them through the contract's codec, so a node kind one
 * side has and the other lacks would be dropped or rejected on the wire.
 * Changing either side without the other fails `pnpm typecheck` here.
 */
import type { MessageBody as WireBody } from '@juno/contract'
import type { MessageBody as RichBody } from '@juno/richtext'

type Assert<T extends true> = T

/** Every body richtext builds encodes with the contract's schema. */
export type RichtextFitsTheWire = Assert<[RichBody] extends [WireBody] ? true : false>

/** Every body the wire carries is one richtext can build. */
export type WireFitsRichtext = Assert<[WireBody] extends [RichBody] ? true : false>
