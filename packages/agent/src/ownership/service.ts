/**
 * Ownership across Macs (plan v3 §14, SPEC 13.8): one Mac authorizes at a
 * time; a move hands over cooperatively; a restore opens in recovery until
 * the owner reviews what was pending and activates Juno.
 *
 * **Move, on the old Mac** (§14.2, spec `cooperativeTransferStep`):
 * 1. stop admitting new runs and let the live run, dispatch and projection
 *    finish (`drain`);
 * 2. commit `released`: the Mac admits and authorizes nothing from here,
 *    also after a crash;
 * 3. write the final checkpoint, a new backup generation, so it holds
 *    everything up to the release;
 * 4. publish its manifest as `released` and show the move code.
 * A crash between 2 and 4 reopens released, and `resume` writes the
 * checkpoint again (spec `releaseCrash`, `checkpointReopen`).
 *
 * **Restore, on the new Mac** (§14.3): the owner attests that the old Mac is
 * off, erased or has Juno removed (Juno cannot check this). The backup is
 * staged and the agent restarts; the next open installs it in recovery.
 * Nothing runs and nothing is authorized; sends wait. The Review page lists
 * every open card with "This may already have happened."; a click there
 * waits too. Activate expires the cards still open, takes the next epoch
 * and kicks the dispatcher, so the reviewed clicks run once.
 *
 * **A stale owner** (G7): v1 has no fence. An old Mac still running stops
 * when its backup finds a newer owner's manifest in a shared folder; the
 * spec keeps `staleOwnerCannotAuthorize` as a counterexample for the time
 * before that.
 */
import type { CardBinding, Card, ReviewPage } from '@juno/agent-contract'
import type { CardView } from '../actions/cards'
import type { Backup, BackupKeychain } from '../backup/backup'
import { stageRestore } from '../backup/restore'
import { crashPoint } from '../runtime/crash'
import type { Store } from '../store/store'
import { activateOwner, ownerOf, recordMoveCode, releaseOwner, type Owner } from './ownership'

export interface OwnershipOptions {
  readonly store: Store
  readonly agentDir: string
  /** Without a backup there is no move and no restore. */
  readonly backup?: { readonly backup: Backup; readonly keychain: BackupKeychain }
  /** Lets the live run, dispatch and projection finish. Admission is already off. */
  readonly drain: () => Promise<void>
  /** This Mac became the owner: waiting clicks and inputs run now (WP15's `actions.kick`). */
  readonly kick: () => void
  /** The cards as the chat shows them. */
  readonly cards: () => ReadonlyArray<CardView>
  /** Restarts the agent, so the next open installs a staged restore. */
  readonly restart?: () => void
  readonly onReport?: (error: unknown) => void
}

type Refused<R extends string> = { readonly _tag: 'refused'; readonly reason: R; readonly message: string }

export type MoveResult = { readonly _tag: 'moved'; readonly code: string } | Refused<'unavailable' | 'readOnly'>
export type RestoreResult = { readonly _tag: 'staged'; readonly backupAt: number; readonly moveCode?: string } | Refused<'unavailable' | 'invalid' | 'stale'>
export type ActivateResult = { readonly _tag: 'activated' } | Refused<'readOnly' | 'stale'>

export interface Ownership {
  readonly owner: () => Owner
  /** Whether a new run may start: this Mac owns Juno and no move is draining. */
  readonly admits: () => boolean
  /** In recovery, an open card from the backup says it may already have happened. */
  readonly restored: (view: CardView) => CardView
  /** Open cards waiting for review. */
  readonly pending: () => number
  readonly review: () => { readonly page: ReviewPage; readonly cards: ReadonlyArray<typeof CardBinding.Type> }
  readonly move: () => Promise<MoveResult>
  readonly restore: (folder: string) => Promise<RestoreResult>
  readonly activate: (input: { readonly backupAt: number }) => ActivateResult
  /** Finishes a move a crash interrupted after the release. */
  readonly resume: () => Promise<void>
  readonly subscribe: (listener: () => void) => () => void
  /** Tells subscribers something they show changed (the backup's last time, a newer owner). */
  readonly notify: () => void
}

const refused = <R extends string>(reason: R, message: string): Refused<R> => ({ _tag: 'refused', reason, message })

const isOpen = (card: Card) => 'status' in card && card.status._tag === 'open'

/** Released by a move whose final backup is not published yet. */
const unpublished = (owner: Owner) => owner.state === 'released' && owner.moveCode === undefined && owner.deviceName === undefined

export function createOwnership(options: OwnershipOptions): Ownership {
  const { store } = options
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  let moving = false

  const recovering = () => ownerOf(store).state === 'recovery'
  const restored = (view: CardView): CardView =>
    recovering() && isOpen(view.card) ? { ...view, card: { ...view.card, status: { _tag: 'open', mayHaveHappened: true } } as Card } : view
  const pendingViews = () => (recovering() ? options.cards().filter((view) => isOpen(view.card)).map(restored) : [])

  const publishFinal = async (backup: Backup) => {
    const code = await backup.finalCheckpoint()
    recordMoveCode(store, code)
    changed()
    return code
  }

  return {
    owner: () => ownerOf(store),
    admits: () => !moving && ownerOf(store).state === 'active',
    restored,
    pending: () => pendingViews().length,
    review: () => {
      const owner = ownerOf(store)
      const views = pendingViews()
      return {
        page: {
          pending: views.map((view) => view.card),
          ...(owner.state === 'recovery' && owner.backupAt !== undefined ? { backupAt: owner.backupAt } : {}),
          ...(owner.state === 'recovery' && owner.moveCode !== undefined ? { moveCode: owner.moveCode } : {}),
          ...(owner.state === 'recovery' && !owner.trusted ? { unchecked: true as const } : {}),
        },
        cards: views.flatMap((view) => (view.binding === undefined ? [] : [view.binding])),
      }
    },
    move: async () => {
      if (options.backup === undefined) return refused('unavailable', 'Moving needs a backup folder.')
      // Move again after the final backup failed: the release stands, so only the publication is left.
      if (unpublished(ownerOf(store))) return { _tag: 'moved', code: await publishFinal(options.backup.backup) }
      if (moving || ownerOf(store).state !== 'active') return refused('readOnly', 'This Mac does not own Juno.')
      moving = true
      changed()
      try {
        await options.drain()
        releaseOwner(store)
        crashPoint('ownership.released')
        changed()
      } catch (error) {
        moving = false
        changed()
        options.kick()
        throw error
      }
      moving = false
      return { _tag: 'moved', code: await publishFinal(options.backup.backup) }
    },
    restore: async (folder) => {
      if (options.backup === undefined) return refused('unavailable', 'Restoring needs the keychain.')
      const staged = await stageRestore({ agentDir: options.agentDir, folder, keychain: options.backup.keychain, device: ownerOf(store).device })
      switch (staged._tag) {
        case 'staged':
          options.restart?.()
          return { _tag: 'staged', backupAt: staged.restore.backupAt, ...(staged.restore.moveCode ? { moveCode: staged.restore.moveCode } : {}) }
        case 'waiting':
          return refused('stale', 'The backup folder is still syncing. Try again in a moment.')
        case 'refused':
          return staged.reason === 'noBackup'
            ? refused('invalid', 'There is no Juno backup in that folder.')
            : staged.reason === 'noKey'
              ? refused('invalid', 'Juno cannot open this backup. Enter the recovery phrase from your other Mac.')
              : refused('stale', 'This backup is older than a removal. Juno waits for a newer backup.')
      }
    },
    activate: ({ backupAt }) => {
      const owner = ownerOf(store)
      if (owner.state !== 'recovery') return refused('readOnly', 'Juno is not in recovery.')
      // The owner saw the Review page of this restore, with its "can't check" line when it applies.
      if (owner.backupAt !== backupAt) return refused('stale', 'This review is for another restore.')
      activateOwner(store)
      options.kick()
      changed()
      void options.backup?.backup.flush().catch(options.onReport)
      return { _tag: 'activated' }
    },
    resume: async () => {
      if (options.backup === undefined || !unpublished(ownerOf(store))) return
      await publishFinal(options.backup.backup)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify: changed,
  }
}
