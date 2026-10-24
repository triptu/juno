/**
 * The lazy half of the code highlighter: the wait for a block to come near
 * the screen, the worker client, the colours kept for recent blocks, and
 * the step that puts them on the page. Loaded with the first code block
 * that mounts (`codeHighlighter.ts`); the worker starts with the first one
 * near the screen.
 *
 * The worker gets one block at a time. Blocks wait in a bounded queue; a
 * block that unmounts leaves it, so nothing holds a detached element. A
 * block the worker does not finish in time stays plain, and the worker is
 * replaced for the blocks after it.
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

/** Colours kept for blocks seen recently, so a block that comes back is coloured at once. */
const KEEP = 300
/** Blocks waiting for the worker. Past this the oldest gives up and stays plain until it mounts again. */
const MAX_WAITING = 64
/** A block the worker has not answered in this time stays plain. */
const TIMEOUT_MS = 3000
/** Workers that may fail or stall before blocks stay plain for the rest of the run. */
const MAX_FAILURES = 3

type Done = (result: HighlightedCode | undefined) => void

interface Request {
  readonly key: string
  readonly code: string
  readonly language: string | undefined
  readonly waiters: Set<Done>
}

const keyOf = (code: string, language: string | undefined) => `${language ?? ''}\u0000${code}`

const known = new Map<string, HighlightedCode | null>()
const waiting = new Map<string, Request>()
let current: { readonly request: Request; readonly id: number; readonly timer: ReturnType<typeof setTimeout> } | undefined
let worker: Worker | undefined
let failures = 0
let next = 0

const nothing = () => {}

/** Blocks start colouring this far before they scroll into view. */
const NEAR = '200px 0px'

let observer: IntersectionObserver | undefined
const watched = new Map<Element, () => void>()

/** Calls `near` once when `element` comes within `NEAR` of the screen. Returns a function that stops waiting. */
function whenNearScreen(element: Element, near: () => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const call = watched.get(entry.target)
        watched.delete(entry.target)
        observer?.unobserve(entry.target)
        call?.()
      }
    },
    { rootMargin: NEAR },
  )
  watched.set(element, near)
  observer.observe(element)
  return () => {
    if (watched.delete(element)) observer?.unobserve(element)
  }
}

function remember(key: string, value: HighlightedCode | null) {
  known.delete(key)
  known.set(key, value)
  if (known.size > KEEP) known.delete(known.keys().next().value!)
}

function thread(): Worker | undefined {
  if (worker !== undefined || failures >= MAX_FAILURES) return worker
  try {
    worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module', name: 'highlight' })
  } catch {
    failures = MAX_FAILURES
    return undefined
  }
  worker.addEventListener('message', ({ data }: MessageEvent<HighlightReply>) => settle(data.id, data.result))
  worker.addEventListener('error', () => {
    if (current !== undefined) giveUp(current.id)
  })
  return worker
}

/** The worker failed or stalled on the block in hand: that block stays plain, and a new worker takes the rest. */
function giveUp(id: number) {
  worker?.terminate()
  worker = undefined
  failures++
  settle(id, undefined)
  if (failures >= MAX_FAILURES) waiting.clear()
}

function settle(id: number, result: HighlightedCode | undefined) {
  if (current?.id !== id) return
  clearTimeout(current.timer)
  const { request } = current
  current = undefined
  remember(request.key, result ?? null)
  for (const done of request.waiters) done(result)
  pump()
}

function pump() {
  if (current !== undefined) return
  const request = waiting.values().next().value
  if (request === undefined) return
  const target = thread()
  if (target === undefined) {
    waiting.clear()
    return
  }
  waiting.delete(request.key)
  const id = next++
  current = { request, id, timer: setTimeout(() => giveUp(id), TIMEOUT_MS) }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker messages have no target origin.
  target.postMessage({ id, code: request.code, language: request.language } satisfies HighlightRequest)
}

/** Asks for a block's colours. Returns a function that stops waiting for them. */
function request(code: string, language: string | undefined, done: Done): () => void {
  const key = keyOf(code, language)
  let entry = current?.request.key === key ? current.request : waiting.get(key)
  if (entry === undefined) {
    entry = { key, code, language, waiters: new Set() }
    waiting.set(key, entry)
    if (waiting.size > MAX_WAITING) waiting.delete(waiting.keys().next().value!)
  }
  const asked = entry
  asked.waiters.add(done)
  pump()
  return () => {
    asked.waiters.delete(done)
    if (asked.waiters.size === 0 && waiting.get(key) === asked) waiting.delete(key)
  }
}

/**
 * Colours a block once it is near the screen, even one whose colours are
 * known, so a topic that opens again does not paint its blocks off screen:
 * at once when the colours are known, else when the worker answers.
 * Returns a function that takes the colours off or stops waiting.
 */
export function paint(element: HTMLElement, code: string, language: string | undefined): () => void {
  if (language === 'plaintext') return nothing
  let stop = nothing
  const unwatch = whenNearScreen(element, () => {
    const value = known.get(keyOf(code, language))
    if (value !== undefined) {
      if (value !== null) stop = paintCode(element, value)
      return
    }
    stop = request(code, language, (result) => {
      if (result !== undefined) stop = paintCode(element, result)
    })
  })
  return () => {
    unwatch()
    stop()
  }
}
