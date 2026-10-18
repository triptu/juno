import * as stylex from '@stylexjs/stylex'
import type { ReleaseNote } from '@juno/contract'
import { layout, spacing } from '@juno/tokens/tokens.stylex'
import { Button, Checkbox, ScrollArea, Text } from '@juno/ui'

/**
 * A newer version. `restart`: downloaded by a signed build, installed by Restart to
 * update. `download`: an unsigned build offers the DMG instead.
 */
export type UpdateOffer =
  | { readonly kind: 'restart'; readonly version: string }
  | { readonly kind: 'download'; readonly version: string; readonly download: 'none' | 'downloading' | 'failed' }

/** "What's new" once asked for: loading, failed, or the changelog's sections. Null while closed. */
export type WhatsNew = null | { readonly for: 'installed' | 'update'; readonly notes: 'loading' | 'failed' | { readonly installedVersion: string; readonly availableVersions: ReadonlyArray<string>; readonly entries: ReadonlyArray<ReleaseNote> } }

export interface UpdateSettingsProps {
  readonly available: boolean
  readonly enabled: boolean
  readonly offer: UpdateOffer | null
  readonly whatsNew: WhatsNew
  readonly onChange: (enabled: boolean) => void
  readonly onRestart: () => void
  readonly onDownload: () => void
  /** Shows or hides the changelog for the installed version or for the offered update. */
  readonly onWhatsNew: (scope: 'installed' | 'update') => void
}

function offerLine(offer: UpdateOffer): string {
  if (offer.kind === 'restart') return `Juno ${offer.version} is ready.`
  if (offer.download === 'downloading') return `Downloading Juno ${offer.version}…`
  if (offer.download === 'failed') return `Juno ${offer.version} could not be downloaded.`
  return `Juno ${offer.version} is available.`
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

/** Background updates have no progress UI or dialogs. Only a found update needs attention. */
export function UpdateSettings({ available, enabled, offer, whatsNew, onChange, onRestart, onDownload, onWhatsNew }: UpdateSettingsProps) {
  const open = (scope: 'installed' | 'update') => whatsNew !== null && whatsNew.for === scope
  return <>
    <div {...stylex.props(styles.row)}>
      <Checkbox label="Download updates automatically" checked={enabled} disabled={!available} onChange={(event) => onChange(event.currentTarget.checked)} />
      {available ? <Button variant="ghost" size="sm" aria-expanded={open('installed')} onClick={() => onWhatsNew('installed')}>What's new</Button> : null}
    </div>
    {offer === null ? null : <div {...stylex.props(styles.row)}>
      <Text variant="meta" tone="muted" as="p">{offerLine(offer)}</Text>
      <Button variant="ghost" size="sm" aria-expanded={open('update')} onClick={() => onWhatsNew('update')}>What's new</Button>
      {offer.kind === 'restart'
        ? <Button variant="outline" size="sm" onClick={onRestart}>Restart to update</Button>
        : <Button variant="outline" size="sm" disabled={offer.download === 'downloading'} onClick={onDownload}>
          {offer.download === 'failed' ? 'Try again' : 'Download the new version'}
        </Button>}
    </div>}
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
