/**
 * `expect` for the DOM lane: on a `Query`, the Playwright assertions the
 * ported tests use, each polled until it holds or its timeout (5 s) runs
 * out; on any other value, Bun's own `expect`. `expect.poll` polls a
 * function, as Playwright's does. There is no assertion on a box, a
 * colour or a computed style (README, "The rule").
 */
import { expect as bunExpect } from 'bun:test'
import { checked, disabled, matches, nameOf, shown, type El, type TextMatch } from './find'
import { Query } from './query'

const DEFAULT_TIMEOUT = 5_000

interface Timeout { readonly timeout?: number }

const text = (el: El) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
const value = (el: El) => (el as HTMLInputElement).value ?? ''

export interface QueryAssertions {
  toBeVisible(options?: Timeout & { readonly visible?: boolean }): Promise<void>
  toBeHidden(options?: Timeout): Promise<void>
  toBeAttached(options?: Timeout): Promise<void>
  toHaveCount(count: number, options?: Timeout): Promise<void>
  toHaveText(text: TextMatch | ReadonlyArray<TextMatch>, options?: Timeout): Promise<void>
  toContainText(text: TextMatch, options?: Timeout): Promise<void>
  toHaveAttribute(name: string, value?: TextMatch, options?: Timeout): Promise<void>
  toHaveValue(value: TextMatch, options?: Timeout): Promise<void>
  toBeFocused(options?: Timeout): Promise<void>
  toBeDisabled(options?: Timeout): Promise<void>
  toBeEnabled(options?: Timeout): Promise<void>
  toBeChecked(options?: Timeout & { readonly checked?: boolean }): Promise<void>
  toHaveAccessibleName(name: TextMatch, options?: Timeout): Promise<void>
  toHaveAccessibleDescription(name: TextMatch, options?: Timeout): Promise<void>
  toBeEmpty(options?: Timeout): Promise<void>
}

/** Each assertion as a check of what the query finds now: whether it holds, and what was seen, only worked out for a failure. */
function checks(query: Query): Record<keyof QueryAssertions, (...args: never[]) => { readonly pass: boolean; readonly seen: () => string }> {
  const seenText = (found: El[]) => () => JSON.stringify(found.map(text).slice(0, 5))
  return {
    toBeVisible: (options?: { visible?: boolean }) => { const found = query.all(); const pass = found.some(shown); return { pass: options?.visible === false ? !pass : pass, seen: () => `${found.length} match(es), ${found.filter(shown).length} shown` } },
    toBeHidden: () => { const found = query.all(); return { pass: !found.some(shown), seen: () => `${found.filter(shown).length} shown` } },
    toBeAttached: () => { const count = query.count(); return { pass: count > 0, seen: () => `${count} match(es)` } },
    toHaveCount: (count: number) => { const actual = query.count(); return { pass: actual === count, seen: () => `${actual}` } },
    toHaveText: (wanted: TextMatch | ReadonlyArray<TextMatch>) => {
      const found = query.all()
      if (Array.isArray(wanted)) return { pass: found.length === wanted.length && found.every((el, at) => matches(text(el), wanted[at]!, true)), seen: seenText(found) }
      const el = found[0]
      return { pass: el !== undefined && matches(text(el), wanted as TextMatch, true), seen: seenText(found) }
    },
    toContainText: (wanted: TextMatch) => { const found = query.all(); const el = found[0]; return { pass: el !== undefined && matches(text(el), wanted), seen: seenText(found) } },
    toHaveAttribute: (name: string, wanted?: TextMatch) => {
      const el = query.el()
      const actual = el?.getAttribute(name) ?? null
      return { pass: actual !== null && (wanted === undefined || matches(actual, wanted, true)), seen: () => JSON.stringify(actual) }
    },
    toHaveValue: (wanted: TextMatch) => { const el = query.el(); return { pass: el !== undefined && matches(value(el), wanted, true), seen: () => JSON.stringify(el === undefined ? null : value(el)) } },
    toBeFocused: () => { const el = query.el(); const active = el?.ownerDocument.activeElement; return { pass: el !== undefined && active === el, seen: () => (active === null || active === undefined ? 'nothing focused' : (active as El).outerHTML.slice(0, 160)) } },
    toBeDisabled: () => { const el = query.el(); return { pass: el !== undefined && disabled(el), seen: () => (el === undefined ? 'no match' : 'enabled') } },
    toBeEnabled: () => { const el = query.el(); return { pass: el !== undefined && !disabled(el), seen: () => (el === undefined ? 'no match' : 'disabled') } },
    toBeChecked: (options?: { checked?: boolean }) => { const el = query.el(); return { pass: el !== undefined && checked(el) === (options?.checked ?? true), seen: () => (el === undefined ? 'no match' : String(checked(el))) } },
    toHaveAccessibleName: (wanted: TextMatch) => { const el = query.el(); const name = el === undefined ? null : nameOf(el); return { pass: name !== null && matches(name, wanted, true), seen: () => JSON.stringify(name) } },
    toHaveAccessibleDescription: (wanted: TextMatch) => {
      const el = query.el()
      const description = el?.getAttribute('aria-describedby')?.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ') ?? el?.getAttribute('aria-description') ?? ''
      return { pass: el !== undefined && matches(description, wanted, true), seen: () => JSON.stringify(description) }
    },
    toBeEmpty: () => { const found = query.all(); const el = found[0]; return { pass: el !== undefined && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? value(el) === '' : text(el) === ''), seen: seenText(found) } },
  }
}

const LAST_ARGUMENT_TIMEOUT: Partial<Record<keyof QueryAssertions, number>> = { toBeVisible: 0, toBeHidden: 0, toBeAttached: 0, toBeFocused: 0, toBeDisabled: 0, toBeEnabled: 0, toBeChecked: 0, toBeEmpty: 0, toHaveCount: 1, toHaveText: 1, toContainText: 1, toHaveValue: 1, toHaveAccessibleName: 1, toHaveAccessibleDescription: 1, toHaveAttribute: 2 }

function assertions(query: Query, negate: boolean): QueryAssertions {
  const all = checks(query)
  return Object.fromEntries(Object.entries(all).map(([name, check]) => [name, async (...args: unknown[]) => {
    const options = args[LAST_ARGUMENT_TIMEOUT[name as keyof QueryAssertions] ?? 0] as Timeout | undefined
    const timeout = (typeof options === 'object' && options !== null && 'timeout' in options ? options.timeout : undefined) ?? DEFAULT_TIMEOUT
    const deadline = performance.now() + timeout
    for (;;) {
      const { pass, seen } = (check as (...given: unknown[]) => { pass: boolean; seen: () => string })(...args)
      if (pass !== negate) return
      if (performance.now() > deadline) {
        const page = query.dom.document.body?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 600) ?? ''
        throw new Error(`expect(${query.description})${negate ? '.not' : ''}.${name}(${args.filter((arg) => typeof arg !== 'object' || arg instanceof RegExp || Array.isArray(arg)).map((arg) => String(arg)).join(', ')}) failed after ${timeout} ms; saw ${seen()}\nPage text: ${page}`)
      }
      await query.dom.changed()
    }
  }])) as unknown as QueryAssertions
}

interface PollAssertions<T> {
  toBe(expected: T): Promise<void>
  toEqual(expected: unknown): Promise<void>
  toContain(expected: unknown): Promise<void>
  toContainEqual(expected: unknown): Promise<void>
  toMatch(expected: TextMatch): Promise<void>
  toBeGreaterThan(expected: number): Promise<void>
  toBeGreaterThanOrEqual(expected: number): Promise<void>
  toBeLessThan(expected: number): Promise<void>
  toBeTruthy(): Promise<void>
  toBeUndefined(): Promise<void>
  toBeDefined(): Promise<void>
  toBeNull(): Promise<void>
  toHaveLength(length: number): Promise<void>
  readonly not: Omit<PollAssertions<T>, 'not'>
}

/** Polls `read` until Bun's matcher of that name passes on its answer. */
function poll<T>(read: () => T | Promise<T>, options: Timeout & { readonly message?: string } = {}, negate = false): PollAssertions<T> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT
  const matcher = (name: string) => async (...args: unknown[]) => {
    const deadline = performance.now() + timeout
    for (;;) {
      const value = await read()
      try {
        const subject = bunExpect(value, options.message) as unknown as { readonly not: Record<string, (...given: unknown[]) => void> } & Record<string, (...given: unknown[]) => void>
        const matchers = negate ? subject.not : subject
        matchers[name]!(...args)
        return
      } catch (error) {
        if (performance.now() > deadline) throw error
      }
      await new Promise((done) => setTimeout(done, 20))
    }
  }
  const names = ['toBe', 'toEqual', 'toContain', 'toContainEqual', 'toMatch', 'toBeGreaterThan', 'toBeGreaterThanOrEqual', 'toBeLessThan', 'toBeTruthy', 'toBeUndefined', 'toBeDefined', 'toBeNull', 'toHaveLength'] as const
  const result = Object.fromEntries(names.map((name) => [name, matcher(name)])) as unknown as PollAssertions<T>
  if (!negate) Object.defineProperty(result, 'not', { get: () => poll(read, options, true) })
  return result
}

type Assertions = QueryAssertions & { readonly not: QueryAssertions }

type Asymmetric = Pick<typeof bunExpect, 'any' | 'anything' | 'arrayContaining' | 'objectContaining' | 'stringContaining' | 'stringMatching'>

interface Expect extends Asymmetric {
  (query: Query, message?: string): Assertions
  <T>(value: T, message?: string): ReturnType<typeof bunExpect<T>>
  poll<T>(read: () => T | Promise<T>, options?: Timeout & { readonly message?: string }): PollAssertions<T>
}

export const expect: Expect = Object.assign(
  (subject: unknown, message?: string) => {
    if (subject instanceof Query) {
      const positive = assertions(subject, false)
      return Object.assign(positive, { not: assertions(subject, true) })
    }
    return bunExpect(subject, message)
  },
  {
    poll,
    any: bunExpect.any,
    anything: bunExpect.anything,
    arrayContaining: bunExpect.arrayContaining,
    objectContaining: bunExpect.objectContaining,
    stringContaining: bunExpect.stringContaining,
    stringMatching: bunExpect.stringMatching,
  },
) as Expect
