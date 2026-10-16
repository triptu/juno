import { Invalidation, StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'

export type Writer = Effect.Effect<void, SqlError, StoreWriter | Invalidation>

export const invalidate = (keys: Parameters<Invalidation['Service']['invalidate']>[0]) => Invalidation.use((i) => i.invalidate(keys))
