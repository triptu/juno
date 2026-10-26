import { expect, type Page } from '@playwright/test'
import { formatForcedShift } from '@juno/testing/forced-shift'
import { computedWalk, forced } from './computed-walk'
import { claimQueue, openState, readRoutes, stateCache, test } from './support'

/** Fast shift checks for changed states; GALLERY_SHIFT_ALL=1 checks every state, including on nightly runs. */
const shardMatch = /^(\d+)\/(\d+)$/.exec(process.env.JUNO_SHARD ?? '')
const shard = shardMatch ? { index: Number(shardMatch[1]), total: Number(shardMatch[2]) } : undefined
const parts = Number(process.env.GALLERY_SHIFT_PARTS ?? process.env.GALLERY_WORKERS ?? (process.env.CI ? 2 : 3))
const only = process.env.GALLERY_SHIFT_ONLY?.split(',').map(name => name.trim())

// The forced guard rewrites CSS and suppresses click defaults for the lifetime of its document.
test.use({ ownPage: true })

for (let part = 0; part < parts; part++) {
  test(`no forced interaction shifts the layout, in any state of any component (part ${part + 1} of ${parts})`, { tag: only ? [] : ['@heavy', '@heavy-gallery'] }, async ({ browser, page }) => {
    const routes = (await readRoutes(page)).filter((route, index) => (!only || only.includes(route.component)) && (!shard || index % shard.total === shard.index))
    expect(routes.length, 'the selected gallery states exist').toBeGreaterThan(0)
    test.setTimeout(Math.max(5 * 60_000, Math.ceil(routes.length * 1_000 / Math.min(parts, test.info().config.workers))))
    const queue = claimQueue('computed')
    const cache = stateCache('computed', browser)
    const walk = computedWalk(page)
    const failures: string[] = []
    let states = 0, cached = 0, elements = 0, resets = 0, unforced = 0
    try {
      for (let route = queue.next(routes); route !== undefined; route = queue.next(routes)) {
        if (cache.passed(route)) { cached++; continue }
        cache.forget(route)
        const result = await walk(route)
        states++
        elements += result.elements
        resets += result.resets
        unforced = Math.max(unforced, result.unforced)
        failures.push(...result.failures.map(failure => `${route.route}: ${failure}`))
        if (result.failures.length === 0) cache.pass(route)
      }
    } finally {
      console.log(`computed shift: ${states} states, ${cached} cached, ${elements} elements, ${resets} resets, ${unforced} pseudo-class rules left unforced`)
    }
    expect(failures.join('\n\n')).toBe('')
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
