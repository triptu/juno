import type { PhosphorIcon } from '@juno/ui'

/** What the user did with a row while the review is open: the card's action, its "no", or nothing yet. */
export type ReviewStatus = 'open' | 'done' | 'declined'

/** One proposal as the sheet shows it. */
export interface ReviewEntry {
  /** Unique in the sheet. */
  readonly id: string
  /** The topic the row opens; its art draws the tile. */
  readonly topicId: string
  readonly title: string
  readonly art?: string
  /** Why it is proposed: a fact from the data, in plain words. */
  readonly reason?: string
  /** A message or draft the reason refers to, quoted under it. */
  readonly quote?: string
  /** Where it is and when: "eng · 2d". */
  readonly meta: string
  /** This row's own words when they differ from the card's (Automated's record: Move back, or Move to Automated). The keys stay the card's. */
  readonly words?: ReviewWords
}

/** A row's words: its two buttons and what it says once one was used. */
export type ReviewWords = Omit<ReviewVerbs, 'actKey' | 'declineKey'>

/** A card's words for its two buttons, their keys and what a row says once acted on. */
export interface ReviewVerbs {
  /** "Resolve". */
  readonly act: string
  readonly actIcon?: PhosphorIcon
  /** One letter: "R". */
  readonly actKey: string
  /** The "no": "Keep open". */
  readonly decline: string
  readonly declineKey: string
  /** "Resolved". */
  readonly done: string
  /** "Kept open". */
  readonly declined: string
}

/** The words every review shares. */
export const reviewCopy = { undo: 'Undo', close: 'Done', move: 'Move', open: 'Open' } as const
