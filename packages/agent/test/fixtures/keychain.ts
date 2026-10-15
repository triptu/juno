// Main's keychain for the backup tests: in memory, or in a JSON file a restarted process reads again.
import { readFileSync, writeFileSync } from 'node:fs'
import type { BackupKeychain, BackupSecret } from '../../src/index'

export interface FakeKeychain extends BackupKeychain {
  readonly values: () => Partial<Record<BackupSecret, string>>
}

export function fakeKeychain(initial: Partial<Record<BackupSecret, string>> = {}, file?: string): FakeKeychain {
  let memory = { ...initial }
  const read = (): Partial<Record<BackupSecret, string>> => {
    if (file === undefined) return memory
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Partial<Record<BackupSecret, string>>
    } catch {
      return {}
    }
  }
  const write = (next: Partial<Record<BackupSecret, string>>) => {
    memory = next
    if (file !== undefined) writeFileSync(file, JSON.stringify(next))
  }
  if (file !== undefined && Object.keys(initial).length > 0) write({ ...read(), ...initial })
  return {
    get: async (name) => read()[name],
    set: async (name, value) => write({ ...read(), [name]: value }),
    values: read,
  }
}
