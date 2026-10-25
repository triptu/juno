// The welcome card (SPEC 4, "The welcome"): it appears on Home once the
// first sync has rows, ticks each hint where it is done, says "You're all
// set" with all three, and goes on Done. The card keeps one place: nothing
// around it moves, it is drawn once, and a tick or a return to Home never
// plays it in again.
import type { Page } from '@playwright/test'
import type { FakeSlack } from '@juno/fake-slack'
import { expect } from '../fixtures'
import type { Juno } from '../driver/juno'
import { firstFrameRight, happened, landsAndStays, noFlicker, noLayoutShift, opensWhole, shotOfFrame, staysDrawn, switchesOnce, type Check } from './checks'
import { type Feel, test as feelTest } from './feel'
import type { Probe, ProbeFrame } from './recorder'

const RINA = 'Rina finished the onsite'
const POSTGRES = 'Draft plan is in the doc'
const HOME = '[data-home]'
// The card on screen: its room stays on Home, hidden, before it shows and after it goes.
const CARD = `${HOME} section[data-welcome]:not([aria-hidden])`
const ROOM = `${HOME} section[data-welcome]`

/** The app shows the card by itself, as outside tests. */
const test = feelTest.extend({ tour: true })

const card: ReadonlyArray<Probe> = [
  { kind: 'rect', name: 'card', selector: CARD },
  { kind: 'box', name: 'room', selector: ROOM },
  { kind: 'text', name: 'cardText', selector: CARD },
  { kind: 'text', name: 'heading', selector: `${CARD} h3` },
  { kind: 'opacity', name: 'cardOpacity', selector: CARD },
  { kind: 'boxes', name: 'hints', selector: `${CARD} [data-welcome-hint]`, key: 'data-welcome-hint' },
  { kind: 'count', name: 'ticked', within: HOME, selector: 'section[data-welcome]:not([aria-hidden]) [data-welcome-hint][data-done]' },
  { kind: 'box', name: 'chip', selector: `${HOME} [data-home-write] [aria-label^="Send to:"]` },
  { kind: 'box', name: 'field', selector: `${HOME} [data-composer-field]` },
  { kind: 'boxes', name: 'items', selector: `${HOME} [data-home-item]`, key: 'data-home-item' },
]

/** What sits around the card holds: the field, its chip and Home's rows. */
const aroundHolds = (options: { readonly from?: string } = {}): Check[] => [
  landsAndStays('chip', 'the destination chip', { ...options, tolerance: 0 }),
  landsAndStays('field', 'the field', { ...options, tolerance: 0 }),
  landsAndStays('items', "Home's rows", options),
]

const ticks = (values: ProbeFrame['values']) => (typeof values['ticked'] === 'number' ? values['ticked'] : 0)

/** The hint ticks while its action shows: the peek was open in the first frame with the tick. */
const tickedWhileShown = (probe: string, label: string): Check => (evidence) => {
  const name = `the tick shows while the ${label} is open`
  const first = evidence.recording.frames.find((frame) => ticks(frame.values) > 0)
  if (first === undefined) return { name, status: 'fail', detail: 'the hint never ticked', shots: [] }
  const shot = shotOfFrame(evidence, first.index)
  return first.values[probe] !== null
    ? { name, status: 'pass', detail: `ticked at #${shot}, with the ${label} open`, shots: [shot] }
    : { name, status: 'fail', detail: `ticked at #${shot}, after the ${label} closed: a late answer`, shots: [shot] }
}


/** The first sign-in: the card fills its room once the first sync has rows. */
async function appear(juno: Juno, win: Page, fake: FakeSlack, feel: Feel): Promise<void> {
  const { welcome, sidebar, write } = juno
  // The first sync has nothing to show yet: the card keeps its room, empty.
  fake.holdNext({ method: 'client.userBoot', before: true })
  await juno.signIn()
  await sidebar.expectEmpty('Getting your topics')
  await welcome.expectGone()
  await expect(write.field).toBeVisible()
  await win.mouse.move(900, 400)

  await feel.run(
    {
      name: 'welcome-appear',
      title: 'Sign in for the first time: the welcome card fills its room whole, once, and the field below never moves',
      probes: card,
      regions: { home: HOME },
      settleMs: 1000,
      checks: [
        happened('the card showed', (r) => r.frames.some((f) => f.values['card'] !== null)),
        opensWhole('card', 'cardText', 'the welcome card'),
        landsAndStays('card', 'the welcome card'),
        staysDrawn('cardOpacity', 'the welcome card'),
        ...aroundHolds().slice(0, 2),
        // No layout-shift check here: rows that land in the first sync take room as they come and move the centred column (SPEC 12).
        noFlicker('home', 'Home'),
      ],
    },
    async (rec) => {
      await rec.mark('rows')
      fake.release({ method: 'client.userBoot' })
      await sidebar.expectRows()
      await welcome.expectShown()
    },
  )
}

/** A peek ticks its hint while Home is open. */
async function tick(juno: Juno, win: Page, fake: FakeSlack, feel: Feel): Promise<void> {
  const { welcome, sidebar } = juno
  // The first sync ends before the ticks, so its last rows do not land in them.
  await juno.expectEngineLive()
  await sidebar.expectNoSyncStatus()
  await win.waitForTimeout(500)

  await feel.run(
    {
      name: 'welcome-tick',
      title: 'Peek a topic with Home open: its hint ticks while the peek shows, and the card does not move or play in again',
      probes: [...card, { kind: 'rect', name: 'peek', selector: '[role="dialog"][aria-roledescription="peek"]' }],
      regions: { card: CARD },
      checks: [
        happened('the peek hint ticked', (r) => r.frames.some((f) => ticks(f.values) === 1)),
        tickedWhileShown('peek', 'peek'),
        landsAndStays('card', 'the welcome card'),
        landsAndStays('hints', 'the hints'),
        staysDrawn('cardOpacity', 'the welcome card'),
        ...aroundHolds(),
        noLayoutShift({ region: 'card', includeInput: true }),
        noFlicker('card', 'the welcome card'),
      ],
    },
    async (rec) => {
      await rec.mark('peek')
      await sidebar.row(RINA).peek()
      await juno.peek.expectShowing(RINA)
      await win.waitForTimeout(300)
      await juno.peek.release()
      await juno.peek.expectClosed()
      await welcome.expectTicked('peek')
    },
  )
}

/** Back to Home after ⌘-clicking a topic. */
async function returnHome(juno: Juno, win: Page, fake: FakeSlack, feel: Feel): Promise<void> {
  const { welcome, sidebar } = juno
  // A topic in a new tab, then back to Home: the card shows its two ticks in its first frame, without an entrance.
  await sidebar.row(POSTGRES).openInNewTab()
  await juno.tabs.expectCount(2)
  await feel.run(
    {
      name: 'welcome-return',
      title: 'Go back to Home after ⌘-clicking a topic: the card shows both ticks in its first frame and is not played in again',
      probes: card,
      regions: { home: HOME },
      checks: [
        firstFrameRight('the card shows both ticks in its first frame', (v) => v['card'] !== null, (v) => (ticks(v) === 2 ? null : `${ticks(v)} ticks`)),
        landsAndStays('card', 'the welcome card'),
        staysDrawn('cardOpacity', 'the welcome card'),
        noFlicker('home', 'Home'),
      ],
    },
    async (rec) => {
      await rec.mark('home')
      await juno.tabs.select('Home')
      await welcome.expectTicked('peek', 'tab')
    },
  )
}

/** Back to Home after asking Juno: all three done. */
async function allSet(juno: Juno, win: Page, fake: FakeSlack, feel: Feel): Promise<void> {
  const { welcome, write } = juno
  // A question to Juno from Home's field opens the Juno chat; Back comes to a card that is all set.
  await write.write('What did I miss today?')
  await write.send()
  await feel.run(
    {
      name: 'welcome-all-set',
      title: 'Come back to Home after asking Juno: the card says "You’re all set" from its first frame, in the same box',
      probes: card,
      regions: { home: HOME },
      checks: [
        firstFrameRight('the card is all set in its first frame', (v) => v['card'] !== null, (v) => (v['heading'] === 'You’re all set' && ticks(v) === 3 ? null : `"${String(v['heading'])}" with ${ticks(v)} ticks`)),
        switchesOnce('the heading', (v) => String(v['heading'] ?? 'no card'), { where: (v) => v['card'] !== null }),
        staysDrawn('cardOpacity', 'the welcome card'),
        noFlicker('home', 'Home'),
      ],
    },
    async (rec) => {
      await rec.mark('back')
      await juno.nav.menu('back')
      await juno.home.expectShown()
      await expect(welcome.heading).toHaveText('You’re all set')
    },
  )
}

/** Done puts the card away. */
async function done(juno: Juno, win: Page, fake: FakeSlack, feel: Feel): Promise<void> {
  const { welcome } = juno
  await feel.run(
    {
      name: 'welcome-done',
      title: 'Press Done: the card goes in one frame, keeping its room, and nothing on Home moves',
      probes: card,
      regions: { home: HOME },
      checks: [
        happened('the card went', (r) => r.frames.at(-1)?.values['card'] === null),
        switchesOnce('the card', (v) => (v['card'] === null ? 'gone' : 'shown')),
        landsAndStays('room', "the card's room", { tolerance: 0 }),
        ...aroundHolds(),
        noLayoutShift({ region: 'home', includeInput: true }),
        noFlicker('home', 'Home'),
      ],
    },
    async (rec) => {
      await rec.mark('done')
      await welcome.close.click()
      await welcome.expectGone()
    },
  )
}

test('the welcome card appears, ticks, says all set and goes without moving Home', { tag: ['@nightly', '@nightly-feel'] }, async ({ juno, win, fake, feel }) => {
  await appear(juno, win, fake, feel)
  await tick(juno, win, fake, feel)
  await returnHome(juno, win, fake, feel)
  await allSet(juno, win, fake, feel)
  await done(juno, win, fake, feel)
})
