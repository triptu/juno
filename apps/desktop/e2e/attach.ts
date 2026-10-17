// Attaching files in e2e specs: sample files, paste and drop as the page
// receives them, and the composer's chips.
import type { Locator, Page } from '@playwright/test'
import { samplePdf, samplePng } from '@juno/fake-slack'
import { expect } from './fixtures'
import type { TopicPane } from './driver/juno'

export interface Upload {
  readonly name: string
  readonly mimeType: string
  readonly buffer: Buffer
}

export const chart = (): Upload => ({ name: 'chart.png', mimeType: 'image/png', buffer: samplePng(640, 400) })
export const brief = (): Upload => ({ name: 'launch-brief.pdf', mimeType: 'application/pdf', buffer: samplePdf('Launch brief', ['Freeze on Thursday.']) })

/** Builds a DataTransfer holding `files` in the page. */
function dataTransfer(win: Page, files: ReadonlyArray<Upload>) {
  return win.evaluateHandle((list) => {
    const transfer = new DataTransfer()
    for (const file of list) transfer.items.add(new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.name, { type: file.mimeType }))
    return transfer
  }, files.map((file) => ({ name: file.name, mimeType: file.mimeType, base64: file.buffer.toString('base64') })))
}

/** Pastes `files` into a composer's field, as ⌘V with files on the clipboard. */
export async function paste(field: Locator, files: ReadonlyArray<Upload>): Promise<void> {
  const transfer = await dataTransfer(field.page(), files)
  await field.focus()
  await field.evaluate((element, data) => element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })), transfer)
}

/** Drags `files` over `target` and drops them there. */
export async function drop(target: Locator, files: ReadonlyArray<Upload>): Promise<void> {
  const transfer = await dataTransfer(target.page(), files)
  await target.dispatchEvent('dragenter', { dataTransfer: transfer })
  await target.dispatchEvent('dragover', { dataTransfer: transfer })
  await target.dispatchEvent('drop', { dataTransfer: transfer })
}

export const chips = (topic: TopicPane) => topic.root.locator('[data-composer]').getByRole('button', { name: /^Remove / })
export const chip = (topic: TopicPane, name: string) => topic.root.locator('[data-composer]').getByRole('button', { name: `Remove ${name}` })
/** Waits until `count` of a pane's chips are staged. Home's Enter does nothing while a file is still being read, so its sends wait for this. */
export const staged = (pane: { readonly root: Locator }, count: number) => expect(pane.root.locator('[data-composer] [data-attachment="ready"]')).toHaveCount(count)
