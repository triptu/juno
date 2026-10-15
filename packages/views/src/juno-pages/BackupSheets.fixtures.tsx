import { defineFixtures, fixture } from '@juno/ui'
import { MoveSheet, RecoveryPhraseSheet, RestoreSheet, type MoveSheetProps, type RecoveryPhraseSheetProps, type RestoreSheetProps } from './BackupSheets'

const noop = () => {}
// Made up for the gallery: the shape of a phrase, not one any backup uses.
const PHRASE = '7KQ2-M9XA-C4HD-PW3T-0BRN-6YFE-J8VS-Q1ZG'
const frame = { width: 640, padded: true, surface: 'subtle' } as const

export const phraseSheet = defineFixtures(
  RecoveryPhraseSheet,
  {
    'Recovery phrase': {
      shown: fixture<RecoveryPhraseSheetProps>({ phrase: PHRASE, copied: false, onCopy: noop, onDone: noop }),
      copied: fixture<RecoveryPhraseSheetProps>({ phrase: PHRASE, copied: true, onCopy: noop, onDone: noop }),
    },
  },
  frame,
)

const restore: RestoreSheetProps = { phrase: '', attested: false, busy: false, onChooseFolder: noop, onPhrase: noop, onAttest: noop, onRestore: noop, onCancel: noop }

export const restoreSheet = defineFixtures(
  RestoreSheet,
  {
    Restore: {
      empty: fixture<RestoreSheetProps>(restore),
      // A new Mac: the folder the old Mac backed up to, and the phrase from it.
      ready: fixture<RestoreSheetProps>({ ...restore, folder: '/Users/maya/Library/CloudStorage/Dropbox/Juno backup', phrase: PHRASE, attested: true }),
      'no-key': fixture<RestoreSheetProps>({
        ...restore,
        folder: '/Users/maya/Library/CloudStorage/Dropbox/Juno backup',
        attested: true,
        error: 'Juno cannot open this backup. Enter the recovery phrase from your other Mac.',
      }),
    },
  },
  frame,
)

export const moveSheet = defineFixtures(
  MoveSheet,
  {
    Move: {
      ask: fixture<MoveSheetProps>({ busy: false, onMove: noop, onCancel: noop }),
      refused: fixture<MoveSheetProps>({ busy: false, error: 'That folder is not available. Check that its disk is connected.', onMove: noop, onCancel: noop }),
    },
  },
  frame,
)
