import { lazy } from 'react'

/** The Juno chunk, loaded once. */
export const loadJuno = (() => {
  let loading: Promise<typeof import('./chunk')> | undefined
  return () => (loading ??= import('./chunk'))
})()

export const JunoTab = lazy(() => loadJuno().then((chunk) => ({ default: chunk.JunoTab })))
export const JunoPageTab = lazy(() => loadJuno().then((chunk) => ({ default: chunk.JunoPageTab })))
export const JunoPanel = lazy(() => loadJuno().then((chunk) => ({ default: chunk.JunoPanel })))
