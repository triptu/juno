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

let loaded: Promise<Unprotect | undefined> | undefined

/**
 * `crypt32!CryptUnprotectData`, loaded once: koffi refuses to declare the
 * `DATA_BLOB` struct a second time, so a retried import must reuse it.
 * Undefined off Windows or when koffi or crypt32 does not load.
 */
export function loadUnprotect(): Promise<Unprotect | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined)
  loaded ??= bind().catch((cause: unknown) => {
    console.warn('main: DPAPI off, koffi or crypt32 did not load', cause)
    return undefined
  })
  return loaded
}

async function bind(): Promise<Unprotect> {
  const koffi = await import('koffi')
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
