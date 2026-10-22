import * as stylex from '@stylexjs/stylex'
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Person, ReactionView } from '@juno/contract'
import { z } from '@juno/tokens/tokens.stylex'
import { chunk } from '@juno/ui'
import { hueFor } from './look'
import type { Reactor } from './ReactorsCard'
import { placeNear } from './reactorsPlace'

// The card loads during the hover delay, so it stays out of the start bundle.
const reactorsCard = chunk(() => import('./ReactorsCard'))
const ReactorsCard = reactorsCard.component((module) => module.ReactorsCard)

/** How long the pointer or keyboard focus rests on a chip before its card shows: the tooltip's delay, as on macOS. */
const DELAY_MS = 700
/** The reactions dialog (`ReactionsPopover`), which no card shows over. */
const DIALOG = '[data-reactions-dialog]'
/** Time to cross the gap from the chip into the card before it hides. */
const GRACE_MS = 150

/**
 * The reactors of one reaction that the window's people know. When you
 * reacted, Slack's list starts with you (`ReactionView.users`). Anyone not
 * known counts among "and N others".
 */
export function reactorsOf(reaction: ReactionView, people: ReadonlyMap<string, Person>): ReadonlyArray<Reactor> {
  return (reaction.users ?? []).flatMap((id, index) => {
    const person = people.get(id)
    if (person === undefined) return []
    return [{ id, name: person.name, you: reaction.me && index === 0, hue: hueFor(person.color, id), ...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl }) }]
  })
}

interface Open {
  readonly name: string
  readonly chip: HTMLElement
}

/**
 * The card of who reacted, for one message's chips: it shows after the
 * hover delay on a chip, or on keyboard focus, and stays while the pointer
 * is on the chip or the card. A press, Esc, a scroll or leaving hides it;
 * after a press it stays hidden until the pointer leaves that chip. It is
 * fixed in a portal on `body`, so it moves nothing.
 */
export function useReactorsPopover(reactions: ReadonlyArray<ReactionView>, people: ReadonlyMap<string, Person> | undefined, onSeeAll?: (name: string, chip: HTMLElement) => void) {
  const id = useId()
  const [open, setOpen] = useState<Open | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const muted = useRef<HTMLElement | undefined>(undefined)
  const cardRef = useRef<HTMLDivElement>(null)
  const ready = reactorsCard.useReady()

  const cancel = () => clearTimeout(timer.current)
  const later = (run: () => void, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(run, ms)
  }
  // From one chip to the next while a card shows, the next one's shows at once. None shows while the reactions dialog is open.
  const show = (name: string, chip: HTMLElement) => {
    void reactorsCard.load()
    if (people !== undefined && chip !== muted.current) later(() => document.querySelector(DIALOG) === null && setOpen({ name, chip }), open === undefined ? DELAY_MS : 0)
  }
  const hideSoon = () => hide(true)
  const hide = (wait: boolean) => (wait ? later(() => setOpen(undefined), GRACE_MS) : (clearTimeout(timer.current), setOpen(undefined)))

  useEffect(() => () => clearTimeout(timer.current), [])

  useDismiss(open, setOpen)

  // Placed before the first paint; the chip points at it while it shows.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (open === undefined || card === null) return
    placeNear(card, open.chip)
    open.chip.setAttribute('aria-describedby', id)
    return () => open.chip.removeAttribute('aria-describedby')
  }, [open, id, ready])

  const chipProps = (name: string) => ({
    onPointerEnter: (event: { readonly currentTarget: HTMLElement }) => show(name, event.currentTarget),
    onPointerLeave: (event: { readonly currentTarget: HTMLElement }) => {
      if (muted.current === event.currentTarget) muted.current = undefined
      hide(true)
    },
    onPointerDown: (event: { readonly currentTarget: HTMLElement }) => {
      muted.current = event.currentTarget
      hide(false)
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (event.currentTarget.matches(':focus-visible')) show(name, event.currentTarget)
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.matches(':hover')) hide(false)
    },
  })

  const reaction = open === undefined || !open.chip.isConnected ? undefined : reactions.find((each) => each.name === open.name)
  // See all hands over to the dialog: the card goes, and stays away until the pointer leaves the chip.
  const seeAll =
    onSeeAll === undefined || open === undefined
      ? undefined
      : () => {
          muted.current = open.chip
          hide(false)
          onSeeAll(open.name, open.chip)
        }
  const card = reaction === undefined || people === undefined || !ready ? null : <ReactorsLayer reaction={reaction} people={people} id={id} layerRef={cardRef} onEnter={cancel} onLeave={hideSoon} onSeeAll={seeAll} />
  return { chipProps, card }
}

/** Esc and any scroll hide the open card. */
function useDismiss(open: Open | undefined, setOpen: (open: Open | undefined) => void) {
  useEffect(() => {
    if (open === undefined) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(undefined)
    }
    const onScroll = () => setOpen(undefined)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open, setOpen])
}

interface ReactorsLayerProps {
  readonly reaction: ReactionView
  readonly people: ReadonlyMap<string, Person>
  readonly id: string
  readonly layerRef: RefObject<HTMLDivElement | null>
  readonly onEnter: () => void
  readonly onLeave: () => void
  readonly onSeeAll: (() => void) | undefined
}

/** The card for one reaction, fixed in a portal on `body`. */
function ReactorsLayer({ reaction, people, id, layerRef, onEnter, onLeave, onSeeAll }: ReactorsLayerProps) {
  const reactors = reactorsOf(reaction, people)
  return createPortal(
    <div ref={layerRef} {...stylex.props(styles.layer)}>
      <ReactorsCard
        id={id}
        name={reaction.name}
        emoji={reaction.unicode ?? `:${reaction.name}:`}
        {...(reaction.url === undefined ? {} : { url: reaction.url })}
        reactors={reactors}
        count={Math.max(reaction.count, reactors.length)}
        {...(onSeeAll === undefined ? {} : { onSeeAll })}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      />
    </div>,
    document.body,
  )
}

const styles = stylex.create({
  // Fixed over the window, moved into place by `placeNear` before it paints.
  layer: {
    position: 'fixed',
    top: 0,
    left: 0,
    zIndex: z['--z-menu'],
    WebkitAppRegion: 'no-drag',
  },
})
