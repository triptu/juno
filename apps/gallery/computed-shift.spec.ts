import { expect, type Page } from '@playwright/test'
import { checkForcedInteractions, formatForcedShift, type ForcedInteractionReport } from '@juno/testing/forced-shift'
import { checkStateWithin, interactive, statesPerDocument } from './shift-walk'
import { claimQueue, openState, readRoutes, test, type Route } from './support'

/**
 * A fast sweep of the shift guard over every state, on request:
 * bun run remote --env GALLERY_SHIFT_COMPUTED=1 test:gallery computed-shift.spec.ts
 *
 * Each state is opened once. In one call per state, the same elements the
 * real-input walk touches (shift-walk.ts) are hovered, focused from the
 * keyboard, blurred, pressed, released and left by forcing the pseudo-class
 * styles and dispatching the events React listens to, with transitions off
 * (`checkForcedInteractions` in packages/testing says what it cannot see).
 * Every box is compared after each step, as the guard does. It takes about a
 * fifth of a second a state, against one CPU-second for the real walk: use it to check a
 * broad change everywhere before the full walk. Ordinary runs do not need it,
 * since the walk's records already re-walk every state whose inputs changed.
 * Its self-tests run every time.
 *
 * GALLERY_SHIFT_ONLY and JUNO_SHARD select states as for the walk.
 */
const perState = 8


const shardMatch = /^(\d+)\/(\d+)$/.exec(process.env.JUNO_SHARD ?? '')
const shard = shardMatch ? { index: Number(shardMatch[1]), total: Number(shardMatch[2]) } : undefined
const parts = Number(process.env.GALLERY_SHIFT_PARTS ?? process.env.GALLERY_WORKERS ?? (process.env.CI ? 2 : 3))
const only = process.env.GALLERY_SHIFT_ONLY?.split(',').map((name) => name.trim())

const forced = (page: Page, from = 0) =>
  checkForcedInteractions(page, { targets: interactive, skipWithin: '[data-expands-in-place]', pending: '[data-chunk-pending]', max: perState, from })

for (let part = 0; part < parts; part++) {
  test(`no forced interaction shifts the layout, in any state of any component (part ${part + 1} of ${parts})`, async ({ page }) => {
    test.skip(process.env.GALLERY_SHIFT_COMPUTED !== '1', 'runs with GALLERY_SHIFT_COMPUTED=1')
    // One document opens many states through its hash: loading the gallery again for each would cost more than the check.
    let opened = 0
    let opening = 0
    const open = async (route: Route, again = false) => {
      if (!again && opened > 0 && opened % statesPerDocument === 0) {
        await page.evaluate(() => { location.hash = '#/~' })
        await page.reload()
      }
      if (!again) opened++
      const from = Date.now()
      await openState(page, route, 'light', undefined, { finishMotion: true, inPlace: true })
      opening += Date.now() - from
    }
    const routes = (await readRoutes(page)).filter((route, index) => (!only || only.includes(route.component)) && (!shard || index % shard.total === shard.index))
    expect(routes.length, 'the selected gallery states exist').toBeGreaterThan(0)
    // Half a second a state is the target; a second a state leaves room on a loaded machine.
    test.setTimeout(Math.max(5 * 60_000, Math.ceil((routes.length * 1_000) / Math.min(parts, test.info().config.workers))))
    const queue = claimQueue('computed')
    const shifts: string[] = []
    let states = 0, elements = 0, resets = 0, unforced = 0
    const spent = { act: 0, settle: 0, boxes: 0 }
    const started = Date.now()
    try {
      for (let route = queue.next(routes); route !== undefined; route = queue.next(routes)) {
        await checkStateWithin(route, async () => {
          await open(route)
          states++
          // A touch that changed what the state draws asks for a fresh document for the elements after it.
          for (let report: ForcedInteractionReport = await forced(page); ; report = await forced(page, report.next)) {
            elements += report.touched
            spent.act += report.timing.act
            spent.settle += report.timing.settle
            spent.boxes += report.timing.boxes
            unforced = Math.max(unforced, report.unforced)
            for (const shift of report.shifts) shifts.push(`${route.route} (element ${shift.element + 1}, ${shift.target}) ${formatForcedShift(shift)}`)
            if (report.next === undefined) break
            resets++
            await open(route, true)
          }
        })
      }
    } finally {
      const ms = states > 0 ? Math.round((Date.now() - started) / states) : 0
      const per = (ms: number) => `${states > 0 ? Math.round(ms / states) : 0} ms`
      const open = states > 0 ? Math.round(opening / states) : 0
      console.log(`computed shift: ${states} states, ${elements} elements, ${resets} resets, ${ms} ms a state (${open} ms opening, ${per(spent.act)} touching, ${per(spent.settle)} waiting, ${per(spent.boxes)} boxes), ${unforced} pseudo-class rules left unforced`)
    }
    expect(shifts.join('\n\n')).toBe('')
  })
}

/**
 * The computed tier has to fail on the shifts it is for. Each page is made on
 * the spot; `frame` gives it the gallery's frame, which the check measures.
 */
test.describe('the computed tier itself', () => {
  // setContent pages and an injected style tag: nothing to share.
  test.use({ ownPage: true })
  const frame = (css: string, body: string) => `<style>${css}</style><div data-fixture-frame="guard">${body}</div>`
  const steps = async (page: Page) => (await forced(page)).shifts.map(formatForcedShift)
  // No fixed height: a button's box includes its padding and border, so only a sized-by-content one can grow.
  const base = '.b{display:block;width:100px;font:12px/18px sans-serif;padding:6px 0;border:0}p{margin:0}'

  for (const [name, css, step] of [
    ['a hover rule that changes padding', '.b:hover{padding-top:8px}', 'hover'],
    ['a hover rule that adds a border, inside a media query', '@media (hover: hover){.b:hover{border:2px solid}}', 'hover'],
    ['a hover on the parent that grows the child', '.row:hover .b{line-height:28px}', 'hover'],
    ['a hover transition of padding', '.b{transition:padding 200ms}.b:hover{padding:12px 0}', 'hover'],
    ['a focus ring that takes room', '.b:focus-visible{border:3px solid blue}', 'focus from the keyboard'],
    ['focus-within that pads the row', '.row:focus-within{padding:4px}', 'focus from the keyboard'],
    ['a press that changes size', '.b:active{padding-bottom:8px}', 'press'],
    ['a mouse focus that changes size', '.b:focus:not(:focus-visible){padding-bottom:8px}', 'press'],
  ] as const) {
    test(`fails on ${name}`, async ({ page }) => {
      await page.setContent(frame(base + css, '<div class="row"><button class="b">Touch me</button></div><p>Below</p>'))
      const failures = await steps(page)
      expect(failures.some((failure) => failure.startsWith(`${step}: Layout shifted during the action.`)), failures.join('\n')).toBe(true)
      expect(failures.join('\n')).toContain('p "Below"')
    })
  }

  test('fails when a handler at the root renders on pointer over, as React does', async ({ page }) => {
    await page.setContent(frame(base, '<button class="b">Hover me</button><p>Below</p>'))
    await page.evaluate(() => {
      // One listener at the root for every element, rendering in a later task.
      document.addEventListener('pointerover', (event) => {
        if (!(event.target as Element).matches('.b')) return
        setTimeout(() => document.querySelector('p')!.before(Object.assign(document.createElement('p'), { textContent: 'Inserted' })), 0)
      })
    })
    expect((await forced(page)).shifts.map((shift) => shift.step)).toContain('hover')
  })

  test('waits for code a touch starts loading, and fails on what it moves', async ({ page }) => {
    await page.setContent(frame(base, '<button class="b">Late</button><p>Below</p>'))
    await page.locator('.b').evaluate((button: HTMLElement) => {
      button.addEventListener('pointerenter', () => {
        const pending = document.createElement('span')
        pending.hidden = true
        pending.setAttribute('data-chunk-pending', '')
        document.body.append(pending)
        setTimeout(() => {
          button.style.paddingBottom = '40px'
          pending.remove()
        }, 100)
      }, { once: true })
    })
    expect((await forced(page)).shifts.map((shift) => shift.step)).toContain('hover')
  })

  test('lets a press scale, a colour change, an outline ring and an opacity fade through', async ({ page }) => {
    await page.setContent(frame(
      `${base}.b{transition:transform 150ms, background-color 150ms}.b:active{transform:scale(0.96)}.b:hover{background:#ccc;opacity:.8}.b:focus-visible{outline:2px solid blue;outline-offset:2px}`,
      '<button class="b">Press me</button><p>Below</p>',
    ))
    expect(await steps(page)).toEqual([])
  })

  test('catches an injected hover rule in a gallery button', async ({ page }) => {
    const route = (await readRoutes(page)).find((candidate) => candidate.component === 'Button' && candidate.id === 'variant/primary')
    if (!route) throw new Error('Missing primary button fixture')
    await openState(page, route, 'light', undefined, { finishMotion: true })
    expect((await forced(page)).shifts).toEqual([])
    await page.goto('about:blank')
    await openState(page, route, 'light', undefined, { finishMotion: true })
    await page.addStyleTag({ content: '[data-fixture-frame] button:hover { margin-bottom: 1px; }' })
    const failures = (await forced(page)).shifts.map(formatForcedShift)
    expect(failures.some((failure) => failure.startsWith('hover: Layout shifted during the action.')), failures.join('\n')).toBe(true)
  })
})
