/**
 * What the owner reads when backup folder work fails (a folder change, a
 * move, a restore), and what the log keeps. The owner gets one plain line
 * with what to do; the log gets the error's name, code and message, which
 * hold paths but never a key, a phrase or message text.
 */
import { chatCopy } from '@juno/agent-contract'
import { ForeignBackup, OwnedElsewhere } from './backup'
import { KeychainUnavailable } from './bridge'

export interface BackupFailure {
  readonly reason: 'unavailable' | 'invalid' | 'readOnly'
  readonly message: string
}

const code = (error: unknown) => (error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined)

export function backupFailure(error: unknown): BackupFailure {
  if (error instanceof ForeignBackup) return { reason: 'invalid', message: 'That folder holds a Juno backup from another Mac. Restore from it, or choose another folder.' }
  if (error instanceof OwnedElsewhere) return { reason: 'readOnly', message: chatCopy.banner.otherDevice.line }
  if (error instanceof KeychainUnavailable) return { reason: 'unavailable', message: 'Juno could not reach the keychain. Try again.' }
  switch (code(error)) {
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
    case 'ENOTDIR':
      return { reason: 'invalid', message: "Juno can't write to that folder. Choose another one." }
    case 'ENOENT':
      return { reason: 'unavailable', message: 'That folder is not available. Check that its disk is connected.' }
    case 'ENOSPC':
    case 'EDQUOT':
      return { reason: 'unavailable', message: 'The disk with the backup folder is full.' }
    default:
      return { reason: 'unavailable', message: 'Juno could not use the backup folder. Check that it is available and try again.' }
  }
}

/** One line for the log: `EACCES Error: EACCES: permission denied, open '/Volumes/…'`. */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'a non-error value was thrown'
  const tag = code(error)
  return `${tag === undefined ? '' : `${tag} `}${error.name}: ${error.message}`
}
