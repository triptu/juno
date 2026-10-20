#!/usr/bin/env node
// Makes the two image files of every picture in the catalog (SPEC 12, "A picture";
// scripts/pictures/README.md), ready for upload.ts:
//
//   <out>/<id>-small.webp  fitted in Home's box at 2x (640 by 432), aiming under 60 KB
//   <out>/<id>-large.webp  2400 px on the long edge (never larger than the original), aiming under 900 KB
//
// Originals come from each picture's open-licence file in sources.json and are kept in
// <out>/originals, so a second run downloads nothing. Needs cwebp (`brew install webp`)
// and macOS `sips`. Prints each picture's width over height and fails when the catalog's
// `ratio` differs from the file's by more than 0.01.
//
//   pnpm pictures:build [--out /Volumes/AgentWork/pictures] [--only id1,id2]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PICTURES } from '../../packages/pictures/src/catalog.ts'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).flatMap((arg, at, all) => (arg.startsWith('--') ? [[arg.slice(2), all[at + 1]]] : [])))
const out = args.out ?? (existsSync('/Volumes/AgentWork') ? '/Volumes/AgentWork/pictures' : join(here, '.out'))
const only = args.only === undefined ? undefined : new Set(args.only.split(','))
const sources = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'))
const USER_AGENT = 'JunoPictures/1.0 (https://github.com/triptu; picture build)'

const SMALL = { width: 640, height: 432, quality: 78, budget: 60 * 1024 }
const LARGE = { edge: 2400, quality: 80, budget: 900 * 1024 }

mkdirSync(join(out, 'originals'), { recursive: true })

const size = (file) => {
  const text = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' })
  return { width: Number(/pixelWidth: (\d+)/.exec(text)[1]), height: Number(/pixelHeight: (\d+)/.exec(text)[1]) }
}

async function original(id) {
  const url = sources[id]
  if (url === undefined) throw new Error(`${id}: no entry in sources.json`)
  const file = join(out, 'originals', id)
  if (existsSync(file) && statSync(file).size > 0) return file
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } })
  if (!response.ok) throw new Error(`${id}: ${response.status} from ${url}`)
  writeFileSync(file, new Uint8Array(await response.arrayBuffer()))
  return file
}

/** cwebp reads JPEG, PNG and TIFF; anything else goes through sips to PNG first. */
function readable(file) {
  const type = execFileSync('file', ['-b', '--mime-type', file], { encoding: 'utf8' }).trim()
  if (['image/jpeg', 'image/png', 'image/tiff'].includes(type)) return file
  const png = `${file}.png`
  if (!existsSync(png)) execFileSync('sips', ['-s', 'format', 'png', file, '--out', png], { stdio: 'ignore' })
  return png
}

function webp(input, output, width, height, quality) {
  execFileSync('cwebp', ['-quiet', '-mt', '-metadata', 'none', '-q', String(quality), '-resize', String(width), String(height), input, '-o', output])
  return statSync(output).size
}

const report = []
let failed = false
for (const picture of PICTURES) {
  if (only !== undefined && !only.has(picture.id)) continue
  try {
    const input = readable(await original(picture.id))
    const { width, height } = size(input)
    const ratio = width / height
    if (Math.abs(ratio - picture.ratio) > 0.01) {
      failed = true
      console.error(`${picture.id}: the file is ${ratio.toFixed(4)} wide per high, the catalog says ${picture.ratio}`)
    }
    // Small: fitted in the box at 2x, a step lower in quality until it is in budget.
    const [sw, sh] = ratio >= SMALL.width / SMALL.height ? [SMALL.width, 0] : [0, SMALL.height]
    let quality = SMALL.quality
    let small = webp(input, join(out, `${picture.id}-small.webp`), sw, sh, quality)
    while (small > SMALL.budget && quality > 50) small = webp(input, join(out, `${picture.id}-small.webp`), sw, sh, (quality -= 6))
    // Large: the long edge at most 2400 and never upscaled.
    const scale = Math.min(1, LARGE.edge / Math.max(width, height))
    const [lw, lh] = [Math.round(width * scale), Math.round(height * scale)]
    let largeQuality = LARGE.quality
    let large = webp(input, join(out, `${picture.id}-large.webp`), lw, lh, largeQuality)
    while (large > LARGE.budget && largeQuality > 56) large = webp(input, join(out, `${picture.id}-large.webp`), lw, lh, (largeQuality -= 8))
    report.push({ id: picture.id, ratio: Number(ratio.toFixed(4)), small: Math.round(small / 1024), large: Math.round(large / 1024), original: `${width}x${height}` })
  } catch (error) {
    failed = true
    console.error(String(error))
  }
}
console.table(report)
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`${report.length} pictures in ${out}`)
if (failed) process.exit(1)
