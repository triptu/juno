/**
 * The choices of the check bar (spec section 8, inventory 7.3), as data:
 * what the bar shows for a draft the checks found something in, and what
 * each choice does. The wrong-place bar comes first; whichever place is
 * chosen, the clarity bar follows when clarity found something too.
 */
import type { ClarityFinding, RouteFinding, SendCheck } from '@juno/contract'
import type { SendCheckFinding } from '@juno/views'

/** Where a message goes: the composer's own topic, or the thread the wrong-place check pointed at. */
export type Destination = { readonly kind: 'here' } | { readonly kind: 'thread'; readonly threadTs: string; readonly title: string }

export type CheckBar =
  | { readonly kind: 'route'; readonly text: string; readonly route: RouteFinding; readonly clarity?: ClarityFinding }
  | { readonly kind: 'clarity'; readonly text: string; readonly clarity: ClarityFinding; readonly to: Destination }

export type Outcome = { readonly kind: 'send'; readonly text: string; readonly to: Destination } | { readonly kind: 'bar'; readonly bar: CheckBar } | { readonly kind: 'edit' }

const HERE: Destination = { kind: 'here' }

const sendOrClarity = (text: string, clarity: ClarityFinding | undefined, to: Destination): Outcome =>
  clarity === undefined ? { kind: 'send', text, to } : { kind: 'bar', bar: { kind: 'clarity', text, clarity, to } }

/** What Enter leads to once the checks answered: a send here, or a bar. */
export function afterCheck(text: string, found: SendCheck): Outcome {
  if (found.route !== undefined) return { kind: 'bar', bar: { kind: 'route', text, route: found.route, ...(found.clarity === undefined ? {} : { clarity: found.clarity }) } }
  return sendOrClarity(text, found.clarity, HERE)
}

/** The bar's first choice (Enter) or its second. */
export function choose(bar: CheckBar, choice: 'primary' | 'secondary'): Outcome {
  if (bar.kind === 'route') {
    const to: Destination = choice === 'primary' ? { kind: 'thread', threadTs: bar.route.threadTs, title: bar.route.title } : HERE
    return sendOrClarity(bar.text, bar.clarity, to)
  }
  const { fixes, fixed } = bar.clarity
  if (fixes.length === 0) return choice === 'primary' ? { kind: 'send', text: bar.text, to: bar.to } : { kind: 'edit' }
  return { kind: 'send', text: choice === 'primary' ? fixed : bar.text, to: bar.to }
}

/** What the bar view draws. */
export function findingOf(bar: CheckBar): { readonly finding: SendCheckFinding } {
  if (bar.kind === 'route') return { finding: { kind: 'route', title: bar.route.title } }
  const { fixes, note } = bar.clarity
  return { finding: { kind: 'clarity', fixes, ...(note === undefined ? {} : { note }) } }
}
