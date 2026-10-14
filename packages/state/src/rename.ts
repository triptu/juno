/**
 * Which title is a field for Rename (SPEC 5, inventory 3.2 and 5): a
 * sidebar row's, or a topic header's. One at a time; Rename from a row's
 * menu edits the row, from the header's title menu the header.
 */
import * as Atom from 'effect/reactivity/Atom'

export interface RenameTarget {
  readonly id: string
  readonly where: 'row' | 'header'
}

export const renamingAtom = Atom.make<RenameTarget | undefined>(undefined).pipe(Atom.keepAlive)

/** Whether the row of topic `id` is renaming. A row reads only its own. */
export const rowRenamingAtom = Atom.family((id: string) => Atom.make((get) => isRenaming(get(renamingAtom), id, 'row')))

/** Whether the header of topic `id` is renaming. */
export const headerRenamingAtom = Atom.family((id: string) => Atom.make((get) => isRenaming(get(renamingAtom), id, 'header')))

const isRenaming = (target: RenameTarget | undefined, id: string, where: RenameTarget['where']) => target?.id === id && target.where === where
