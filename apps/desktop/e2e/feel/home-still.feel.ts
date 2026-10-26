// Home is drawn in its final state on its first frame and nothing on it moves or is redrawn afterwards, on the default seed.
import { expect } from '@playwright/test'
import { fail, firstFrameRight, framesIn, happened, landsAndStays, noFlicker, pass, staysDrawn, type Check, type Window } from './checks'
import { test } from './feel'
import type { Probe, ProbeFrame } from './recorder'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

const SCENE = '[data-home] [data-home-scene]'
const GREETING = '[data-home] h2'
const ROWS = '[data-home] ul'
const STAGING = 'Unrelated: has anyone looked at the'

const probes: Probe[] = [
  { kind: 'count', within: 'main', name: 'home', selector: '[data-home-item]' },
  { kind: 'rect', name: 'scene', selector: SCENE },
  { kind: 'rect', name: 'greeting', selector: GREETING },
  { kind: 'opacity', name: 'sceneOpacity', selector: SCENE },
  { kind: 'opacity', name: 'greetingOpacity', selector: GREETING },
  { kind: 'opacity', name: 'rowsOpacity', selector: ROWS },
]

/**
 * After the first frame `options` picks, no image changes the region: what is there stays drawn exactly as it
 * was, under the pointer or while the page around it changes.
 */
function regionHoldsStill(region: string, label: string, options: Window): Check {
  const name = `${label} is not redrawn`
  return (evidence) => {
    const start = framesIn(evidence.recording, options)[0]
    if (start === undefined) return fail(name, 'never happened', [])
    const shots = evidence.pixels.filter((p) => p.frame !== null && p.frame > start.index)
    const changed = shots.filter((p) => (p.regions[region]?.changed ?? 0) > 0)
    if (changed.length === 0) return pass(name, `${shots.length} frames, none changed it`)
    return fail(name, `${changed.length} of ${shots.length} frames changed it (most: ${Math.max(...changed.map((p) => p.regions[region]!.changed)).toFixed(4)} of its pixels)`, changed.map((p) => p.number).slice(0, 12))
  }
}

const homeShown = (values: ProbeFrame['values']) => Number(values['home']) > 0
const regions = { scene: SCENE, greeting: GREETING, rows: ROWS }

/** The scene, the greeting and the rows are fully drawn in the first frame Home shows. */
const wholeAtOnce = firstFrameRight('Home is fully drawn in its first frame', homeShown, (v) => {
  const faint = ['sceneOpacity', 'greetingOpacity', 'rowsOpacity'].filter((name) => v[name] !== 1)
  return faint.length === 0 ? null : faint.map((name) => `${name} ${String(v[name])}`).join(', ')
})

const stillChecks = (from: string) => [
  landsAndStays('scene', 'the scene', { from, tolerance: 0 }),
  landsAndStays('greeting', 'the greeting', { from, tolerance: 0 }),
  staysDrawn('sceneOpacity', 'the scene', { from }),
  staysDrawn('greetingOpacity', 'the greeting', { from }),
  regionHoldsStill('scene', 'the scene', { from, where: homeShown }),
  regionHoldsStill('greeting', 'the greeting', { from, where: homeShown }),
  noFlicker('window', 'the window', { from }),
]

test('a new tab from + shows Home whole in its first frame', { tag: '@on-demand' }, async ({ juno, win, feel }) => {
  await juno.sidebar.row('Draft plan is in the doc').open()
  await juno.topic.expectTitle('Draft plan is in the doc')
  await juno.tabs.newTabButton.hover()
  await win.waitForTimeout(300)

  await feel.run({
    name: 'home-new-tab',
    title: 'Press + after the tabs from a topic: the new tab shows Home with its scene, greeting and rows fully drawn in its first frame, and nothing on it changes after',
    probes,
    regions,
    settleMs: 1_000,
    checks: [happened('Home showed its rows', (r) => r.frames.some((f) => homeShown(f.values))), wholeAtOnce, ...stillChecks('press')],
  }, async (rec) => {
    await rec.mark('press')
    await juno.tabs.newTabButton.click()
    await expect(juno.home.item('waiting')).toBeVisible()
  })
})

test("pointing at Home's rows leaves the scene and the greeting as they are", { tag: '@on-demand' }, async ({ juno, slack, win, feel }) => {
  // Rows of each tile: Maya's DM with her photo (waiting on you) and a thread with its art (moved a lot).
  slack.as('Maya').dm('Can you look at the hiring plan today?')
  for (let n = 1; n <= 9; n++) slack.as('Leo').replyIn(STAGING, `Cost update ${n}.`)
  await juno.sidebar.row(STAGING).expectPreview(/Cost update 9\./)
  await juno.home.open()
  const rows = juno.home.root.locator('[data-home-item]')
  await expect.poll(() => juno.home.kinds(), { timeout: 30_000 }).toEqual(expect.arrayContaining(['waiting', 'moved']))
  await expect(juno.home.item('waiting').locator('img')).toBeVisible()
  // A resting point on Home, right of the column and above the composer.
  const page = (await juno.home.root.boundingBox())!
  const rest = { x: page.x + page.width - 16, y: page.y + 48 }
  await win.mouse.move(rest.x, rest.y)
  await win.waitForTimeout(1_000)

  await feel.run({
    name: 'home-row-hover',
    title: "Move the pointer down over Home's rows and back out: only the row under the pointer changes; the scene and the greeting are never moved or redrawn",
    probes,
    regions,
    checks: [happened('Home showed its rows', (r) => r.frames.some((f) => homeShown(f.values))), ...stillChecks('go')],
  }, async (rec) => {
    await rec.mark('go')
    for (let i = 0; i < (await rows.count()); i++) {
      await rows.nth(i).hover()
      await win.waitForTimeout(250)
    }
    await win.mouse.move(rest.x, rest.y, { steps: 8 })
  })
})
