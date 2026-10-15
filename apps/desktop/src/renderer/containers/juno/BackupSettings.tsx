import { useState, type ReactNode } from 'react'
import { chatCopy } from '@juno/agent-contract'
import { copyText, registry } from '@juno/state'
import { chooseFolder, junoPageActions, takeRecoveryPhrase, typeRecoveryPhrase, type CommandAnswer } from '@juno/state/agent'
import { MoveSheet, RecoveryPhraseSheet, RestoreSheet, SheetLayer, type JunoSettingsPageProps } from '@juno/views'
import { openJunoPage } from '../navigation'

const actions = junoPageActions(registry)

/** The agent's line when it gave one, else one plain line. */
const why = (answer: CommandAnswer) => ('message' in answer && answer.message !== undefined ? answer.message : 'That did not work. Try again.')

type Sheet =
  | { readonly _tag: 'phrase'; readonly phrase: string; readonly copied: boolean }
  | { readonly _tag: 'restore'; readonly folder?: string; readonly phrase: string; readonly attested: boolean; readonly busy: boolean; readonly error?: string }
  | { readonly _tag: 'move'; readonly busy: boolean; readonly error?: string }

type BackupProps = Required<Pick<JunoSettingsPageProps, 'onBackupFolder' | 'onExportPhrase' | 'onMove' | 'onRestore' | 'onStopJob'>> &
  Pick<JunoSettingsPageProps, 'backupBusy' | 'backupError'>

/**
 * Settings › Juno's Backup and This Mac (SPEC 13.8, WP21): the folder
 * picker, Export recovery phrase, Move and Restore, and the sheets they
 * open. The phrase comes from main once, lives in this sheet's state while
 * it shows, and is gone when the sheet closes.
 */
export function useBackupSettings(): { readonly props: BackupProps; readonly sheet: ReactNode } {
  const [busy, setBusy] = useState<BackupProps['backupBusy']>(undefined)
  const [error, setError] = useState<BackupProps['backupError']>(undefined)
  const [sheet, setSheet] = useState<Sheet | undefined>(undefined)

  const chooseBackupFolder = async () => {
    const path = await chooseFolder('backup')
    if (path === undefined) return
    setError(undefined)
    setBusy('folder')
    const answer = await actions.backupFolder(path)
    setBusy(undefined)
    if (answer.outcome !== 'ok') setError({ row: 'folder', message: why(answer) })
  }

  const exportPhrase = async () => {
    if (busy === 'phrase') return
    setError(undefined)
    setBusy('phrase')
    const answer = await actions.ownership({ _tag: 'exportPhrase' })
    const phrase = answer.outcome === 'ok' ? await takeRecoveryPhrase() : undefined
    setBusy(undefined)
    if (phrase !== undefined) setSheet({ _tag: 'phrase', phrase, copied: false })
    else setError({ row: 'phrase', message: answer.outcome === 'ok' ? 'Juno could not show the phrase. Export it again.' : why(answer) })
  }

  const update = (next: Partial<Extract<Sheet, { _tag: 'restore' }>>) =>
    setSheet((current) => (current?._tag === 'restore' ? { ...current, ...next } : current))

  const restore = async (current: Extract<Sheet, { _tag: 'restore' }>) => {
    if (current.folder === undefined || !current.attested) return
    update({ busy: true, error: undefined })
    // On a new Mac the phrase opens the old Mac's backup; on the Mac that made it, its own key does.
    if (current.phrase.trim() !== '') {
      const typed = await typeRecoveryPhrase(current.phrase)
      if (typed !== 'saved') {
        update({ busy: false, error: typed === 'invalid' ? chatCopy.pages.settings.restoreSheet.phraseInvalid : 'Juno could not reach the keychain. Try again.' })
        return
      }
    }
    const answer = await actions.ownership({ _tag: 'restore', backupPath: current.folder, oldDeviceOffOrErased: true })
    if (answer.outcome !== 'ok') {
      update({ busy: false, error: why(answer) })
      return
    }
    // The agent restarts to install the backup, then opens in recovery: Review is next.
    setSheet(undefined)
    openJunoPage('review')
  }

  const move = async () => {
    setSheet({ _tag: 'move', busy: true })
    const answer = await actions.ownership({ _tag: 'move' })
    // The move code shows in the This Mac row.
    setSheet(answer.outcome === 'ok' ? undefined : { _tag: 'move', busy: false, error: why(answer) })
  }

  const close = () => setSheet(undefined)
  const panel =
    sheet === undefined ? null : sheet._tag === 'phrase' ? (
      <RecoveryPhraseSheet
        phrase={sheet.phrase}
        copied={sheet.copied}
        onCopy={() => {
          copyText(sheet.phrase)
          setSheet({ ...sheet, copied: true })
        }}
        onDone={close}
      />
    ) : sheet._tag === 'restore' ? (
      <RestoreSheet
        {...(sheet.folder === undefined ? {} : { folder: sheet.folder })}
        phrase={sheet.phrase}
        attested={sheet.attested}
        busy={sheet.busy}
        {...(sheet.error === undefined ? {} : { error: sheet.error })}
        onChooseFolder={() =>
          void chooseFolder('restore').then((folder) => {
            if (folder !== undefined) update({ folder, error: undefined })
          })
        }
        onPhrase={(phrase) => update({ phrase })}
        onAttest={(attested) => update({ attested })}
        onRestore={() => void restore(sheet)}
        onCancel={close}
      />
    ) : (
      <MoveSheet busy={sheet.busy} {...(sheet.error === undefined ? {} : { error: sheet.error })} onMove={() => void move()} onCancel={close} />
    )

  return {
    props: {
      onBackupFolder: () => void chooseBackupFolder(),
      onExportPhrase: () => void exportPhrase(),
      onMove: () => setSheet({ _tag: 'move', busy: false }),
      onRestore: () => setSheet({ _tag: 'restore', phrase: '', attested: false, busy: false }),
      onStopJob: (jobId) => void actions.stopJob(jobId),
      ...(busy === undefined ? {} : { backupBusy: busy }),
      ...(error === undefined ? {} : { backupError: error }),
    },
    // Escape closes a sheet, except one waiting for the agent's answer.
    sheet: panel === null ? null : <SheetLayer onClose={() => (sheet?._tag !== 'phrase' && sheet?.busy === true ? undefined : close())}>{panel}</SheetLayer>,
  }
}
