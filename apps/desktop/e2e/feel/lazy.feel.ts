// The parts that load their code on first use (`chunk()` and `usePreloaded`
// in `containers/chunks.ts`): the peek, the @ # : list, the link editor, the
// edit field, the send check bar and the sync card. Each is opened first
// thing after a launch, and must answer in the frames after the key, whole,
// where it stays, with nothing else moving.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { Locator } from '@playwright/test'
import { expect } from '../fixtures'
import type { Juno } from '../driver/juno'
import { answersWithin } from './answers'
import { happened, landsAndStays, noFlicker, noLayoutShift, opensWhole, staysDrawn } from './checks'
import { Feel, test } from './feel'
import { tag } from './pane'

test.describe.configure({ timeout: 240_000 })

// Starts signed in and synced (README, "Synced start"), but for the sync card, which needs the first sync.
const syncedTest = test.extend({ synced: true })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ENG_MAIN = '#eng'
/** Shares four words with the staging bill thread in #eng, so the send check offers the thread. */
const BILL_REPLY = 'the preview environments reaper should cut the staging bill'

/** Waits until the model's wrong-place answer for a draft typed after `since` is stored. */
async function routeAnswered(userData: string, teamId: string, since: number): Promise<void> {
  await expect
    .poll(() => {
      const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'cache.db'), { readOnly: true })
      try {
        const row = db.prepare(`SELECT max(CAST(created_at AS INTEGER)) AS at FROM ai_cache WHERE task = 'routeCheck' AND model != ''`).get() as { at: number | null }
        return row.at ?? 0
      } finally {
        db.close()
      }
    }, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(since)
}

/** Selects `words` in the composer, as a drag over them would. */
async function select(field: Locator, words: string): Promise<void> {
  await field.evaluate((element, wanted) => {
    const textarea = element as HTMLTextAreaElement
    const at = textarea.value.indexOf(wanted)
    textarea.focus()
    textarea.setSelectionRange(at, at + wanted.length)
  }, words)
}

/** The peek: hold ⌥ over a row. */
async function peek(feel: Feel, app: Juno): Promise<void> {
  const { win, sidebar } = app
  await sidebar.row(RINA).hover()
  const PEEK = '[role="dialog"][aria-roledescription="peek"]'
  await feel.run(
    {
      name: 'lazy-peek',
      title: 'Hold ⌥ over a sidebar row first thing after launch: the peek opens whole within three frames, where it stays',
      probes: [
        { kind: 'rect', name: 'peek', selector: PEEK },
        { kind: 'text', name: 'peekText', selector: PEEK },
        { kind: 'opacity', name: 'peekOpacity', selector: PEEK },
      ],
      checks: [
        answersWithin('peek', 'keydown', 'the peek', { from: 'key', frames: 3 }),
        opensWhole('peek', 'peekText', 'the peek', { from: 'key' }),
        landsAndStays('peek', 'the peek', { from: 'key' }),
        staysDrawn('peekOpacity', 'the peek'),
        noLayoutShift(),
      ],
    },
    async (rec) => {
      await rec.mark('key')
      await win.keyboard.down('Alt')
      await app.peek.expectShowing(RINA)
      await win.waitForTimeout(200)
    },
  )
  await app.peek.release()
  await app.peek.expectClosed()
}

/** The @ list: the first key in a reply. */
async function suggestions(feel: Feel, app: Juno): Promise<void> {
  const { win, sidebar, topic } = app
  await sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.composer.focus()
  const LIST = '[data-topic-view] [data-mention-suggestions]'
  const field = await tag(topic.composerField, 'lazy-field')
  await feel.run(
    {
      name: 'lazy-suggestions',
      title: 'Type "@" in a reply first thing after launch: the list opens whole in the next frames, and the composer holds still',
      probes: [
        { kind: 'rect', name: 'list', selector: LIST },
        { kind: 'text', name: 'listText', selector: LIST },
        { kind: 'rect', name: 'field', selector: field },
      ],
      checks: [
        answersWithin('list', 'keydown', 'the @ list', { from: 'key', frames: 2 }),
        opensWhole('list', 'listText', 'the @ list', { from: 'key' }),
        landsAndStays('list', 'the @ list', { from: 'key' }),
        landsAndStays('field', 'the composer'),
        noLayoutShift(),
      ],
    },
    async (rec) => {
      await rec.mark('key')
      await win.keyboard.press('@')
      await expect(topic.suggestion('Maya')).toBeVisible()
    },
  )
  await win.keyboard.press('Escape')
  await topic.composer.fill('')
}

/** The link editor: ⌘K on selected words. */
async function linkEditor(feel: Feel, app: Juno): Promise<void> {
  const { win, topic } = app
  await topic.composer.fill('the plan is ready')
  await select(topic.composer, 'the plan')
  const field = await tag(topic.composerField, 'lazy-field')
  const EDITOR = '[data-link-editor]'
  await feel.run(
    {
      name: 'lazy-link-editor',
      title: 'Press ⌘K on selected words first thing after launch: the link editor opens whole, where it stays',
      probes: [
        { kind: 'rect', name: 'editor', selector: EDITOR },
        { kind: 'text', name: 'editorText', selector: EDITOR },
        { kind: 'rect', name: 'field', selector: field },
      ],
      checks: [
        // ⌘K comes from the app menu, so it is counted from the mark, with frames for the menu's message.
        answersWithin('editor', 'mark', 'the link editor', { from: 'key', frames: 3 }),
        opensWhole('editor', 'editorText', 'the link editor', { from: 'key' }),
        landsAndStays('editor', 'the link editor', { from: 'key' }),
        landsAndStays('field', 'the composer'),
        noLayoutShift(),
      ],
    },
    async (rec) => {
      await rec.mark('key')
      await app.palette.shortcut()
      await expect(topic.linkEditor.url).toBeFocused()
    },
  )
  await win.keyboard.press('Escape')
  await topic.composer.fill('')
}

/** The edit field: ↑ then E on your own message. */
async function editField(feel: Feel, app: Juno): Promise<void> {
  const { win, sidebar, topic } = app
  await sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await topic.composer.press('ArrowUp')
  const row = topic.message('Shiping the fix today')
  await expect(row).toBeFocused()
  await feel.run(
    {
      name: 'lazy-edit-field',
      title: 'Press E on your message first thing after launch: the edit field replaces its body in the next frames, focused',
      probes: [
        { kind: 'rect', name: 'edit', selector: '[data-topic-view] [data-inline-edit]' },
        { kind: 'count', name: 'editing', within: '[data-topic-view]', selector: '[data-editing] [data-inline-edit]' },
        { kind: 'rect', name: 'composer', selector: '[data-topic-view] [data-composer-field]' },
      ],
      regions: { pane: '[data-topic-view] [data-scroll]' },
      checks: [
        answersWithin('edit', 'keydown', 'the edit field', { from: 'key', frames: 2 }),
        landsAndStays('edit', 'the edit field', { from: 'key' }),
        landsAndStays('composer', 'the composer'),
        noFlicker('pane', 'the messages'),
      ],
    },
    async (rec) => {
      await rec.mark('key')
      await row.press('e')
      await expect(topic.list.getByRole('textbox', { name: 'Edit message' })).toBeFocused()
    },
  )
  await win.keyboard.press('Escape')
}

/** The send check bar: a reply typed into Main, sent. */
async function sendCheck(feel: Feel, app: Juno, userData: string, teamId: string): Promise<void> {
  const { topic } = app
  const since = Date.now()
  await topic.composer.fill(BILL_REPLY)
  await routeAnswered(userData, teamId, since)
  // The textarea, not the field's box, which grows upwards to hold the bar.
  const mainField = await tag(topic.composer, 'lazy-main-field')
  const BAR = '[data-topic-view] [data-send-check]'
  await feel.run(
    {
      name: 'lazy-send-check',
      title: 'Send a reply typed into Main first thing after launch: the check bar shows whole in the next frames, and the field holds still',
      probes: [
        { kind: 'rect', name: 'bar', selector: BAR },
        { kind: 'text', name: 'barText', selector: BAR },
        { kind: 'rect', name: 'field', selector: mainField },
      ],
      checks: [
        // The bar waits for the engine's check of the draft: a round trip, within the overlays' 50 ms.
        answersWithin('bar', 'keydown', 'the check bar', { from: 'key', frames: 3 }),
        opensWhole('bar', 'barText', 'the check bar', { from: 'key' }),
        landsAndStays('bar', 'the check bar', { from: 'key' }),
        // The bar grows the composer upwards; the text stays where it was.
        landsAndStays('field', 'the field', { tolerance: 0 }),
      ],
    },
    async (rec) => {
      await rec.mark('key')
      await topic.composer.press('Enter')
      await expect(topic.checkBar.bar).toContainText('Looks like a reply to')
    },
  )
}

syncedTest('each lazy part opens whole and on time the first time after a launch', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, fake, relaunch, userData, studio }) => {
  // Your own message in #eng, for the edit field.
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.send('Shiping the fix today')
  await juno.topic.expectSent('Shiping the fix today')

  const app = await relaunch()
  const feel = new Feel(app.win, studio, 'lazy parts')
  await app.sidebar.expectRows()

  await peek(feel, app)
  await suggestions(feel, app)
  await linkEditor(feel, app)
  await editField(feel, app)
  await sendCheck(feel, app, userData, fake.teamId)
})

test('the sync card shows whole with the first sync and stays put', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, fake, feel }) => {
  fake.holdNext({ method: 'client.userBoot', before: true })
  fake.holdNext({ method: 'conversations.history', before: true })
  await juno.signIn()
  const SYNC = 'aside[aria-label="Sidebar"] section[aria-label="Sync"]'
  await feel.run(
    {
      name: 'lazy-sync-card',
      title: "Sign in for the first time: the sidebar's sync card shows whole with the first sync, where it stays, and the list above never moves for it",
      probes: [
        { kind: 'rect', name: 'card', selector: SYNC },
        { kind: 'text', name: 'cardText', selector: SYNC },
        { kind: 'opacity', name: 'cardOpacity', selector: SYNC },
      ],
      regions: { sidebar: 'aside[aria-label="Sidebar"]' },
      checks: [
        happened('the card showed', (r) => r.frames.some((f) => f.values['card'] !== null)),
        // Until the first sync ends, when the card leaves by design.
        opensWhole('card', 'cardText', 'the sync card', { to: 'release' }),
        landsAndStays('card', 'the sync card', { to: 'release' }),
        staysDrawn('cardOpacity', 'the sync card', { to: 'release' }),
        noLayoutShift({ region: 'sidebar', to: 'release' }),
        noFlicker('sidebar', 'the sidebar', { to: 'release' }),
      ],
    },
    async (rec) => {
      await rec.mark('wait')
      await juno.sidebar.expectEmpty('Getting your topics')
      await expect(juno.sidebar.syncStatus).toHaveText('Syncing with Slack')
      await juno.win.waitForTimeout(500)
      await rec.mark('release')
      fake.release({ method: 'client.userBoot' })
      fake.release({ method: 'conversations.history' })
      await juno.sidebar.expectRows()
    },
  )
})
