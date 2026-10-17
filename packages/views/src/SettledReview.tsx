import type { HomeTopic } from '@juno/contract'
import { Button } from '@juno/ui'
import { ReviewExplainer, ReviewSheet } from './ReviewSheet'
import { settledCopy, type SettledStatus } from './settled'
import { SettledList, type SettledRowProps } from './SettledList'

export interface ResolveExplainerProps {
  readonly onSettings: () => void
}

/** What Resolve does, in four lines, and the way to Settings › Tidy up. */
export function ResolveExplainer({ onSettings }: ResolveExplainerProps) {
  return (
    <ReviewExplainer
      title={settledCopy.about}
      lines={settledCopy.explain}
      action={
        <Button variant="secondary" size="sm" onClick={onSettings} data-settled-settings="">
          {settledCopy.settings}
        </Button>
      }
    />
  )
}

export interface SettledReviewProps {
  readonly topics: ReadonlyArray<HomeTopic>
  readonly statuses: ReadonlyMap<string, SettledStatus>
  readonly now: number
  /** Start with What Resolve does open; the gallery shows it. */
  readonly initialAbout?: boolean
  readonly initialActive?: string
  readonly autoFocus?: boolean
  readonly onOpen: SettledRowProps['onOpen']
  readonly onResolve: SettledRowProps['onResolve']
  readonly onKeep: SettledRowProps['onKeep']
  readonly onUndo: SettledRowProps['onUndo']
  /** Resolves every proposal still open. */
  readonly onResolveAll: () => void
  readonly onSettings: () => void
  readonly onClose: () => void
}

const KEYS = [
  ['↑↓', 'Move'],
  ['↵', 'Open'],
  ['R', 'Resolve'],
  ['K', 'Keep open'],
] as const

/**
 * Tidy up's review (SPEC 12): a sheet with every topic that looks settled,
 * why, and Resolve or Keep open for each; Resolve all and Done at the
 * bottom, as a Mac sheet has its buttons. The info button says what
 * Resolve does and leads to Settings › Tidy up. A panel for `SheetLayer`,
 * which closes it on Esc and keeps Tab inside.
 */
export function SettledReview({ topics, statuses, now, initialAbout = false, initialActive, autoFocus = false, onOpen, onResolve, onKeep, onUndo, onResolveAll, onSettings, onClose }: SettledReviewProps) {
  const left = topics.filter((topic) => (statuses.get(topic.id) ?? 'open') === 'open').length
  return (
    <ReviewSheet
      sheet="settled"
      title={settledCopy.title(topics.length)}
      lead={settledCopy.lead}
      aboutLabel={settledCopy.about}
      about={<ResolveExplainer onSettings={onSettings} />}
      initialAbout={initialAbout}
      keys={KEYS}
      buttons={
        <>
          <Button variant="secondary" size="md" onClick={onClose} data-settled-close="">
            {settledCopy.done}
          </Button>
          <Button variant="primary" size="md" dimmed={left === 0} onClick={left === 0 ? undefined : onResolveAll} data-settled-resolve-all="">
            {settledCopy.resolveAll}
          </Button>
        </>
      }
    >
      <SettledList topics={topics} statuses={statuses} now={now} label={settledCopy.title(topics.length)} initialActive={initialActive} autoFocus={autoFocus} onOpen={onOpen} onResolve={onResolve} onKeep={onKeep} onUndo={onUndo} />
    </ReviewSheet>
  )
}
