import { expect, test, type Page } from '@playwright/test'
import { checkForcedInteractions, formatForcedShift, type ForcedInteractionReport } from '@juno/testing/layout-shift'
import { checkStateWithin, claimQueue, interactive, openState, readRoutes, walkPages, type Route } from './support'

/**
 * The computed tier of the shift guard, over every state on every run.
 *
 * Each state is opened once. In one call per state, every interactive element
 * (up to `perState`, sampled from both ends) is hovered, focused from the
 * keyboard, blurred, pressed, released and left by forcing the pseudo-class
 * styles and dispatching the events React listens to, with transitions off
 * (`checkForcedInteractions` in packages/testing says what it cannot see).
 * Every box is compared after each step, as the guard does. The real-input
 * walk in shift.spec.ts covers what this cannot, for changed components on
 * every run and for every state in a full run.
 *
 * The same open checks two rules that need only the drawn state:
 * - SPEC section 16, the cursor: the arrow everywhere, the text cursor only
 *   over editable or selectable text, never the pointer. An element may compute
 *   `cursor: text` only when it also computes `user-select: text`, or when it
 *   is part of a field (a label wrapping an input), which focuses the input
 *   wherever it is clicked. Links that open outside Juno may show the hand.
 * - Performance 3.3: a message row is a whole number of pixels tall. A row
 *   laid out for the first time above the view grows from its estimate, and
 *   scroll anchoring moves the list by the difference; a fractional difference
 *   leaves the rows in view a part of a pixel off, and their text jumps.
 *
 * GALLERY_SHIFT_ONLY and JUNO_SHARD select states as for the walk.
 */
const perState = 16

const shardMatch = /^(\d+)\/(\d+)$/.exec(process.env.JUNO_SHARD ?? '')
const shard = shardMatch ? { index: Number(shardMatch[1]), total: Number(shardMatch[2]) } : undefined
const parts = Number(process.env.GALLERY_SHIFT_PARTS ?? process.env.GALLERY_WORKERS ?? (process.env.CI ? 2 : 3))
const only = process.env.GALLERY_SHIFT_ONLY?.split(',').map((name) => name.trim())

const forced = (page: Page, from = 0) =>
  checkForcedInteractions(page, { targets: interactive, skipWithin: '[data-expands-in-place]', pending: '[data-chunk-pending]', max: perState, from })

const drawnRules = (page: Page, route: Route) =>
  page.evaluate((frameName) => {
    const frame = document.querySelector(`[data-fixture-frame="${frameName}"]`)
    if (!frame) return { cursors: ['no frame'], rows: [] }
    const cursors: string[] = []
    for (const element of Array.from(frame.querySelectorAll('*'))) {
      const style = getComputedStyle(element)
      const describe = () => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}[cursor=${style.cursor}]`
      const external = element.closest('a[href^="http:"], a[href^="https:"], a[href^="mailto:"]') !== null
      if (style.cursor === 'pointer' && !external) cursors.push(describe())
      const label = element.closest('label')
      const inField = label !== null && label.querySelector('input, textarea') !== null
      if (style.cursor === 'text' && style.userSelect !== 'text' && !inField) cursors.push(describe())
    }
    const rows: string[] = []
    for (const row of Array.from(frame.querySelectorAll<HTMLElement>('[data-message-row]'))) {
      const height = row.getBoundingClientRect().height
      if (Math.abs(height - Math.round(height)) > 0.001) rows.push(`${row.dataset['messageRow'] ?? ''}: ${height}px`)
    }
    return { cursors, rows }
  }, route.route)

for (let part = 0; part < parts; part++) {
  test(`no forced interaction shifts the layout, in any state of any component (part ${part + 1} of ${parts})`, async ({ context }) => {
    const pages = await walkPages(context)
    const routes = (await readRoutes(pages.page())).filter((route, index) => (!only || only.includes(route.component)) && (!shard || index % shard.total === shard.index))
    expect(routes.length, 'the selected gallery states exist').toBeGreaterThan(0)
    // Half a second a state is the target; a second a state leaves room on a loaded machine.
    test.setTimeout(Math.max(5 * 60_000, Math.ceil((routes.length * 1_000) / Math.min(parts, test.info().config.workers))))
    const queue = claimQueue('computed')
    const shifts: string[] = []
    const cursors: string[] = []
    const rows: string[] = []
    let states = 0, elements = 0, resets = 0, unforced = 0
    const started = Date.now()
    try {
      for (let route = queue.next(routes); route !== undefined; route = queue.next(routes)) {
        await checkStateWithin(route, async () => {
          const page = await pages.next()
          await openState(page, route, 'light', undefined, { finishMotion: true })
          states++
          const drawn = await drawnRules(page, route)
          for (const hit of drawn.cursors) cursors.push(`${route.route}: ${hit}`)
          for (const row of drawn.rows) rows.push(`${route.route} ${row}`)
          // A touch that changed what the state draws asks for a fresh document for the elements after it.
          for (let report: ForcedInteractionReport = await forced(page); ; report = await forced(page, report.next)) {
            elements += report.touched
            unforced = Math.max(unforced, report.unforced)
            for (const shift of report.shifts) shifts.push(`${route.route} (element ${shift.element + 1}, ${shift.target}) ${formatForcedShift(shift)}`)
            if (report.next === undefined) break
            resets++
            await page.goto('about:blank')
            await openState(page, route, 'light', undefined, { finishMotion: true })
          }
        })
      }
    } finally {
      const ms = states > 0 ? Math.round((Date.now() - started) / states) : 0
      console.log(`computed shift: ${states} states, ${elements} elements, ${resets} resets, ${ms} ms a state, ${unforced} pseudo-class rules left unforced`)
    }
    expect.soft(cursors, 'no state shows the pointer outside external links, and the text cursor only over selectable text').toEqual([])
    expect.soft(rows, 'every message row is a whole number of pixels tall').toEqual([])
    expect(shifts.join('\n\n')).toBe('')
  })
}

/**
 * The computed tier has to fail on the shifts it is for. Each page is made on
 * the spot; `frame` gives it the gallery's frame, which the check measures.
 */
test.describe('the computed tier itself', () => {
  const frame = (css: string, body: string) => `<style>${css}</style><div data-fixture-frame="guard">${body}</div>`
  const steps = async (page: Page) => (await forced(page)).shifts.map((shift) => `${shift.step}: ${formatForcedShift(shift)}`)
  const base = '.b{display:block;width:100px;height:30px;font:12px sans-serif;padding:0;border:0}p{margin:0}'

  for (const [name, css, step] of [
    ['a hover rule that changes padding', '.b:hover{padding-top:8px}', 'hover'],
    ['a hover rule that adds a border, inside a media query', '@media (hover: hover){.b:hover{border:2px solid}}', 'hover'],
    ['a hover on the parent that grows the child', '.row:hover .b{height:40px}', 'hover'],
    ['a hover transition of height', '.b{transition:height 200ms}.b:hover{height:60px}', 'hover'],
    ['a focus ring that takes room', '.b:focus-visible{border:3px solid blue}', 'focus from the keyboard'],
    ['focus-within that pads the row', '.row:focus-within{padding:4px}', 'focus from the keyboard'],
    ['a press that changes size', '.b:active{height:34px}', 'press'],
    ['a mouse focus that changes size', '.b:focus:not(:focus-visible){height:34px}', 'press'],
  ] as const) {
    test(`fails on ${name}`, async ({ page }) => {
      await page.setContent(frame(base + css, '<div class="row"><button class="b">Touch me</button></div><p>Below</p>'))
      const failures = await steps(page)
      expect(failures.some((failure) => failure.startsWith(`${step}: Layout shifted during the action.`)), failures.join('\n')).toBe(true)
      expect(failures.join('\n')).toContain('p "Below"')
    })
  }

  test('fails when a React-style handler renders on pointer enter, and on a late chunk', async ({ page }) => {
    await page.setContent(frame(base, '<button class="b">Hover me</button><p>Below</p><button class="c">Late</button>'))
    await page.evaluate(() => {
      // As React does: one listener at the root for every element, reacting to pointerover, rendering in a task.
      document.addEventListener('pointerover', (event) => {
        if (!(event.target as Element).matches('.b')) return
        setTimeout(() => document.querySelector('p')!.before(Object.assign(document.createElement('p'), { textContent: 'Inserted' })), 0)
      })
      const late = document.querySelector<HTMLElement>('.c')!
      late.addEventListener('pointerenter', () => {
        const pending = document.createElement('span')
        pending.hidden = true
        pending.setAttribute('data-chunk-pending', '')
        document.body.append(pending)
        setTimeout(() => {
          late.style.paddingBottom = '40px'
          pending.remove()
        }, 100)
      }, { once: true })
    })
    const report = await forced(page)
    expect(report.shifts.map((shift) => `${shift.element} ${shift.step}`)).toEqual(expect.arrayContaining(['0 hover', '1 hover']))
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
