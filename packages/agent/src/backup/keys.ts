/**
 * Backup cryptography (plan v3 §14.4).
 *
 * - The **backup key** lives in the keychain. It wraps each generation's
 *   data key and authenticates every manifest.
 * - A **data key** is fresh per generation. Segments are AES-256-GCM under
 *   it with a counter nonce persisted before use, so no nonce repeats
 *   under one key, also after a crash (spec `encryptionNonceFresh`). The
 *   associated data binds the generation, the position and the previous
 *   segment's hash, so segments cannot be reordered, dropped or moved
 *   between generations.
 * - The **recovery phrase** wraps the backup key (scrypt, then AES-GCM).
 *   Each manifest carries that wrapped copy, so the phrase alone opens the
 *   folder on another Mac.
 * - The **move code** is 8 characters of the final manifest's hash.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export const KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BYTES = 16

/** A file or manifest that does not decrypt or verify under the key Juno has. */
export class BackupUnreadable extends Error {
  constructor(what: string) {
    super(`${what} does not verify`)
    this.name = 'BackupUnreadable'
  }
}

export const newKey = () => randomBytes(KEY_BYTES)

/** The `n`th nonce under one data key. `n` is at least 1 and is never reused for that key. */
export function counterNonce(n: number): Buffer {
  const nonce = Buffer.alloc(NONCE_BYTES)
  nonce.writeUIntBE(n, NONCE_BYTES - 6, 6)
  return nonce
}

/** AES-256-GCM: nonce, then ciphertext, then tag. */
export function seal(key: Uint8Array, plaintext: Uint8Array, aad: string, nonce: Buffer = randomBytes(NONCE_BYTES)): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(aad))
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([nonce, body, cipher.getAuthTag()])
}

export function unseal(key: Uint8Array, sealed: Uint8Array, aad: string, what: string): Buffer {
  if (sealed.byteLength < NONCE_BYTES + TAG_BYTES) throw new BackupUnreadable(what)
  const bytes = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength)
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, NONCE_BYTES))
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(bytes.subarray(bytes.byteLength - TAG_BYTES))
  try {
    return Buffer.concat([decipher.update(bytes.subarray(NONCE_BYTES, bytes.byteLength - TAG_BYTES)), decipher.final()])
  } catch {
    throw new BackupUnreadable(what)
  }
}

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

export const wrapKey = (wrapping: Uint8Array, key: Uint8Array, label: string) => seal(wrapping, key, `juno-key:${label}`).toString('base64')

export const unwrapKey = (wrapping: Uint8Array, wrapped: string, label: string) => unseal(wrapping, Buffer.from(wrapped, 'base64'), `juno-key:${label}`, `the ${label} key`)

/** The manifest's authentication: HMAC-SHA256 under a key derived from the backup key. */
export function manifestMac(backupKey: Uint8Array, body: string): string {
  const macKey = Buffer.from(hkdfSync('sha256', backupKey, Buffer.alloc(0), 'juno-backup-manifest', KEY_BYTES))
  return createHmac('sha256', macKey).update(body).digest('hex')
}

export function macMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(actual, 'hex')
  return a.byteLength === b.byteLength && a.byteLength > 0 && timingSafeEqual(a, b)
}

// Crockford base32: no I, L, O or U, so a phrase read aloud or typed has no look-alikes.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function base32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

const groups = (text: string, size: number) => text.match(new RegExp(`.{1,${size}}`, 'g'))!.join('-')

/** A new recovery phrase: 160 random bits as 32 characters in groups of four. */
export const newPhrase = () => groups(base32(randomBytes(20)), 4)

/** The phrase as typed, with case, spaces and dashes ignored and look-alikes read as Crockford does. */
export const normalizePhrase = (text: string) =>
  text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')

export interface PhraseWrap {
  readonly salt: string
  readonly key: string
}

const phraseKey = (phrase: string, salt: Buffer) =>
  scryptSync(normalizePhrase(phrase), salt, KEY_BYTES, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })

export function wrapWithPhrase(phrase: string, backupKey: Uint8Array): PhraseWrap {
  const salt = randomBytes(16)
  return { salt: salt.toString('base64'), key: wrapKey(phraseKey(phrase, salt), backupKey, 'backup') }
}

export const unwrapWithPhrase = (phrase: string, wrap: PhraseWrap) => unwrapKey(phraseKey(phrase, Buffer.from(wrap.salt, 'base64')), wrap.key, 'backup')

/** "7KQ2-M9XA": the first 40 bits of a manifest's hash. */
export const moveCode = (manifestHash: string) => groups(base32(Buffer.from(manifestHash, 'hex').subarray(0, 5)), 4)
