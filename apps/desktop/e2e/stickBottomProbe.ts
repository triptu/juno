import type { Page } from '@playwright/test'

export interface Frame {
  readonly present: boolean
  readonly inView: boolean
  readonly distance: number
}

/**
 * Reads, after every paint, whether the newest `row` that contains `text` exists, is fully inside the scroller
 * `scroller`, and how far the scroller is from its end. The returned function stops and answers the frames from
 * the first that has the row.
 */
export async function watchArrival(page: Page, scroller: string, row: string, text: string): Promise<() => Promise<Frame[]>> {
  await page.evaluate(
    ({ scroller, row, text }) => {
      const state = { frames: [] as Frame[], on: true }
      ;(window as unknown as { arrival: typeof state }).arrival = state
      const tick = () => {
        const list = [...document.querySelectorAll<HTMLElement>(scroller)].find((node) => node.getClientRects().length > 0)
        if (list !== undefined) {
          const node = [...list.querySelectorAll(row)].findLast((candidate) => candidate.textContent?.includes(text) === true)
          const box = list.getBoundingClientRect()
          const at = node?.getBoundingClientRect()
          state.frames.push({
            present: at !== undefined,
            inView: at !== undefined && at.top >= box.top - 1 && at.bottom <= box.bottom + 1,
            distance: list.scrollHeight - list.scrollTop - list.clientHeight,
          })
        }
        // After the frame is painted: a resize observer runs after animation frame callbacks, before paint.
        if (state.on) requestAnimationFrame(() => setTimeout(tick, 0))
      }
      requestAnimationFrame(() => setTimeout(tick, 0))
    },
    { scroller, row, text },
  )
  return () =>
    page.evaluate(() => {
      const state = (window as unknown as { arrival: { frames: Frame[]; on: boolean } }).arrival
      state.on = false
      const first = state.frames.findIndex((frame) => frame.present)
      return first < 0 ? [] : state.frames.slice(first)
    })
}

/**
 * Reads, each time the scroller's box changes size, whether its last row is fully inside it and how far it is from
 * its end. An observer created after the app's runs after it in the same frame, after layout and before paint, so
 * it reads what that frame paints; a read from a task could land after the size change and before the frame.
 * Returns once the observer's own first look is in, and a function that waits for an entry at a height below
 * `below` and answers every entry.
 */
export async function watchResize(page: Page, scroller: string): Promise<(below: number) => Promise<Frame[]>> {
  await page.evaluate(
    (scroller) =>
      new Promise<void>((resolve) => {
        const list = [...document.querySelectorAll<HTMLElement>(scroller)].find((node) => node.getClientRects().length > 0)!
        const state = { frames: [] as Frame[], heights: [] as number[], observer: undefined as ResizeObserver | undefined }
        ;(window as unknown as { resized: typeof state }).resized = state
        state.observer = new ResizeObserver(() => {
          const box = list.getBoundingClientRect()
          const at = [...list.querySelectorAll('[data-message-row]')].at(-1)?.getBoundingClientRect()
          state.frames.push({ present: at !== undefined, inView: at !== undefined && at.top >= box.top - 1 && at.bottom <= box.bottom + 1, distance: list.scrollHeight - list.scrollTop - list.clientHeight })
          state.heights.push(list.clientHeight)
          resolve()
        })
        state.observer.observe(list)
      }),
    scroller,
  )
  return async (below) => {
    await page.waitForFunction((below) => (window as unknown as { resized: { heights: number[] } }).resized.heights.some((height) => height < below), below)
    return page.evaluate(() => {
      const state = (window as unknown as { resized: { frames: Frame[]; observer: ResizeObserver } }).resized
      state.observer.disconnect()
      return state.frames
    })
  }
}

interface EditFrame {
  readonly hiddenAbove: number
  readonly hiddenBelow: number
  readonly editorHeight: number
  readonly buttons: number
  readonly distance: number
}

/** Samples after paint, including the first editor frame and any later textarea growth. */
export async function watchEditVisibility(page: Page): Promise<() => Promise<EditFrame[]>> {
  await page.evaluate(() => {
    const state = { frames: [] as EditFrame[], on: true }
    ;(window as unknown as { editVisibility: typeof state }).editVisibility = state
    const tick = () => {
      if (!state.on) return
      const view = [...document.querySelectorAll<HTMLElement>('[data-topic-view]')].find((node) => node.getClientRects().length > 0)
      const list = view?.querySelector<HTMLElement>('[data-scroll]')
      const editor = list?.querySelector('[data-inline-edit]')
      const composer = view?.querySelector('[data-composer]')
      if (list && editor && composer) {
        const box = list.getBoundingClientRect()
        const limit = Math.min(box.bottom, composer.getBoundingClientRect().top)
        const rects = [editor, ...editor.querySelectorAll('textarea, button')].map((node) => node.getBoundingClientRect())
        state.frames.push({
          hiddenAbove: Math.max(0, box.top - Math.min(...rects.map((rect) => rect.top))),
          hiddenBelow: Math.max(0, Math.max(...rects.map((rect) => rect.bottom)) - limit),
          editorHeight: editor.getBoundingClientRect().height,
          buttons: editor.querySelectorAll('button').length,
          distance: list.scrollHeight - list.scrollTop - list.clientHeight,
        })
      }
      requestAnimationFrame(() => setTimeout(tick, 0))
    }
    requestAnimationFrame(() => setTimeout(tick, 0))
  })
  return () => page.evaluate(() => {
    const state = (window as unknown as { editVisibility: { frames: EditFrame[]; on: boolean } }).editVisibility
    state.on = false
    return state.frames
  })
}
