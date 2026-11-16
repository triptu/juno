/**
 * Windows only: Chromium keeps the cookie key in `Local State` (JSON, at the
 * top of the user data directory) as `os_crypt.encrypted_key`, base64 of
 * `DPAPI` + the key protected with DPAPI for the Windows user. The caller
 * unprotects it (`CryptUnprotectData`); this module only reads the file.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const LOCAL_STATE_FILE = 'Local State'
const DPAPI_PREFIX = 'DPAPI'

/** The DPAPI blob for the cookie key, or undefined when the file or the key is missing or not DPAPI. */
export async function readProtectedCookieKey(dir: string): Promise<Buffer | undefined> {
  let state: unknown
  try {
    state = JSON.parse(await readFile(join(dir, LOCAL_STATE_FILE), 'utf8'))
  } catch {
    return undefined
  }
  const encoded = (state as { os_crypt?: { encrypted_key?: unknown } } | null)?.os_crypt?.encrypted_key
  if (typeof encoded !== 'string') return undefined
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.subarray(0, DPAPI_PREFIX.length).toString('latin1') !== DPAPI_PREFIX) return undefined
  return bytes.subarray(DPAPI_PREFIX.length)
}
