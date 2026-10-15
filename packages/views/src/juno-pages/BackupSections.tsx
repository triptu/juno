import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { chatCopy, type JobId, type JunoSettingsPage as JunoSettingsPageModel, type Ownership } from '@juno/agent-contract'
import { Button, Chip, ListRow, Section, Surface, Text } from '@juno/ui'
import { cell } from './cell'
import { fullTime, messageTime } from '../time'

/**
 * Settings › Juno's Backup and This Mac sections (SPEC 13.8, 13.10): the
 * backup folder and the last backup, the recovery phrase, who owns Juno's
 * state, Move and Restore. The sheets they open are in `BackupSheets.tsx`.
 */

type Page = Pick<JunoSettingsPageModel, 'backupFolder' | 'lastBackupAt' | 'recoveryPhraseExportedAt' | 'ownership' | 'removalPending'>

export interface BackupSectionProps {
  readonly page: Page
  readonly now: number
  readonly onBackupFolder: () => void
  readonly onExportPhrase: () => void
  /** A folder change or an export in flight: its button waits. */
  readonly backupBusy?: 'folder' | 'phrase'
  /** Why the last folder change or export failed, under its row. */
  readonly backupError?: { readonly row: 'folder' | 'phrase'; readonly message: string }
}

export function BackupSection({ page, now, onBackupFolder, onExportPhrase, backupBusy, backupError }: BackupSectionProps) {
  const copy = chatCopy.pages.settings
  return (
    <Section heading="Backup" sub="An encrypted copy of Juno's state, in a folder you choose.">
      <Surface kind="group" data-backup="">
        <ListRow
          trailing={
            <Button variant="ghost" size="xs" tone="subtle" onClick={onBackupFolder} disabled={backupBusy === 'folder'}>
              Choose folder
            </Button>
          }
        >
          <span {...stylex.props(cell.lines)}>
            <Text variant="body" truncate title={page.backupFolder} data-backup-folder="">
              {page.backupFolder}
            </Text>
            <Text variant="meta" tone="muted" data-last-backup="">
              {page.lastBackupAt === undefined ? (
                'No backup yet'
              ) : (
                <>
                  Last backup <time title={fullTime(page.lastBackupAt)}>{messageTime(page.lastBackupAt, now)}</time>
                </>
              )}
            </Text>
            {backupError?.row === 'folder' ? <ErrorLine>{backupError.message}</ErrorLine> : null}
          </span>
        </ListRow>
        <ListRow
          divider={false}
          trailing={
            <Button variant="ghost" size="xs" tone="subtle" onClick={onExportPhrase} disabled={backupBusy === 'phrase'}>
              {copy.exportPhrase}
            </Button>
          }
        >
          <span {...stylex.props(cell.lines)}>
            <Text variant="body">Recovery phrase</Text>
            <Text variant="meta" tone="muted" data-phrase-exported={page.recoveryPhraseExportedAt === undefined ? 'no' : 'yes'}>
              {page.recoveryPhraseExportedAt === undefined ? (
                'Not exported yet. Without it a backup cannot be read on another Mac.'
              ) : (
                <>
                  Exported <time title={fullTime(page.recoveryPhraseExportedAt)}>{messageTime(page.recoveryPhraseExportedAt, now)}</time>
                </>
              )}
            </Text>
            {backupError?.row === 'phrase' ? <ErrorLine>{backupError.message}</ErrorLine> : null}
          </span>
        </ListRow>
      </Surface>
    </Section>
  )
}

export interface ThisMacSectionProps {
  readonly page: Page
  readonly onMove: () => void
  readonly onRestore: () => void
  /** Without it a removal pending in a job is not shown. */
  readonly onStopJob?: (jobId: JobId) => void
}

export function ThisMacSection({ page, onMove, onRestore, onStopJob }: ThisMacSectionProps) {
  const copy = chatCopy.pages.settings
  return (
    <Section heading="This Mac" sub="Juno runs on one Mac at a time.">
      <Surface kind="group" data-ownership={ownerState(page.ownership)}>
        <OwnerRow ownership={page.ownership} />
        {page.removalPending !== undefined && onStopJob !== undefined ? (
          <ListRow
            data-removal-pending=""
            trailing={
              <Button variant="ghost" size="xs" tone="subtle" onClick={() => page.removalPending !== undefined && onStopJob(page.removalPending.jobId)}>
                {copy.stopJob}
              </Button>
            }
          >
            <Text variant="body">{copy.removalPending(page.removalPending.copies)}</Text>
          </ListRow>
        ) : null}
        <ListRow
          trailing={
            <Button variant="ghost" size="xs" tone="subtle" onClick={onMove} disabled={page.ownership._tag !== 'active'}>
              Move
            </Button>
          }
        >
          <span {...stylex.props(cell.lines)}>
            <Text variant="body">{copy.move}</Text>
            <Text variant="meta" tone="muted">
              Finishes what is running, then hands Juno over with a final backup.
            </Text>
          </span>
        </ListRow>
        <ListRow
          divider={false}
          trailing={
            <Button variant="ghost" size="xs" tone="subtle" onClick={onRestore}>
              Restore
            </Button>
          }
        >
          <span {...stylex.props(cell.lines)}>
            <Text variant="body">{copy.restore}</Text>
            <Text variant="meta" tone="muted">
              Takes over from a backup, after you confirm the old Mac is off.
            </Text>
          </span>
        </ListRow>
      </Surface>
    </Section>
  )
}

type OwnerState = 'active' | 'moving' | 'moved' | 'otherMac' | 'recovery'

/** `released` reads three ways: the move's final backup is being written, it is written, or another Mac took over. */
function ownerState(ownership: Ownership): OwnerState {
  if (ownership._tag !== 'released') return ownership._tag
  if (ownership.deviceName !== undefined) return 'otherMac'
  return ownership.moveCode === undefined ? 'moving' : 'moved'
}

/** Who owns Juno's state: the line, and its chip. */
function OwnerRow({ ownership }: { readonly ownership: Ownership }) {
  const copy = chatCopy.pages.settings.owner
  const state = ownerState(ownership)
  const line =
    ownership._tag === 'recovery'
      ? copy.recovery.line(ownership.pending)
      : ownership._tag === 'released' && state === 'moved'
        ? copy.moved.line(ownership.moveCode ?? '')
        : ownership._tag === 'released' && state === 'otherMac'
          ? copy.otherMac.line(ownership.deviceName ?? '')
          : state === 'moving'
            ? copy.moving.line
            : copy.active.line
  return (
    <ListRow
      trailing={
        <Chip variant={state === 'active' ? 'filled' : 'outline'} size={20}>
          {copy[state].chip}
        </Chip>
      }
    >
      <Text variant="body" sx={cell.wrap} data-owner-line="">
        {line}
      </Text>
    </ListRow>
  )
}

function ErrorLine({ children }: { readonly children: ReactNode }) {
  return (
    <Text variant="meta" tone="danger" role="alert" sx={cell.wrap}>
      {children}
    </Text>
  )
}
