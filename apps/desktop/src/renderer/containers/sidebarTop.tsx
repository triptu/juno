import type { ReactElement } from 'react'
import { HuddleBarSlot, IncomingHuddleSlot } from './huddle/slots'

/**
 * The bars at the top of the sidebar, under the title bar and above Juno,
 * in order (the Sidebar view's `top` slot). Each entry is a keyed element of
 * a container that reads its own state and renders nothing while its
 * feature is idle, so the Sidebar container never re-renders for it. The
 * huddle bar goes here, and under it the card of a huddle someone just
 * started, so a card coming never moves the call's bar.
 */
export const sidebarTop: ReadonlyArray<ReactElement> = [<HuddleBarSlot key="huddle" />, <IncomingHuddleSlot key="incoming" />]
