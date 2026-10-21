import { expect, type Page } from '@playwright/test'
import { waitForLayoutReady } from '@juno/testing/layout-shift'

function homeSyncProbe() {
  const seen: Element[] = []
  const box = (target: string | Element) => {
    const node = typeof target === 'string' ? document.querySelector(target) : target
    if (!(node instanceof HTMLElement || node instanceof SVGElement) || !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null
    // A parent fading also makes the contents flicker, even if the node's own opacity is one.
    for (let parent: Element | null = node; parent !== null; parent = parent.parentElement) {
      if (getComputedStyle(parent).opacity !== '1') return null
    }
    const { x, y, width, height } = node.getBoundingClientRect()
    return { x, y, width, height }
  }
  const sample = () => {
    const greeting = box('[data-home] h2')
    return {
      scene: box('[data-home-scene]'),
      greeting,
      field: box('[data-home] [data-composer-field]'),
      chip: box('[data-home-write] [aria-label^="Send to:"]'),
      syncing: document.querySelector('[data-home-loading]') !== null,
      title: document.querySelector('[data-home] h2')?.textContent,
      rows: [...document.querySelectorAll('[data-home-item]')].map((node) => {
        if (!seen.includes(node)) seen.push(node)
        const { x, y, width, height } = node.getBoundingClientRect()
        return {
          id: seen.indexOf(node),
          kind: node.getAttribute('data-home-item'),
          topic: node.querySelector('a')?.getAttribute('href'),
          visible: box(node) !== null,
          x, y: greeting === null ? null : y - greeting.y, width, height,
        }
      }),
    }
  }
  const frames = [sample()]
  let frame = 0
  const tick = () => {
    frames.push(sample())
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return { stop: () => { cancelAnimationFrame(frame); frames.push(sample()); return frames } }
}

/** Home can recenter as rows arrive, but its painted contents stay together and its composer stays put. */
export async function expectHomeSyncFrames(page: Page, action: () => Promise<void>): Promise<void> {
  await waitForLayoutReady(page)
  const probe = await page.evaluateHandle(homeSyncProbe)
  try {
    await action()
    await waitForLayoutReady(page)
    const frames = await probe.evaluate((recording) => recording.stop())
    const first = frames[0]!
    expect(frames.length, 'Home is sampled over multiple frames').toBeGreaterThan(1)
    expect(first.scene).not.toBeNull()
    expect(first.greeting).not.toBeNull()
    expect(first.field).not.toBeNull()
    expect(first.chip).not.toBeNull()
    expect(frames.at(-1)!.scene!.y, 'rows fill unreserved space and recenter the column').toBeLessThan(first.scene!.y)
    const painted = new Map<number, (typeof first.rows)[number]>()
    let order: number[] = []
    for (const [index, frame] of frames.entries()) {
      const at = `Home frame ${index}`
      expect(frame.scene, `${at}: scene never disappears or fades`).not.toBeNull()
      expect(frame.greeting, `${at}: greeting never disappears or fades`).not.toBeNull()
      expect(frame.field, `${at}: composer never moves or fades`).toEqual(first.field)
      expect(frame.chip, `${at}: destination never moves or fades`).toEqual(first.chip)
      expect({ ...frame.scene, y: 0 }, `${at}: scene only moves vertically`).toEqual({ ...first.scene, y: 0 })
      expect({ ...frame.greeting, y: 0 }, `${at}: greeting only moves vertically`).toEqual({ ...first.greeting, y: 0 })
      expect(frame.greeting!.y - frame.scene!.y, `${at}: scene and greeting move together`).toBe(first.greeting!.y - first.scene!.y)
      if (frame.syncing) expect(frame.title, `${at}: sync never shows caught up`).not.toBe('All caught up.')
      const ids = frame.rows.map((row) => row.id)
      expect(ids.filter((id) => painted.has(id)), `${at}: painted rows remain in order`).toEqual(order)
      if (index > 0 && ids.length === order.length) {
        expect(frame.scene!.y, `${at}: progress and readiness changes never move the column`).toBe(frames[index - 1]!.scene!.y)
      }
      for (const row of frame.rows) {
        expect(row.visible, `${at}: row ${row.id} never disappears or fades`).toBe(true)
        const before = painted.get(row.id)
        // Coordinates relative to the greeting allow the whole column to recenter, with no independent row jump.
        if (before !== undefined) expect(row, `${at}: painted row keeps its identity, size and greeting offset`).toEqual(before)
        else painted.set(row.id, row)
      }
      order = ids
    }
  } finally {
    await probe.evaluate((recording) => recording.stop())
    await probe.dispose()
  }
}
