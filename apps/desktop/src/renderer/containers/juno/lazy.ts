import { chunk } from '../chunks'

/** The Juno chunk, loaded once. */
const juno = chunk(() => import('./chunk'))
export const loadJuno = juno.load

export const JunoTab = juno.component((module) => module.JunoTab)
export const JunoPageTab = juno.component((module) => module.JunoPageTab)
export const JunoPanel = juno.component((module) => module.JunoPanel)
// Settings' Juno, Connections and Backup & This Mac sections.
export const JunoSettings = juno.component((module) => module.JunoSettings)
export const JunoConnections = juno.component((module) => module.JunoConnections)
export const JunoBackup = juno.component((module) => module.JunoBackup)
