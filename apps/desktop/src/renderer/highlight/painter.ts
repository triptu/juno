/**
 * The lazy half of the code highlighter: the worker client, the colours
 * kept for recent blocks, and the step that puts them on the page. Loaded
 * with the first code block near the screen (`codeHighlighter.ts`).
 */
import type { HighlightedCode } from '@juno/highlight'
import { paintCode } from '@juno/highlight/paint'

export interface HighlightRequest {
  readonly id: number
  readonly code: string
  readonly language: string | undefined
}

export interface HighlightReply {
  readonly id: number
  readonly result: HighlightedCode | undefined
}

/** Colours kept for blocks seen recently, so a row that mounts again draws coloured at once. */
const KEEP = 300

const keyOf = (code: string, language: string | undefined) => `${language ?? ''}\u0000${code}`

const known = new Map<string, HighlightedCode | null>()
const asked = new Map<string, Promise<HighlightedCode | undefined>>()
const replies = new Map<number, (result: HighlightedCode | undefined) => void>()
let worker: Worker | 'failed' | undefined
let next = 0

const nothing = () => {}

// A worker that cannot start or fails leaves every block plain.
function fail() {
  worker = 'failed'
  for (const reply of replies.values()) reply(undefined)
  replies.clear()
}

function thread(): Worker | undefined {
  if (worker === 'failed') return undefined
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module', name: 'highlight' })
  } catch {
    fail()
    return undefined
  }
  worker.onmessage = ({ data }: MessageEvent<HighlightReply>) => {
    replies.get(data.id)?.(data.result)
    replies.delete(data.id)
  }
  worker.onerror = fail
  return worker
}

function remember(key: string, value: HighlightedCode | null) {
  known.delete(key)
  known.set(key, value)
  if (known.size > KEEP) known.delete(known.keys().next().value!)
}

function ask(code: string, language: string | undefined): Promise<HighlightedCode | undefined> {
  const key = keyOf(code, language)
  const already = asked.get(key)
  if (already !== undefined) return already
  const target = thread()
  if (target === undefined) return Promise.resolve(undefined)
  const id = next++
  const answer = new Promise<HighlightedCode | undefined>((resolve) => replies.set(id, resolve)).then((result) => {
    asked.delete(key)
    remember(key, result ?? null)
    return result
  })
  asked.set(key, answer)
  target.postMessage({ id, code, language } satisfies HighlightRequest)
  return answer
}

/** Paints colours already worked out; undefined when they are not known yet. */
export function paintKnown(element: HTMLElement, code: string, language: string | undefined): (() => void) | undefined {
  const value = known.get(keyOf(code, language))
  if (value === undefined) return undefined
  return value === null ? nothing : paintCode(element, value)
}

/** Works the colours out in the worker and paints them. Returns a function that takes them off or stops waiting. */
export function paint(element: HTMLElement, code: string, language: string | undefined): () => void {
  const now = paintKnown(element, code, language)
  if (now !== undefined) return now
  let live = true
  let stop = nothing
  void ask(code, language).then((result) => {
    if (live && result !== undefined) stop = paintCode(element, result)
  })
  return () => {
    live = false
    stop()
  }
}
