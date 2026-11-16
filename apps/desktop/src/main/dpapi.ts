/**
 * Windows' DPAPI, for the Slack app import (architecture 14): Slack, like
 * every Chromium app on Windows, keeps its cookie key in `Local State`
 * protected with `CryptProtectData` for the Windows user. `CryptUnprotectData`
 * gives it back to any process of that user, with no prompt. Called through
 * koffi (ADR 0015), so no PowerShell starts and the key never leaves this
 * process.
 */

/** The protected bytes back in the clear, or undefined when Windows refuses (another user's blob, or not a blob). */
export type Unprotect = (blob: Buffer) => Buffer | undefined

const CRYPTPROTECT_UI_FORBIDDEN = 0x1

/** Loads `crypt32!CryptUnprotectData`. Undefined off Windows or when koffi does not load. */
export async function loadUnprotect(): Promise<Unprotect | undefined> {
  if (process.platform !== 'win32') return undefined
  let koffi: typeof import('koffi')
  try {
    koffi = await import('koffi')
  } catch (cause) {
    console.warn('main: DPAPI off, koffi did not load', cause)
    return undefined
  }
  const blob = koffi.struct('DATA_BLOB', { cbData: 'uint32_t', pbData: 'uint8_t *' })
  const crypt32 = koffi.load('crypt32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  const unprotect = crypt32.func('__stdcall', 'CryptUnprotectData', 'bool', [
    koffi.pointer(blob),
    'void *',
    'void *',
    'void *',
    'void *',
    'uint32_t',
    koffi.out(koffi.pointer(blob)),
  ])
  const localFree = kernel32.func('__stdcall', 'LocalFree', 'void *', ['void *'])
  return (data) => {
    const output: { cbData?: number; pbData?: unknown } = {}
    if (!unprotect({ cbData: data.length, pbData: data }, null, null, null, null, CRYPTPROTECT_UI_FORBIDDEN, output)) return undefined
    if (output.pbData === undefined || output.pbData === null) return undefined
    try {
      return Buffer.from(koffi.view(output.pbData, output.cbData ?? 0).slice(0))
    } finally {
      localFree(output.pbData)
    }
  }
}
