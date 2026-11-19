// Unread only against the fake Slack (SPEC 5): a topic the list showed stays while a tab shows it, after it
// is read, with its actual read state and its newest message. A reply you send after reading it, from Juno or
// from another Slack client, is the row's preview, though the unread list no longer carries the row.
import { afterEach, expect, it } from 'bun:test'
import { readsMarkRead } from '@juno/contract'
import { SELF_ID } from '@juno/fake-slack'
import {
  defaultTopicListFilter,
  openPlace,
  runCommand,
  sendMessage,
  sidebarFilterAtom,
  sidebarListAtom,
  tabsAtom,
  topicPlace,
  updateTabs,
  whenTabsKnown,
} from '@juno/state'
import { waitFor, WAIT_MS, type RunningEngine } from '../harness'
import { valueOf } from '../scenario'
import { step } from '../step'
import { syncedEngine } from '../synced'

const engines: Array<RunningEngine> = []
const unmounts: Array<() => void> = []
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) unmount()
  for (const engine of engines.splice(0).toReversed()) await engine.stop()
})

it('in Unread only, a read DM a tab still shows takes your newest message as its preview, sent from Juno or from Slack', async () => {
  const engine = await syncedEngine(engines)
  const { registry, fake } = engine
  registry.set(sidebarFilterAtom, { ...defaultTopicListFilter, unreadOnly: true })
  unmounts.push(registry.mount(sidebarListAtom), registry.mount(tabsAtom))
  await (whenTabsKnown(registry) ?? Promise.resolve())
  const sam = 'm:D0SAM'
  const row = () => registry.get(sidebarListAtom).rows.get(sam)
  const shows = (text: string, label: string) => waitFor(() => (row()?.preview.text === text ? row() : undefined), WAIT_MS, label)

  fake.injectMessage({ channel: 'D0SAM', user: 'U0SAM', text: 'Can you look at the deck before 3?' })
  await shows('Can you look at the deck before 3?', 'the unread DM')
  updateTabs(registry, (tabs) => openPlace(tabs, topicPlace(sam)))
  valueOf(await runCommand(registry, readsMarkRead, { id: sam }))
  await waitFor(() => (row()?.unreadCount === 0 ? true : undefined), WAIT_MS, 'the read DM kept while its tab shows it')

  await step('a reply sent from Juno', async () => {
    valueOf(await sendMessage(registry, { kind: 'channel', channelId: 'D0SAM' }, 'Looking at it now', sam))
    expect((await shows('Looking at it now', 'the reply in the row'))!.preview.sender).toBe('You')
  })

  await step('a reply sent from another Slack client', async () => {
    fake.injectMessage({ channel: 'D0SAM', user: SELF_ID, text: 'Left notes on slide 4' })
    expect((await shows('Left notes on slide 4', 'the reply from Slack in the row'))!.preview.sender).toBe('You')
  })
})
