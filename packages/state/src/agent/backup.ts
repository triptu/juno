/**
 * What Settings › Juno's Backup and This Mac rows ask main for (WP21): the
 * folder picker, the recovery phrase after an export, and a phrase the
 * owner typed for a restore. The phrase goes from main to the sheet that
 * shows it and nowhere else: no atom holds it.
 */
import type { JunoBridge } from '@juno/contract/channels'

const bridge = (): JunoBridge | undefined => (globalThis as { readonly juno?: JunoBridge }).juno

/** The chosen folder's absolute path, or undefined when the owner cancelled. */
export async function chooseFolder(purpose: 'backup' | 'restore'): Promise<string | undefined> {
  const path = await bridge()?.agent.chooseFolder(purpose).catch(() => undefined)
  return typeof path === 'string' && path !== '' ? path : undefined
}

/** The phrase the agent just exported. Main answers it once. */
export async function takeRecoveryPhrase(): Promise<string | undefined> {
  const phrase = await bridge()?.agent.recoveryPhrase().catch(() => undefined)
  return typeof phrase === 'string' && phrase !== '' ? phrase : undefined
}

/** Puts a typed phrase in the keychain before a restore. */
export async function typeRecoveryPhrase(phrase: string): Promise<'saved' | 'invalid' | 'failed'> {
  const result = await bridge()?.agent.typeRecoveryPhrase(phrase).catch(() => undefined)
  return result === 'saved' || result === 'invalid' ? result : 'failed'
}
