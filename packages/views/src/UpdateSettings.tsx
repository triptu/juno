import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import type { ReleaseNote } from '@juno/contract'
import { layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Checkbox, ScrollArea, Text } from '@juno/ui'

/**
 * The update line under the version. `checking`, `current` and `failed` answer
 * Check for updates. `restart`: downloaded by a signed build, installed by
 * Restart to update. `download`: a newer version; an unsigned build offers the
 * DMG, and a signed build downloads in place. `progress` runs from 0 to 1 when known.
 */
export type UpdateStatus =
  | { readonly kind: 'checking' }
  | { readonly kind: 'current' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'restart'; readonly version: string }
  | { readonly kind: 'download'; readonly version: string; readonly download: 'none' | 'downloading' | 'failed'; readonly progress?: number }

/** "What's new" once asked for: loading, failed, or the changelog's sections. Null while closed. */
export type WhatsNew = null | { readonly for: 'installed' | 'update'; readonly notes: 'loading' | 'failed' | { readonly installedVersion: string; readonly availableVersions: ReadonlyArray<string>; readonly entries: ReadonlyArray<ReleaseNote> } }

export interface UpdateSettingsProps {
  /** The build line, with Check for updates beside it. */
  readonly build: ReactNode
  readonly available: boolean
  readonly enabled: boolean
  readonly status: UpdateStatus | null
  readonly whatsNew: WhatsNew
  readonly onChange: (enabled: boolean) => void
  readonly onCheck: () => void
  readonly onRestart: () => void
  readonly onDownload: () => void
  /** Puts a failed check's details on the clipboard. */
  readonly onCopyDetails: () => void
  /** Shows or hides the changelog for the installed version or for the offered update. */
  readonly onWhatsNew: (scope: 'installed' | 'update') => void
}

function statusLine(status: UpdateStatus): string {
  if (status.kind === 'checking') return 'Checking for updates…'
  if (status.kind === 'current') return 'Juno is up to date.'
  if (status.kind === 'failed') return 'Could not check for updates.'
  if (status.kind === 'restart') return `Juno ${status.version} is ready.`
  if (status.download === 'downloading') return `Downloading Juno ${status.version}…${status.progress === undefined ? '' : ` ${Math.floor(status.progress * 100)}%`}`
  if (status.download === 'failed') return `Juno ${status.version} could not be downloaded.`
  return `Juno ${status.version} is available.`
}

function StatusActions({ status, open, onRestart, onDownload, onCopyDetails, onWhatsNew }: { readonly status: UpdateStatus; readonly open: boolean } & Pick<UpdateSettingsProps, 'onRestart' | 'onDownload' | 'onCopyDetails' | 'onWhatsNew'>) {
  if (status.kind === 'failed') return <Button variant="ghost" size="sm" onClick={onCopyDetails}>Copy details</Button>
  if (status.kind !== 'restart' && status.kind !== 'download') return null
  return <>
    <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => onWhatsNew('update')}>What's new</Button>
    {status.kind === 'restart'
      ? <Button variant="outline" size="sm" onClick={onRestart}>Restart to update</Button>
      : status.download === 'downloading'
        ? null
        : <Button variant="outline" size="sm" onClick={onDownload}>{status.download === 'failed' ? 'Try again' : 'Download the new version'}</Button>}
  </>
}

function Notes({ notes }: { readonly notes: 'loading' | 'failed' | { readonly installedVersion: string; readonly availableVersions: ReadonlyArray<string>; readonly entries: ReadonlyArray<ReleaseNote> } }) {
  if (notes === 'loading') return <Text variant="meta" tone="muted" as="p">Loading what's new…</Text>
  if (notes === 'failed') return <Text variant="meta" tone="muted" as="p">Could not load what's new. Try again later.</Text>
  if (notes.entries.length === 0) return <Text variant="meta" tone="muted" as="p">No recent release notes.</Text>
  return (
    <ScrollArea sx={styles.scroll} aria-label="What's new">
      <div {...stylex.props(styles.notes)}>
      {notes.entries.map((note) => (
        <section key={note.version} {...stylex.props(styles.note)}>
          <div {...stylex.props(styles.heading)}><Text variant="ui" weight="medium" as="h3">Juno {note.version}{note.date === null ? '' : `, ${note.date}`}</Text>{note.version === notes.installedVersion ? <Text variant="meta" tone="muted">Installed</Text> : notes.availableVersions.includes(note.version) ? <Text variant="meta" tone="muted">Available</Text> : null}</div>
          <ul {...stylex.props(styles.lines)}>
            {note.lines.map((line, index) => <li key={index}><Text variant="body">{line}</Text></li>)}
          </ul>
        </section>
      ))}
      </div>
    </ScrollArea>
  )
}

/**
 * The version with Check for updates, the line that answers it or names a found
 * update, then the automatic setting. Background checks show nothing until they find an update.
 */
export function UpdateSettings({ build, available, enabled, status, whatsNew, onChange, onCheck, onRestart, onDownload, onCopyDetails, onWhatsNew }: UpdateSettingsProps) {
  const open = (scope: 'installed' | 'update') => whatsNew !== null && whatsNew.for === scope
  // Nothing to check while a check or download runs, or while an update waits for Restart to update.
  const busy = status !== null && (status.kind === 'checking' || status.kind === 'restart' || (status.kind === 'download' && status.download === 'downloading'))
  return <>
    <div {...stylex.props(styles.row)}>
      {build}
      {/* Dimmed rather than disabled, so a keyboard press keeps focus on it. */}
      {available ? <Button variant="secondary" size="sm" dimmed={busy} onClick={busy ? undefined : onCheck}>Check for updates</Button> : null}
    </div>
    {status === null ? null : <div {...stylex.props(styles.row, styles.status)}>
      <Text variant="meta" tone="muted" numeric as="p">{statusLine(status)}</Text>
      <StatusActions status={status} open={open('update')} onRestart={onRestart} onDownload={onDownload} onCopyDetails={onCopyDetails} onWhatsNew={onWhatsNew} />
    </div>}
    <div {...stylex.props(styles.row)}>
      <Checkbox label="Download updates automatically" checked={enabled} disabled={!available} onChange={(event) => onChange(event.currentTarget.checked)} />
      {available ? <Button variant="ghost" size="sm" aria-expanded={open('installed')} onClick={() => onWhatsNew('installed')}>What's new</Button> : null}
    </div>
    {whatsNew === null ? null : <Notes notes={whatsNew.notes} />}
  </>
}

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing['--space-3'],
  },
  // As tall as its buttons, so the line keeps its height from "Checking…" to the answer.
  status: { minHeight: sizes['--control-28'] },
  notes: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
  },
  scroll: { maxHeight: layout['--popover-max-height'] },
  heading: { display: 'flex', alignItems: 'baseline', gap: spacing['--space-2'] },
  note: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
  },
  lines: {
    margin: 0,
    paddingInlineStart: spacing['--space-5'],
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
  },
})
