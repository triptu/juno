import { useEffect } from 'react'

declare global {
  interface Window {
    /** Steps the gallery's tests drive without a button, for changes that are meant to move a row (a new row at the end of the list). */
    __fixtureControls?: Record<string, () => void>
  }
}

/** Registers `step` under `name` on `window.__fixtureControls` while the scene is mounted. */
export function useFixtureControl(name: string, step: () => void): void {
  useEffect(() => {
    const controls = (window.__fixtureControls ??= {})
    controls[name] = step
    return () => {
      delete controls[name]
    }
  }, [name, step])
}
