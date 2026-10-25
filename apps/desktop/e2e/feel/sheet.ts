/**
 * Global setup and teardown for the feel suite. Setup empties
 * `feel-report/`; teardown writes `feel-report/index.html`, the contact
 * sheet: every scenario's checks, slow-motion video and filmstrip on one
 * page, failures first.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readResult, REPORT_DIR, SLOW_MOTION, type ScenarioResult } from './studio'

/** Playwright's global setup; the function it returns is the teardown. */
export default async function setup(): Promise<() => Promise<void>> {
  await rm(REPORT_DIR, { recursive: true, force: true })
  await mkdir(REPORT_DIR, { recursive: true })
  await writeFile(join(REPORT_DIR, 'started'), String(Date.now()))
  return teardown
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const rank = (result: ScenarioResult) => (result.status === 'fail' ? 0 : result.verdicts.some((v) => v.status === 'warn') ? 1 : result.status === 'pass' ? 2 : 3)

function frameLinks(name: string, shots: ReadonlyArray<number>): string {
  return shots.map((n) => `<a href="${name}/frames/${String(n).padStart(4, '0')}.jpg" data-seek="${name}:${n}">#${n}</a>`).join(' ')
}

function section(result: ScenarioResult): string {
  const name = escape(result.name)
  const checks = result.verdicts
    .map((v) => `<tr class="${v.status}"><td>${v.status}</td><td>${escape(v.name)}</td><td>${escape(v.detail)}</td><td>${frameLinks(name, v.shots)}</td></tr>`)
    .join('')
  const media =
    result.status === 'skipped'
      ? `<p class="reason">Skipped: ${escape(result.reason ?? '')}</p>`
      : `<div class="media">
          ${result.video === null ? '<p>No video.</p>' : `<div><video id="v-${name}" src="${name}/${result.video}" controls muted loop preload="metadata"></video><div class="counter" id="c-${name}">frame #1</div></div>`}
          ${result.filmstrip === null ? '' : `<a class="strip" href="${name}/${result.filmstrip}"><img src="${name}/${result.filmstrip}" loading="lazy" alt="Filmstrip of ${name}"></a>`}
        </div>`
  return `<section id="${name}" class="${result.status}">
    <h2><span class="badge ${result.status}">${result.status}</span> ${name}</h2>
    <p class="title">${escape(result.title)} <span class="meta">${escape(result.test)} · ${result.frames} frames, ${result.animationFrames} animation frames, ${(result.durationMs / 1000).toFixed(1)} s · load ${result.load}</span></p>
    ${result.notes.map((note) => `<p class="note">${escape(note)}</p>`).join('')}
    ${checks === '' ? '' : `<table><thead><tr><th></th><th>Check</th><th>Detail</th><th>Frames</th></tr></thead><tbody>${checks}</tbody></table>`}
    ${media}
  </section>`
}

async function teardown(): Promise<void> {
  const results: ScenarioResult[] = []
  for (const entry of await readdir(REPORT_DIR, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue
    const result = await readResult(join(REPORT_DIR, entry.name))
    if (result !== undefined) results.push(result)
  }
  if (results.length === 0) return
  results.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const started = Number(await readFile(join(REPORT_DIR, 'started'), 'utf8').catch(() => '0'))
  const minutes = started > 0 ? ((Date.now() - started) / 60_000).toFixed(1) : '?'
  let commit = ''
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    commit = 'unknown'
  }
  const count = (status: string) => results.filter((r) => r.status === status).length
  const timelines = Object.fromEntries(results.map((r) => [r.name, r.timeline]))
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Juno feel pass</title>
<style>
  body { font: 13px/1.45 -apple-system, system-ui, sans-serif; margin: 24px; color: #18181b; background: #fafafa; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  nav a { margin-right: 10px; }
  section { background: white; border: 1px solid #e4e4e7; border-radius: 8px; padding: 16px; margin: 16px 0; }
  section.fail { border-color: #fca5a5; }
  .badge { font-size: 11px; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; background: #e4e4e7; }
  .badge.fail { background: #fee2e2; color: #b91c1c; } .badge.pass { background: #dcfce7; color: #15803d; }
  .meta { color: #71717a; } .note, .reason { color: #a16207; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  td, th { text-align: left; padding: 3px 8px; border-top: 1px solid #f4f4f5; vertical-align: top; }
  tr.fail td:first-child { color: #b91c1c; font-weight: 600; } tr.warn td:first-child { color: #a16207; font-weight: 600; } tr.pass td:first-child { color: #15803d; }
  .media { display: flex; gap: 16px; align-items: flex-start; }
  video { width: 560px; border: 1px solid #e4e4e7; }
  .counter { font-variant-numeric: tabular-nums; color: #3f3f46; }
  .strip img { max-width: 640px; max-height: 420px; border: 1px solid #e4e4e7; }
</style></head><body>
<h1>Juno feel pass</h1>
<p>${new Date().toISOString().slice(0, 16).replace('T', ' ')} · commit ${escape(commit)} · ${minutes} min · ${count('fail')} failed, ${count('pass')} passed, ${count('skipped')} skipped. Videos play ${SLOW_MOTION}× slower; the counter under each names the filmstrip frame on screen.</p>
<nav>${results.map((r) => `<a href="#${escape(r.name)}">${r.status === 'fail' ? '✗' : r.status === 'pass' ? '✓' : '–'} ${escape(r.name)}</a>`).join('')}</nav>
${results.map(section).join('\n')}
<script>
  const timelines = ${JSON.stringify(timelines)};
  const frameAt = (name, seconds) => {
    const ms = (seconds * 1000) / ${SLOW_MOTION};
    const line = timelines[name] || [];
    let n = 1;
    for (let i = 0; i < line.length; i++) if (line[i] <= ms) n = i + 1;
    return n;
  };
  for (const video of document.querySelectorAll('video')) {
    const name = video.id.slice(2);
    const counter = document.getElementById('c-' + name);
    const update = () => { counter.textContent = 'frame #' + frameAt(name, video.currentTime); };
    video.addEventListener('timeupdate', update);
    video.addEventListener('seeked', update);
  }
  // A frame link seeks the video to that frame; the link itself still opens the image with a modifier key.
  for (const link of document.querySelectorAll('a[data-seek]')) {
    link.addEventListener('click', (event) => {
      const [name, n] = link.dataset.seek.split(':');
      const video = document.getElementById('v-' + name);
      if (!video || event.metaKey) return;
      event.preventDefault();
      video.pause();
      video.currentTime = ((timelines[name][Number(n) - 1] || 0) * ${SLOW_MOTION}) / 1000 + 0.001;
    });
  }
</script>
</body></html>
`
  await writeFile(join(REPORT_DIR, 'index.html'), html)
  console.log(`Feel contact sheet: ${join(REPORT_DIR, 'index.html')}`)
}
