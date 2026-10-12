/**
 * Snappy decompression, the block compression leveldb uses by default.
 * Format: a varint uncompressed length, then tagged elements. The low two
 * bits of a tag say what it is: 0 a literal run, 1 a copy with a one-byte
 * offset, 2 a copy with a two-byte offset, 3 a copy with a four-byte offset.
 * Read-only use, so there is no compressor here.
 */

export function snappyUncompress(input: Uint8Array): Uint8Array {
  let pos = 0
  let length = 0
  let shift = 0
  while (true) {
    const byte = input[pos++]
    if (byte === undefined) throw new Error('snappy: truncated length')
    length |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  const out = new Uint8Array(length)
  let outPos = 0
  while (pos < input.length) {
    const tag = input[pos++]!
    const kind = tag & 3
    if (kind === 0) {
      let runLength = tag >> 2
      if (runLength >= 60) {
        const extra = runLength - 59
        runLength = 0
        for (let i = 0; i < extra; i++) runLength |= input[pos++]! << (8 * i)
      }
      runLength += 1
      out.set(input.subarray(pos, pos + runLength), outPos)
      pos += runLength
      outPos += runLength
      continue
    }
    let copyLength: number
    let offset: number
    if (kind === 1) {
      copyLength = ((tag >> 2) & 7) + 4
      offset = ((tag >> 5) << 8) | input[pos++]!
    } else if (kind === 2) {
      copyLength = (tag >> 2) + 1
      offset = input[pos]! | (input[pos + 1]! << 8)
      pos += 2
    } else {
      copyLength = (tag >> 2) + 1
      offset = (input[pos]! | (input[pos + 1]! << 8) | (input[pos + 2]! << 16) | (input[pos + 3]! << 24)) >>> 0
      pos += 4
    }
    if (offset === 0 || offset > outPos) throw new Error('snappy: bad copy offset')
    // Copies may overlap their own output (run-length style), so byte by byte.
    for (let i = 0; i < copyLength; i++) {
      out[outPos] = out[outPos - offset]!
      outPos++
    }
  }
  if (outPos !== length) throw new Error('snappy: length mismatch')
  return out
}
