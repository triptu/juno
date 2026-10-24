/**
 * Settings › About's diagnostics (SPEC section 14): each process's CPU and
 * memory from main, and the plain-text report Copy diagnostics puts on the
 * clipboard. Main's idle CPU check also hears the view and whether a sync
 * runs from here. Nothing here carries a title, a name, an id or message
 * text: a view is its kind ("topic", "Juno page activity").
 */
import { Effect, Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { AppState, Diagnostics, DiagnosticsCopy, SyncLogInput, engineOutbox, type AppInfo, type ProcessReading } from '@juno/contract'
import type { JunoBridge } from '@juno/contract/channels'
import { command } from './atoms'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import { registry } from './client'
import { engineStatusAtom, syncFailureAtom } from './engine'
import { junoPanelViewAtom } from './junoPanel'
import { activeTab, currentPlace, tabsAtom, type Place, type Tabs } from './tabs'

declare const window: { readonly juno: JunoBridge }

const placeKind = (place: Place): string => {
  switch (place.kind) {
    case 'topic':
      return 'topic'
    case 'home':
      return 'Home'
    case 'allTopics':
      return 'All topics'
    case 'devLog':
      return 'Developer log'
    case 'settings':
      return `Settings ${place.section}`
    case 'juno':
      return 'Juno tab'
    case 'junoPage':
      return `Juno page ${place.page}`
    case 'huddle':
      return 'Huddle'
    case 'gallery':
      return place.pictureId === undefined ? 'Gallery' : 'Picture'
    case 'search':
      return 'Search'
  }
}

/** The active tab's kind, the Juno panel's page when it is open, and the number of tabs: "topic with the Juno panel (chat), 3 tabs". */
function describeView(tabs: Tabs, panelView: string | undefined): string {
  const tab = activeTab(tabs)
  if (tab === undefined) return 'no tab'
  const panel = tab.junoPanel === true && currentPlace(tab).kind === 'topic' ? ` with the Juno panel (${panelView ?? 'chat'})` : ''
  return `${placeKind(currentPlace(tab))}${panel}, ${tabs.tabs.length} ${tabs.tabs.length === 1 ? 'tab' : 'tabs'}`
}

/** Every open tab by kind, in strip order: "Home, topic, Juno page activity". */
export const describeTabs = (tabs: Tabs): string => tabs.tabs.map((tab) => placeKind(currentPlace(tab))).join(', ')

/** The view and whether a sync runs, as main's idle check hears them. */
export const appStateAtom = Atom.make((get): AppState => {
  const tabs = get(tabsAtom)
  const tab = activeTab(tabs)
  const status = get(engineStatusAtom)
  const syncing = status._tag !== 'Success' || status.value.syncing || status.value.phase._tag === 'booting' || status.value.phase._tag === 'catching-up'
  const view = describeView(tabs, tab === undefined ? undefined : get(junoPanelViewAtom(tab.id)))
  return { view: view.slice(0, 40), syncing }
}).pipe(Atom.withEquality((a: AppState, b: AppState) => a.view === b.view && a.syncing === b.syncing))

/** Tells main each change of `appStateAtom`. Mount once for the window. */
export const reportAppStateAtom = Atom.make((get) => {
  const state = get(appStateAtom)
  void window.juno.app.reportState(Schema.encodeSync(AppState)(state)).catch(() => {})
})

/** One reading from main. Settings › About reads it again every few seconds while it shows. */
export const readDiagnostics = Effect.tryPromise({
  try: () => window.juno.app.diagnostics(),
  catch: (cause) => new Error('app.diagnostics failed', { cause }),
}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Diagnostics)))

async function readOutbox() {
  const atom = command(engineOutbox)
  const unmount = registry.mount(atom)
  registry.set(atom, undefined)
  return Effect.runPromiseExit(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }).pipe(Effect.timeout(2_000))).finally(unmount)
}

/** Copy diagnostics: `report` and the outbox counts go to main, which adds the macOS version and each process's recent warnings and writes the clipboard. */
export async function copyDiagnostics(report: string): Promise<boolean> {
  const outbox = await readOutbox()
  const text = [
    report,
    'Outbox counts by kind and state:',
    ...(outbox._tag === 'Failure' || outbox.value === null ? ['  Unavailable'] : outbox.value.length === 0 ? ['  Empty'] : outbox.value.map((row) => `  ${row.kind} ${row.state}: ${row.count}`)),
  ].join('\n')
  return (await window.juno.app.copyDiagnostics(Schema.encodeSync(DiagnosticsCopy)({ report: text }))) === 'copied'
}

export async function showLogs(): Promise<void> { await window.juno.app.showLogs() }

/** The sync notice's Copy log: main puts the versions, this phase and its reason, and the end of engine.log on the clipboard. */
export async function copySyncLog(): Promise<boolean> {
  const status = registry.get(engineStatusAtom)
  const reason = registry.get(syncFailureAtom)
  const input: SyncLogInput = { phase: status._tag === 'Success' ? status.value.phase._tag : 'unknown', ...(reason === undefined ? {} : { reason }) }
  return (await window.juno.app.copySyncLog(Schema.encodeSync(SyncLogInput)(input))) === 'copied'
}

/** "12.3 %" with one decimal under 10 and none above. */
export const formatCpu = (cpu: number): string => `${cpu < 10 ? cpu.toFixed(1) : cpu.toFixed(0)} %`

/** One process as the table shows it. */
const processLine = (reading: ProcessReading): string => `${reading.name} (${reading.type}, pid ${reading.pid}): CPU ${formatCpu(reading.cpu)}, memory ${reading.memoryMb} MB`

interface ReportInput {
  readonly app: AppInfo | undefined
  readonly diagnostics: Diagnostics
  /** The engine line from About: "Engine live". */
  readonly engineLine: string
  /** The active tab, from `describeView`. */
  readonly view: string
  /** Every tab, from `describeTabs`. */
  readonly tabs: string
  readonly at: Date
}

/** The plain text Copy diagnostics puts on the clipboard: versions, processes, the view, the engine and the agent. */
export function diagnosticsReport({ app, diagnostics, engineLine, view, tabs, at }: ReportInput): string {
  const build = app === undefined ? 'Juno, version unknown' : `${app.name} ${app.version} on ${app.platform}, Electron ${app.electron}`
  return [
    'Juno diagnostics',
    build,
    `At ${at.toISOString()}, ${Math.round(diagnostics.uptime / 60)} minutes after launch`,
    `View: ${view}; ${diagnostics.window}`,
    `Tabs: ${tabs}`,
    `Engine: ${engineLine} (process ${diagnostics.engine})`,
    `Juno agent: ${diagnostics.agent}`,
    'Processes, CPU as a share of one core over the last few seconds:',
    ...diagnostics.processes.map((reading) => `  ${processLine(reading)}`),
    ...(diagnostics.busyWhileIdle === undefined ? [] : [`Busy while idle: ${diagnostics.busyWhileIdle}`]),
    '',
  ].join('\n')
}
