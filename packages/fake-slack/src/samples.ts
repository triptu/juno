/**
 * Small, valid files made in code for the seed: a PNG and a one-page PDF.
 * The content is invented.
 */
import { crc32, deflateSync } from 'node:zlib'

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** An RGB PNG of a simple bar chart on a light background. */
export function samplePng(width: number, height: number): Buffer {
  const bars = [0.55, 0.8, 0.4, 0.95, 0.7]
  const slot = width / bars.length
  const row = 1 + width * 3
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0
    for (let x = 0; x < width; x++) {
      const bar = Math.floor(x / slot)
      const inBar = x - bar * slot > slot * 0.2 && x - bar * slot < slot * 0.8 && height - y < height * (bars[bar] ?? 0) * 0.85
      const offset = y * row + 1 + x * 3
      raw[offset] = inBar ? 0x3b : 0xf1
      raw[offset + 1] = inBar ? 0x82 : 0xf3
      raw[offset + 2] = inBar ? 0xf6 : 0xf5
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function escapePdf(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`)
}

/** A one-page PDF with a title and a few lines of text, cross-reference table included. */
export function samplePdf(title: string, lines: ReadonlyArray<string>): Buffer {
  const text = [`BT /F1 20 Tf 72 720 Td (${escapePdf(title)}) Tj ET`, ...lines.map((line, i) => `BT /F1 12 Tf 72 ${684 - i * 18} Td (${escapePdf(line)}) Tj ET`)].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
