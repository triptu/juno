/** Adapts the shared sheet commands to the AgentHost wire. No Slack writes. */
import { Effect, Schema } from 'effect'
import { AgentHostError, type HostViewDraft, type HostViewUndo } from '@juno/agent-contract'
import { SavedView, ViewDraft } from '@juno/contract'
import { saveView, deleteView, undoView } from '../viewCommands'

const rejected = () => new AgentHostError({ reason: 'rejected', message: 'The view is invalid.' })
const commandError = (error: { readonly _tag: 'NotFound' | 'NotSignedIn' }) => new AgentHostError({
  reason: error._tag === 'NotSignedIn' ? 'signedOut' : 'notFound', message: 'The view could not be changed.',
})
export const save = (view: typeof HostViewDraft.Type, id?: string) =>
  Schema.decodeUnknownEffect(ViewDraft)({ ...view, ...(id === undefined ? {} : { id }) }).pipe(
    Effect.mapError(rejected),
    Effect.flatMap((draft) => saveView(draft).pipe(Effect.mapError(commandError))),
    Effect.map(({ id, before, after }) => ({ id, undo: { id, expected: after, restore: before } })),
  )
export const remove = (id: string) => deleteView(id).pipe(
  Effect.mapError(commandError), Effect.map(({ undo }) => ({ id, undo: { id, expected: null, restore: undo.view } })),
)
export const undo = (input: typeof HostViewUndo.Type) => Effect.gen(function* () {
  const decode = (value: typeof input.expected) => value === null ? Effect.succeed(null) : Schema.decodeUnknownEffect(SavedView)(value).pipe(Effect.mapError(rejected))
  const expected = yield* decode(input.expected)
  const restore = yield* decode(input.restore)
  if (expected?.id !== undefined && expected.id !== input.id || restore?.id !== undefined && restore.id !== input.id) return yield* rejected()
  const applied = yield* undoView(input.id, expected, restore).pipe(Effect.mapError(commandError))
  if (!applied) return yield* new AgentHostError({ reason: 'stale', message: 'The view changed since this action.' })
})
