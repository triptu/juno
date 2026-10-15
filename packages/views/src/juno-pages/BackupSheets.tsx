import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, type ReactNode } from 'react'
import { chatCopy } from '@juno/agent-contract'
import { colors, fonts, layout, spacing, text, z } from '@juno/tokens/tokens.stylex'
import { Button, Checkbox, Surface, Text, TextField } from '@juno/ui'
import { cell } from './cell'

/**
 * The sheets of Settings › Juno's Backup and This Mac rows (SPEC 13.8):
 * the recovery phrase after an export, Restore from backup with the owner's
 * word that the old Mac is off, and Move to another Mac. Each is a panel in
 * `SheetLayer`, which dims the page and closes on Escape.
 */

/** Dims the page under a centred sheet. Escape calls `onClose`; a click outside does nothing, so a sheet is never lost by accident. */
export function SheetLayer({ onClose, children }: { readonly onClose: () => void; readonly children: ReactNode }) {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return <div {...stylex.props(styles.layer)}>{children}</div>
}

function Sheet({ label, kind, children }: { readonly label: string; readonly kind: 'phrase' | 'restore' | 'move'; readonly children: ReactNode }) {
  return (
    <Surface kind="popover" as="section" role="dialog" aria-label={label} aria-modal padding="none" sx={styles.sheet} data-sheet={kind}>
      <div {...stylex.props(styles.inner)}>{children}</div>
    </Surface>
  )
}

function Head({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <span {...stylex.props(styles.head)}>
      <Text variant="heading" tone="default" as="h2">
        {title}
      </Text>
      <Text variant="bodySmall" tone="subtle" as="p" sx={cell.wrap}>
        {body}
      </Text>
    </span>
  )
}

/** A control with its name above it and, if given, a note below. */
function Labelled({ label, note, children }: { readonly label: string; readonly note?: string; readonly children: ReactNode }) {
  return (
    <div {...stylex.props(styles.labelled)}>
      <Text variant="bodySmall" weight="medium" tone="default" aria-hidden>
        {label}
      </Text>
      {children}
      {note === undefined ? null : (
        <Text variant="meta" tone="muted" sx={cell.wrap}>
          {note}
        </Text>
      )}
    </div>
  )
}

function Buttons({ children }: { readonly children: ReactNode }) {
  return <div {...stylex.props(styles.buttons)}>{children}</div>
}

function ErrorLine({ message }: { readonly message: string | undefined }) {
  return message === undefined ? null : (
    <Text variant="meta" tone="danger" role="alert" as="p" sx={cell.wrap}>
      {message}
    </Text>
  )
}

export interface RecoveryPhraseSheetProps {
  /** `ABCD-EFGH-…`: eight groups of four. */
  readonly phrase: string
  /** Copy was pressed: the button says so. */
  readonly copied: boolean
  readonly onCopy: () => void
  readonly onDone: () => void
}

/** The phrase, shown once after Export recovery phrase. Two lines of four groups, in the mono face so 0 and 8 never blur. */
export function RecoveryPhraseSheet({ phrase, copied, onCopy, onDone }: RecoveryPhraseSheetProps) {
  const copy = chatCopy.pages.settings.phraseSheet
  const groups = phrase.split(/[\s-]+/).filter((group) => group !== '')
  return (
    <Sheet label={copy.title} kind="phrase">
      <Head title={copy.title} body={copy.body} />
      <Surface kind="inset" padding="none" sx={styles.phraseBox}>
        <span {...stylex.props(styles.phrase)} data-recovery-phrase="" aria-label={copy.title}>
          {groups.map((group, index) => (
            <span key={index} {...stylex.props(styles.group)}>
              {group}
            </span>
          ))}
        </span>
      </Surface>
      <Buttons>
        <Button variant="secondary" size="md" onClick={onCopy}>
          {copied ? copy.copied : copy.copy}
        </Button>
        <Button variant="primary" size="md" onClick={onDone} autoFocus>
          {copy.done}
        </Button>
      </Buttons>
    </Sheet>
  )
}

export interface RestoreSheetProps {
  /** The folder chosen to restore from. */
  readonly folder?: string
  readonly phrase: string
  readonly attested: boolean
  /** The restore was sent and has not answered. */
  readonly busy: boolean
  /** Why the restore was refused: the agent's line, or the typed phrase's. */
  readonly error?: string
  readonly onChooseFolder: () => void
  readonly onPhrase: (phrase: string) => void
  readonly onAttest: (attested: boolean) => void
  readonly onRestore: () => void
  readonly onCancel: () => void
}

/** Restore from backup: the folder, the phrase on a new Mac, and the owner's word that the old Mac is off. */
export function RestoreSheet({ folder, phrase, attested, busy, error, onChooseFolder, onPhrase, onAttest, onRestore, onCancel }: RestoreSheetProps) {
  const copy = chatCopy.pages.settings.restoreSheet
  return (
    <Sheet label={copy.title} kind="restore">
      <Head title={copy.title} body={copy.body} />
      <Labelled label={copy.folder}>
        <Surface kind="inset" padding="none" sx={styles.folder}>
          <Text variant="ui" tone={folder === undefined ? 'muted' : 'default'} truncate title={folder} data-restore-folder="">
            {folder ?? copy.noFolder}
          </Text>
          <Button variant="ghost" size="xs" tone="subtle" onClick={onChooseFolder} disabled={busy}>
            {copy.choose}
          </Button>
        </Surface>
      </Labelled>
      <Labelled label={copy.phrase} note={copy.phraseNote}>
        <TextField
          size={32}
          label={copy.phrase}
          value={phrase}
          onChange={(event) => onPhrase(event.currentTarget.value)}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          disabled={busy}
        />
      </Labelled>
      <Checkbox label={copy.attest} description={copy.attestNote} checked={attested} onChange={(event) => onAttest(event.currentTarget.checked)} disabled={busy} />
      <ErrorLine message={error} />
      <Buttons>
        <Button variant="secondary" size="md" onClick={onCancel} autoFocus>
          {copy.cancel}
        </Button>
        <Button variant="primary" size="md" onClick={onRestore} disabled={busy || folder === undefined || !attested}>
          {copy.restore}
        </Button>
      </Buttons>
    </Sheet>
  )
}

export interface MoveSheetProps {
  readonly busy: boolean
  readonly error?: string
  readonly onMove: () => void
  readonly onCancel: () => void
}

/** Move to another Mac. The move code shows in the This Mac row once the final backup is written. */
export function MoveSheet({ busy, error, onMove, onCancel }: MoveSheetProps) {
  const copy = chatCopy.pages.settings.moveSheet
  return (
    <Sheet label={copy.title} kind="move">
      <Head title={copy.title} body={copy.body} />
      <ErrorLine message={error} />
      <Buttons>
        <Button variant="secondary" size="md" onClick={onCancel} autoFocus>
          {copy.cancel}
        </Button>
        <Button variant="primary" size="md" onClick={onMove} disabled={busy}>
          {copy.move}
        </Button>
      </Buttons>
    </Sheet>
  )
}

const styles = stylex.create({
  layer: {
    position: 'fixed',
    inset: 0,
    zIndex: z['--z-palette'],
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['--space-6'],
    backgroundColor: colors['--overlay'],
  },
  sheet: {
    width: '100%',
    maxWidth: layout['--palette-width'],
    boxSizing: 'border-box',
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-4'],
    padding: spacing['--space-5'],
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1'],
  },
  labelled: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-1-5'],
  },
  folder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing['--space-3'],
    minWidth: 0,
    paddingBlock: spacing['--space-1'],
    paddingInlineStart: spacing['--space-3'],
    paddingInlineEnd: spacing['--space-1'],
  },
  phraseBox: {
    display: 'flex',
    justifyContent: 'center',
    paddingBlock: spacing['--space-4'],
    paddingInline: spacing['--space-4'],
  },
  phrase: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, auto)',
    columnGap: spacing['--space-4'],
    rowGap: spacing['--space-2'],
    fontFamily: fonts['--font-mono'],
    fontSize: text['--text-heading-size'],
    color: colors['--foreground-default'],
    userSelect: 'text',
  },
  group: {
    fontVariantNumeric: 'tabular-nums',
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacing['--space-1-5'],
  },
})
