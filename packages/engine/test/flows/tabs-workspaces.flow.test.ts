/**
 * The tabs across a sign-out and a sign-in to another workspace in one run:
 * the saved tabs are read through one live query for every workspace, so
 * the first workspace's answer must not stand in for the second's.
 */
import { afterEach, expect, it } from 'bun:test'
import { Exit } from 'effect'
import { mainTopicOf, prefsGet, sessionImportFromSlackApp, sessionSignOut } from '@juno/contract'
import { startFakeSlack, TEAM, type FakeSlack } from '@juno/fake-slack'
import { galleryPlace, liveQuery, openPlace, runCommand, signedInAtom, TABS_PREF, tabsAtom, tabTopic, topicPlace, updateTabs, whenTabsKnown } from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { syncedEngine } from '../synced'

const engines: RunningEngine[] = []
const fakes: FakeSlack[] = []
afterEach(async () => {
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
  for (const fake of fakes.splice(0)) await fake.close()
})

const OTHER_TEAM = 'T0OTHER'
const ENG = mainTopicOf('C0ENG')
const topicsShown = (engine: RunningEngine) => engine.registry.get(tabsAtom).tabs.map(tabTopic)

it('a tab change made just after signing in to another workspace neither shows the first workspace\'s tabs nor saves them there', async () => {
  const engine = await syncedEngine(engines)
  const { registry, main } = engine
  // The atoms the tabs read each workspace's saved pref through.
  const savedTabs = liveQuery(prefsGet)({ key: TABS_PREF, workspace: TEAM.id })
  const otherSavedTabs = liveQuery(prefsGet)({ key: TABS_PREF, workspace: OTHER_TEAM })
  const release = registry.mount(tabsAtom)
  try {
    await (whenTabsKnown(registry) ?? Promise.resolve())
    updateTabs(registry, (tabs) => openPlace(tabs, topicPlace(ENG)))
    expect(topicsShown(engine)).toContain(ENG)
    await waitFor(
      () => {
        const saved = registry.get(savedTabs)
        return saved._tag === 'Success' && JSON.stringify(saved.value).includes(ENG) ? true : undefined
      },
      WAIT_MS,
      "the first workspace's saved tabs",
    )

    expect(Exit.isSuccess(await runCommand(registry, sessionSignOut, undefined))).toBe(true)
    await engine.status('signedOut')

    // Signing in to another workspace: its saved tabs are read once it opens, before Slack has confirmed the session.
    const other = await startFakeSlack({ teamId: OTHER_TEAM })
    fakes.push(other)
    main.signInNextWith(other)
    const hold = engine.holdLiveRead('prefs.get')
    expect(Exit.isSuccess(await runCommand(registry, sessionImportFromSlackApp, undefined))).toBe(true)
    await waitFor(() => (registry.get(signedInAtom)?.teamId === OTHER_TEAM ? true : undefined), WAIT_MS, 'the other workspace signed in')
    await hold.reached

    // Until that answer arrives the tabs are not known: a change neither applies nor saves.
    expect(whenTabsKnown(registry)).toBeDefined()
    expect(updateTabs(registry, (tabs) => openPlace(tabs, galleryPlace())).tabs).toEqual([])

    hold.release()
    await (whenTabsKnown(registry) ?? Promise.resolve())
    expect(topicsShown(engine)).not.toContain(ENG)
    const saved = registry.get(otherSavedTabs)
    expect(saved._tag === 'Success' ? saved.value : saved._tag).toBeNull()
  } finally {
    release()
  }
})
