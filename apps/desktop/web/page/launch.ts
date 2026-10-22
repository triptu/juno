/**
 * Launch preferences in the web shell. Electron keeps them in main's
 * `launch.json` and passes them to the page in its address (`theme`,
 * `accent`, `density`, `topicTitleLines`, `privacy`, `sidebar`), which
 * `@juno/state` reads as its modules load. Here they live in this origin's
 * localStorage, and this module writes them into the address first, so the
 * first render already has them. A parameter already in the address wins,
 * so `?theme=dark` opens dark whatever was saved.
 *
 * `tour=manual` keeps the welcome card from showing by itself, as under
 * JUNO_E2E.
 */
const STORAGE_KEY = 'juno.web.launch'

type Saved = Partial<Record<'theme' | 'accent' | 'density' | 'topicTitleLines' | 'privacy' | 'sidebar' | 'hideWhileSharing', string>>

function read(): Saved {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return typeof value === 'object' && value !== null ? (value as Saved) : {}
  } catch {
    return {}
  }
}

/** Saves one preference and keeps the address in step, so a reload shows it. */
export function saveLaunch(name: keyof Saved, value: string | undefined): void {
  const saved = { ...read(), [name]: value }
  if (value === undefined) delete saved[name]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  if (name === 'hideWhileSharing') return
  const url = new URL(location.href)
  if (value === undefined) url.searchParams.delete(name)
  else url.searchParams.set(name, value)
  history.replaceState(history.state, '', url)
}

export function savedLaunch(name: keyof Saved): string | undefined {
  return read()[name]
}

/** Writes the saved preferences into the address. Runs before `@juno/state` loads. */
export function applyLaunch(): void {
  const url = new URL(location.href)
  const saved = read()
  for (const name of ['theme', 'accent', 'density', 'topicTitleLines', 'privacy', 'sidebar'] as const) {
    const value = saved[name]
    if (value !== undefined && !url.searchParams.has(name)) url.searchParams.set(name, value)
  }
  if (!url.searchParams.has('tour')) url.searchParams.set('tour', 'manual')
  history.replaceState(history.state, '', url)
}
