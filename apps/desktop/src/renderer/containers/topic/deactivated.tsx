import { ReadOnlyNote } from '@juno/views'

/** In the composer's place in a DM with a deactivated person (SPEC 7, "People"). Its own chunk: it is rare. */
export function DeactivatedNote({ name }: { readonly name: string }) {
  return <ReadOnlyNote text={`${name}'s account is deactivated. You can read this conversation but not reply.`} />
}
