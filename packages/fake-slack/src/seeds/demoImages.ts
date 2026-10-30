/**
 * Design mocks for the demo seed, drawn in code: a booking calendar with a
 * column per day and coloured appointments, as a designer would post a
 * screen in a review thread. No text; the shapes are invented.
 */
import { crc32, deflateSync } from 'node:zlib'

type Rgb = readonly [number, number, number]

/** An appointment: day column, start and length in hours from the first row, colour index. */
type Booking = readonly [day: number, start: number, hours: number, colour: number]

const COLOURS: ReadonlyArray<{ readonly fill: Rgb; readonly edge: Rgb }> = [
  { fill: [0xdc, 0xe8, 0xfd], edge: [0x3b, 0x74, 0xe0] },
  { fill: [0xd8, 0xf1, 0xe4], edge: [0x2e, 0x9a, 0x62] },
  { fill: [0xfc, 0xeb, 0xd2], edge: [0xd9, 0x8a, 0x1f] },
  { fill: [0xf6, 0xdd, 0xe8], edge: [0xc2, 0x4d, 0x82] },
]

const WEEK: ReadonlyArray<Booking> = [
  [0, 0.5, 1, 0], [0, 2, 1.5, 1], [0, 5, 1, 2], [1, 1, 2, 3], [1, 4, 1, 0], [1, 6.5, 1.5, 1],
  [2, 0, 1, 2], [2, 1.5, 1, 0], [2, 3, 2, 1], [3, 0.5, 1.5, 1], [3, 3.5, 1, 3], [3, 5.5, 2, 0],
  [4, 1, 1, 0], [4, 2.5, 1, 2], [4, 6, 1, 3], [5, 1.5, 2.5, 1], [6, 2, 1, 2],
]

const THREE_DAYS: ReadonlyArray<Booking> = [
  [0, 0.5, 1, 0], [0, 2, 1.5, 1], [0, 5, 1, 2], [1, 1, 2, 3], [1, 4, 1, 0], [1, 6.5, 1.5, 1], [2, 0, 1, 2], [2, 1.5, 1, 0], [2, 3, 2, 1],
]

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function draw(width: number, height: number, days: number, bookings: ReadonlyArray<Booking>): Buffer {
  const pixels = Buffer.alloc(width * height * 3)
  const fill = (x: number, y: number, w: number, h: number, [r, g, b]: Rgb, radius = 0) => {
    for (let py = Math.max(0, Math.round(y)); py < Math.min(height, Math.round(y + h)); py++) {
      for (let px = Math.max(0, Math.round(x)); px < Math.min(width, Math.round(x + w)); px++) {
        const dx = Math.max(x + radius - px, px - (x + w - radius), 0)
        const dy = Math.max(y + radius - py, py - (y + h - radius), 0)
        if (dx * dx + dy * dy > radius * radius) continue
        const offset = (py * width + px) * 3
        pixels[offset] = r
        pixels[offset + 1] = g
        pixels[offset + 2] = b
      }
    }
  }
  const scale = width / 1200
  const header = 96 * scale
  const gutter = 72 * scale
  const rows = 9
  const rowHeight = (height - header) / rows
  const column = (width - gutter) / days
  fill(0, 0, width, height, [0xff, 0xff, 0xff])
  fill(0, 0, width, header, [0xf6, 0xf6, 0xf4])
  // The month title and the day names, as grey bars where the text would be.
  fill(gutter, 24 * scale, 180 * scale, 18 * scale, [0x3a, 0x3a, 0x3c], 4 * scale)
  for (let d = 0; d < days; d++) fill(gutter + d * column + 14 * scale, 62 * scale, 44 * scale, 10 * scale, d === 2 ? [0x3b, 0x74, 0xe0] : [0xb4, 0xb4, 0xb8], 3 * scale)
  for (let r = 0; r <= rows; r++) {
    fill(gutter, header + r * rowHeight, width - gutter, Math.max(1, scale), [0xec, 0xec, 0xea])
    fill(18 * scale, header + r * rowHeight + 6 * scale, 32 * scale, 8 * scale, [0xd0, 0xd0, 0xd4], 2 * scale)
  }
  for (let d = 0; d <= days; d++) fill(gutter + d * column, header, Math.max(1, scale), height - header, [0xec, 0xec, 0xea])
  for (const [day, start, hours, colour] of bookings) {
    const { fill: inside, edge } = COLOURS[colour % COLOURS.length]!
    const x = gutter + day * column + 6 * scale
    const y = header + start * rowHeight + 4 * scale
    const w = column - 12 * scale
    const h = hours * rowHeight - 8 * scale
    fill(x, y, w, h, inside, 8 * scale)
    fill(x, y + 6 * scale, 4 * scale, h - 12 * scale, edge, 2 * scale)
    fill(x + 14 * scale, y + 12 * scale, w * 0.55, 9 * scale, edge, 3 * scale)
    if (h > 50 * scale) fill(x + 14 * scale, y + 30 * scale, w * 0.35, 7 * scale, [0x9a, 0x9a, 0xa0], 3 * scale)
  }
  // Now: a red line across the third day.
  fill(gutter + 2 * column, header + 3.3 * rowHeight, column, 2 * scale, [0xe0, 0x4b, 0x3c])
  fill(gutter + 2 * column - 5 * scale, header + 3.3 * rowHeight - 4 * scale, 10 * scale, 10 * scale, [0xe0, 0x4b, 0x3c], 5 * scale)

  const row = 1 + width * 3
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) pixels.copy(raw, y * row + 1, y * width * 3, (y + 1) * width * 3)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** The week view mock, 1200 x 800. */
export function weekViewPng(): Buffer {
  return draw(1200, 800, 7, WEEK)
}

/** The three-day view mock, 720 x 960. */
export function threeDayViewPng(): Buffer {
  return draw(720, 960, 3, THREE_DAYS)
}
