// Attaching files in DOM tests, as `e2e/attach.ts` does in the browser lane:
// paste, drop and the file picker as the page receives them, made of the
// window's own DataTransfer and File, and the composer's chips.
import { samplePdf, samplePng } from '@juno/fake-slack'
import type { Upload } from '../e2e/attach'
import { expect } from './expect'
import type { Dom } from './input'
import type { Query } from './query'

export const chart = (): Upload => ({ name: 'chart.png', mimeType: 'image/png', buffer: samplePng(640, 400) })
export const brief = (): Upload => ({ name: 'launch-brief.pdf', mimeType: 'application/pdf', buffer: samplePdf('Launch brief', ['Freeze on Thursday.']) })

type PageGlobals = { DataTransfer: typeof DataTransfer; File: typeof File; ClipboardEvent: typeof ClipboardEvent; Event: typeof Event }

const globals = (dom: Dom) => dom.window as unknown as PageGlobals

const files = (dom: Dom, uploads: ReadonlyArray<Upload>) => uploads.map((file) => new (globals(dom).File)([new Uint8Array(file.buffer)], file.name, { type: file.mimeType }))

function dataTransfer(dom: Dom, uploads: ReadonlyArray<Upload>): DataTransfer {
  const transfer = new (globals(dom).DataTransfer)()
  for (const file of files(dom, uploads)) transfer.items.add(file)
  return transfer
}

/** Pastes `uploads` into a composer's field, as ⌘V with files on the clipboard. */
export async function paste(field: Query, uploads: ReadonlyArray<Upload>): Promise<void> {
  const el = await field.element()
  el.focus()
  el.dispatchEvent(new (globals(field.dom).ClipboardEvent)('paste', { clipboardData: dataTransfer(field.dom, uploads), bubbles: true, cancelable: true }))
}

/** Drags `uploads` over `target` and drops them there. */
export async function drop(target: Query, uploads: ReadonlyArray<Upload>): Promise<void> {
  const el = await target.element()
  const transfer = dataTransfer(target.dom, uploads)
  // happy-dom's DragEvent is a plain Event, so each event carries the transfer as a browser's would.
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const event = new (globals(target.dom).Event)(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    el.dispatchEvent(event)
  }
}

/** Picks `uploads` in a file input, as the open panel returns them. */
export async function pick(input: Query, uploads: ReadonlyArray<Upload>): Promise<void> {
  const el = (await input.dom.until(input.description, () => input.el())) as HTMLInputElement
  ;(el as unknown as { files: File[] }).files = files(input.dom, uploads)
  el.dispatchEvent(new (globals(input.dom).Event)('input', { bubbles: true }))
  el.dispatchEvent(new (globals(input.dom).Event)('change', { bubbles: true }))
}

export const chips = (pane: { readonly root: Query }) => pane.root.locator('[data-composer]').getByRole('button', { name: /^Remove / })
export const chip = (pane: { readonly root: Query }, name: string) => pane.root.locator('[data-composer]').getByRole('button', { name: `Remove ${name}` })
/** Waits until `count` of a pane's chips are staged. Home's Enter does nothing while a file is still being read, so its sends wait for this. */
export const staged = (pane: { readonly root: Query }, count: number) => expect(pane.root.locator('[data-composer] [data-attachment="ready"]')).toHaveCount(count)
