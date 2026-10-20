/**
 * Files the media viewer opens, made in code (`injectFiles`): a long PDF, an
 * HTML email export, a Markdown snippet, a wide CSV, a JSON file, a log, an
 * audio clip, a voice clip and a zip. The content is invented.
 */
import { crc32 } from 'node:zlib'
import type { File } from '@juno/slack-schema'
import { samplePdfPages } from './samples.ts'

/** What `injectFiles` can post. */
export type SampleKind = 'pdf' | 'html' | 'markdown' | 'csv' | 'json' | 'log' | 'audio' | 'voice' | 'zip'

export interface Sample {
  readonly name: string
  readonly mimetype: string
  readonly bytes: Buffer
  /** Fields Slack sends for this kind of file on top of the common ones. */
  readonly extra?: Partial<File>
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** One file of `kind`. `seconds` sets the length of an audio or voice clip. */
export function sample(kind: SampleKind, input: { readonly name?: string; readonly seconds?: number } = {}): Sample {
  switch (kind) {
    case 'pdf':
      return {
        name: input.name ?? 'capacity-review.pdf',
        mimetype: 'application/pdf',
        bytes: samplePdfPages(
          MONTHS.map((month, page) => ({
            title: `Capacity review: ${month}`,
            lines: Array.from({ length: 30 }, (_, line) => `${page + 1}.${line + 1}  Cluster ${String.fromCharCode(65 + (line % 6))} ran at ${40 + ((page * 7 + line * 3) % 50)}% of its planned load.`),
          })),
        ),
      }
    case 'html':
      return { name: input.name ?? 'weekly-digest.html', mimetype: 'text/html', bytes: Buffer.from(HTML_EMAIL) }
    case 'markdown': {
      const text = MARKDOWN
      return {
        name: input.name ?? 'release-notes.md',
        mimetype: 'text/plain',
        bytes: Buffer.from(text),
        extra: { mode: 'snippet', filetype: 'markdown', pretty_type: 'Markdown (raw)', preview: text.split('\n').slice(0, 5).join('\n'), preview_is_truncated: true, lines: text.split('\n').length, lines_more: text.split('\n').length - 5 },
      }
    }
    case 'csv':
      return { name: input.name ?? 'cluster-metrics.csv', mimetype: 'text/csv', bytes: Buffer.from(csv(40, 80)) }
    case 'json':
      return { name: input.name ?? 'deploy-config.json', mimetype: 'application/json', bytes: Buffer.from(JSON.stringify(DEPLOY_CONFIG)) }
    case 'log':
      return { name: input.name ?? 'deploy.log', mimetype: 'text/plain', bytes: Buffer.from(log(2000)) }
    case 'audio': {
      const seconds = input.seconds ?? 300
      return { name: input.name ?? 'standup-recording.wav', mimetype: 'audio/wav', bytes: wav(seconds), extra: { duration_ms: seconds * 1000 } }
    }
    case 'voice': {
      const seconds = input.seconds ?? 14
      return { name: input.name ?? 'audio_message.wav', mimetype: 'audio/wav', bytes: wav(seconds), extra: { subtype: 'slack_audio', duration_ms: seconds * 1000 } }
    }
    case 'zip':
      return { name: input.name ?? 'build-logs.zip', mimetype: 'application/zip', bytes: zip([{ name: 'build.log', text: log(40) }, { name: 'README.txt', text: 'Logs from the nightly build.\n' }]) }
  }
}

/** A newsletter as an email client exports it: a styled table layout, a tracking pixel and a script, neither of which may run in the viewer. */
const HTML_EMAIL = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Weekly digest</title>
<style>
  body { margin: 0; background: #f4f4f0; font-family: Georgia, serif; color: #222; }
  .wrap { max-width: 600px; margin: 0 auto; background: #ffffff; }
  .hero { background: #1f3a5f; color: #fff; padding: 32px 28px; }
  .hero h1 { margin: 0; font-size: 28px; }
  .item { padding: 18px 28px; border-bottom: 1px solid #e5e5e0; }
  .item h2 { margin: 0 0 6px; font-size: 18px; color: #1f3a5f; }
  .foot { padding: 18px 28px; font-size: 12px; color: #777; }
</style>
<script>document.documentElement.setAttribute('data-script-ran', 'yes'); fetch('https://example.com/opened')</script>
</head>
<body>
<div class="wrap">
  <div class="hero"><h1>Weekly digest</h1><p>Platform team, week 42</p></div>
  <div class="item"><h2>Queue latency is back under 200 ms</h2><p>The new worker pool went live on Tuesday. Peak latency fell from 640 ms to 180 ms.</p></div>
  <div class="item"><h2>Staging moves to the new cluster</h2><p>Expect a short freeze on Thursday morning while the databases copy over.</p></div>
  <div class="item"><h2>On call</h2><p>Next week: Maya, then Leo. Swap requests go in the rota channel.</p></div>
  <div class="foot">You get this because you are on the platform list. <a href="https://example.com/unsubscribe">Unsubscribe</a></div>
</div>
<img src="https://example.com/pixel.gif" width="1" height="1" alt="">
</body>
</html>
`

const MARKDOWN = `# Release 4.2

Ships on **Monday**. The full plan is in [the tracker](https://example.com/tracker).

## What changes

- Search reads the local index first
- Threads keep their scroll position
- [x] Offline drafts survive a restart
- [ ] Bulk export (moved to 4.3)

## How to roll back

\`\`\`sh
deploy rollback --to 4.1.3
\`\`\`

> Tell the support channel before you roll back.

---

Questions go to the release thread.
`

function csv(columns: number, rows: number): string {
  const header = Array.from({ length: columns }, (_, c) => (c === 0 ? 'host' : c === 1 ? 'region' : `metric_${String(c - 1).padStart(2, '0')}`))
  const lines = [header.join(',')]
  for (let r = 0; r < rows; r++) {
    lines.push(Array.from({ length: columns }, (_, c) => (c === 0 ? `node-${String(r + 1).padStart(3, '0')}` : c === 1 ? (r % 3 === 0 ? '"eu-west, 1"' : 'us-east-2') : String(((r + 1) * (c + 3) * 37) % 1000))).join(','))
  }
  return `${lines.join('\n')}\n`
}

function log(lines: number): string {
  const levels = ['INFO', 'INFO', 'INFO', 'DEBUG', 'WARN', 'INFO', 'ERROR']
  const steps = ['pulling image registry.example.com/api:4.2.0', 'starting container api-7f9c', 'health check passed on /healthz', 'connection pool resized to 32', 'slow query took 1840 ms: SELECT * FROM orders WHERE created_at > $1', 'drained 14 in-flight requests', 'retrying upstream call to billing (attempt 2 of 3)']
  const out: Array<string> = []
  for (let n = 0; n < lines; n++) {
    const seconds = n * 3
    const time = `2026-10-20T09:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${String((n * 137) % 1000).padStart(3, '0')}Z`
    out.push(`${time} ${levels[n % levels.length]!.padEnd(5)} deploy[${4100 + (n % 9)}] ${steps[n % steps.length]}`)
  }
  return `${out.join('\n')}\n`
}

const DEPLOY_CONFIG = {
  service: 'api',
  version: '4.2.0',
  regions: [
    { name: 'us-east-2', replicas: 6, canary: false },
    { name: 'eu-west-1', replicas: 4, canary: true },
  ],
  limits: { cpu: '2', memory: '4Gi', requestsPerSecond: 1200 },
  alerts: { latencyMs: 250, errorRate: 0.01, pageOnCall: true },
}

/** A mono 8 kHz WAV of a soft tone that rises and falls, `seconds` long. */
function wav(seconds: number): Buffer {
  const rate = 8000
  const samples = rate * seconds
  const out = Buffer.alloc(44 + samples)
  out.write('RIFF', 0, 'latin1')
  out.writeUInt32LE(36 + samples, 4)
  out.write('WAVEfmt ', 8, 'latin1')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(rate, 24)
  out.writeUInt32LE(rate, 28)
  out.writeUInt16LE(1, 32)
  out.writeUInt16LE(8, 34)
  out.write('data', 36, 'latin1')
  out.writeUInt32LE(samples, 40)
  for (let n = 0; n < samples; n++) {
    const t = n / rate
    const loudness = 0.25 * (0.5 + 0.5 * Math.sin(t * 1.3))
    out[44 + n] = Math.round(128 + 127 * loudness * Math.sin(2 * Math.PI * (220 + 60 * Math.sin(t / 4)) * t))
  }
  return out
}

/** A zip of stored (uncompressed) text files. */
function zip(files: ReadonlyArray<{ readonly name: string; readonly text: string }>): Buffer {
  const locals: Array<Buffer> = []
  const centrals: Array<Buffer> = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const data = Buffer.from(file.text)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, data)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
