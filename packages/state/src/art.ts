/** Redraw commands; topic art is read from topic and sidebar snapshots. */
import { artRedraw } from '@juno/contract'
import { runCommand } from './atoms'
import type { Registry } from './client'

/** "Redraw": a new drawing for the topic, in place of the stored one. Resolves when the engine has stored it. */
export const redrawTopic = (registry: Registry, id: string) => runCommand(registry, artRedraw, { id })
