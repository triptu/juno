import { lazy } from 'react'

/** The Juno chunk, loaded once. */
export const loadJuno = (() => {
  let loading: Promise<typeof import('./chunk')> | undefined
  return () => (loading ??= import('./chunk'))
})()

export const JunoTab = lazy(() => loadJuno().then((chunk) => ({ default: chunk.JunoTab })))
export const JunoPageTab = lazy(() => loadJuno().then((chunk) => ({ default: chunk.JunoPageTab })))
export const JunoPanel = lazy(() => loadJuno().then((chunk) => ({ default: chunk.JunoPanel })))
// Settings' Juno, Connections and Backup & This Mac sections.
export const JunoSettings = lazy(() => loadJuno().then((chunk) => ({ default: chunk.JunoSettings })))
export const JunoConnections = lazy(() => loadJuno().then((chunk) => ({ default: chunk.JunoConnections })))
export const JunoBackup = lazy(() => loadJuno().then((chunk) => ({ default: chunk.JunoBackup })))
