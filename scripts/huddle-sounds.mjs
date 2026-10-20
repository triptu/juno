#!/usr/bin/env node
/**
 * Writes the huddle's sounds (SPEC 20, "Sounds") as small WAV files: soft
 * sine notes with a quiet octave above, a short fade in and an exponential
 * fade out. They are Juno's own, made here from plain tones, so nothing is
 * copied from Slack. Run it again only to change them:
 *
 *   node scripts/huddle-sounds.mjs
 *
 * - The join and leave sounds: two notes, rising for a join, falling for a leave.
 * - The incoming huddle's ring: the same tone, lower, slower and softer, so
 *   it invites rather than alarms. The app's file is one ring followed by
 *   silence, so playing it on a loop gives the ring's pace. Three candidates
 *   are written for `docs/design/huddle-ring/index.html`; `RING` names the
 *   one the app uses.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 24_000
/** The loudest a sample gets, of full scale. The page plays them quieter still. */
const PEAK = 0.3

const C4 = 261.63
const E4 = 329.63
const G4 = 392.0
const A4 = 440.0
const C5 = 523.25
const E5 = 659.25
const G5 = 783.99
const C6 = 1046.5

/**
 * One note added into `samples`: a sine with a quiet octave above it, a
 * fade in over `attack` seconds and an exponential fade out at `decay` per
 * second, for `length` seconds, at `gain` of the peak.
 */
function note(samples, frequency, at, { length = 0.16, attack = 0.008, decay = 22, gain = 1, smooth = false } = {}) {
  const start = Math.round(at * RATE)
  const count = Math.round(length * RATE)
  for (let i = 0; i < count && start + i < samples.length; i++) {
    const t = i / RATE
    const fadeIn = Math.min(1, t / attack)
    const fadeOut = Math.exp(-t * decay)
    // A long note's last 10 ms fade to zero, so it never ends on a click.
    const tail = smooth ? Math.min(1, (count - i) / (0.01 * RATE)) : 1
    const tone = Math.sin(2 * Math.PI * frequency * t) + 0.15 * Math.sin(4 * Math.PI * frequency * t)
    samples[start + i] += (tone / 1.15) * fadeIn * fadeOut * tail * gain * PEAK
  }
}

/** Notes `step` seconds apart, each with `shape`; the sound lasts until the last one ends, or `total` seconds. */
function sound(frequencies, step, shape = {}, total) {
  const length = shape.length ?? 0.16
  const samples = new Float64Array(Math.round((total ?? step * (frequencies.length - 1) + length) * RATE))
  frequencies.forEach((frequency, index) => note(samples, frequency, index * step, shape))
  return samples
}

/** 16-bit mono PCM in a RIFF WAVE container. */
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, index) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), index * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/** One ring and the silence after it: a loop of this file rings every `RING_SECONDS`. */
const RING_SECONDS = 3.2

/**
 * The ring candidates, each one ring without the silence. All sit an octave
 * or more below the join sound, start softly and fade within a second.
 */
const rings = {
  // Two low notes rising a fifth: the join sound's shape, an octave and more down and slower.
  invite: () => sound([C5, G5].map((f) => f / 2), 0.22, { length: 0.7, attack: 0.02, decay: 6, gain: 0.95, smooth: true }),
  // Three notes up a C major chord, like a soft marimba: the warmest and the longest.
  rise: () => sound([E4, G4, C5], 0.16, { length: 0.75, attack: 0.015, decay: 6.5, gain: 0.85, smooth: true }),
  // One low chord that swells in and fades: no rhythm at all, the calmest.
  swell: () => {
    const samples = new Float64Array(Math.round(1.1 * RATE))
    for (const [frequency, gain] of [[C4, 0.55], [G4, 0.4], [E5, 0.22], [A4, 0.12]]) note(samples, frequency, 0, { length: 1.1, attack: 0.12, decay: 3.2, gain, smooth: true })
    return samples
  },
}

/** The ring the app plays. "rise": three warm notes, plainly the join sound's family, gentle enough to repeat. */
const RING = 'rise'

/** A ring followed by silence up to `RING_SECONDS`. */
function looped(samples) {
  const out = new Float64Array(Math.round(RING_SECONDS * RATE))
  out.set(samples.subarray(0, out.length))
  return out
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appSounds = join(root, 'apps/desktop/src/renderer/containers/huddle/sounds')
writeFileSync(join(appSounds, 'huddle-join.wav'), wav(sound([G5, C6], 0.11)))
writeFileSync(join(appSounds, 'huddle-leave.wav'), wav(sound([C6, G5], 0.11)))
writeFileSync(join(appSounds, 'huddle-ring.wav'), wav(looped(rings[RING]())))

// The sound page plays each candidate from a data url, so it works opened from disk.
const page = join(root, 'docs/design/huddle-ring/index.html')
const urls = Object.fromEntries(Object.entries(rings).map(([name, make]) => [name, `data:audio/wav;base64,${wav(make()).toString('base64')}`]))
urls.join = `data:audio/wav;base64,${wav(sound([G5, C6], 0.11)).toString('base64')}`
writeFileSync(page, ringPage(urls))

/** The sound page: each candidate once, or ringing as the app would, in the OS theme. */
function ringPage(sounds) {
  const choices = [
    ['invite', 'Invite', 'Two low notes rising a fifth. The join sound, an octave and more down and slower.'],
    ['rise', 'Rise', 'Three notes up a warm major chord, like a soft marimba. Plainly the join sound\'s family.'],
    ['swell', 'Swell', 'One low chord that swells in and fades. No rhythm at all, the calmest of the three.'],
  ]
  const cards = choices.map(([key, name, about]) => `
      <section class="card${key === RING ? ' chosen' : ''}">
        <h2>${name}${key === RING ? ' <span class="tag">Default</span>' : ''}</h2>
        <p>${about}</p>
        <div class="buttons">
          <button type="button" data-once="${key}">Play once</button>
          <button type="button" data-ring="${key}">Ring</button>
        </div>
      </section>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Juno: incoming huddle ring</title>
<style>
  :root { color-scheme: light dark; --bg: #FBFAF7; --card: #FFFFFF; --text: #1F1E1B; --muted: #6B6862; --edge: #E4E1DA; --accent: #E0613F; --accent-fg: #FFFFFF; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1B1A18; --card: #252421; --text: #EDEBE6; --muted: #A9A59D; --edge: #38362F; --accent: #F07A58; --accent-fg: #1B1A18; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 40px 24px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  .lead { color: var(--muted); margin: 0 0 24px; }
  .card { background: var(--card); border: 1px solid var(--edge); border-radius: 12px; padding: 16px 18px; margin-bottom: 12px; }
  .card.chosen { border-color: var(--accent); }
  h2 { font-size: 15px; margin: 0 0 4px; display: flex; align-items: center; gap: 8px; }
  .tag { font-size: 11px; font-weight: 600; color: var(--accent); }
  p { margin: 0 0 12px; color: var(--muted); }
  .buttons { display: flex; gap: 8px; }
  button { font: inherit; cursor: default; border-radius: 8px; padding: 5px 12px; border: 1px solid var(--edge); background: transparent; color: var(--text); }
  button[data-ring] { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
  button[aria-pressed="true"] { outline: 2px solid var(--accent); outline-offset: 2px; }
  .compare { margin-top: 24px; color: var(--muted); }
  .compare button { margin-left: 4px; }
</style>
</head>
<body>
<main>
  <h1>Incoming huddle ring</h1>
  <p class="lead">When someone starts a huddle where you are, Juno rings until you join, dismiss it, or 30 seconds pass. These are three candidates. Ring plays one every ${RING_SECONDS} seconds for 30 seconds, as Juno would; press it again to stop. Juno plays them at half volume.</p>
  ${cards}
  <p class="compare">For comparison, Juno's join sound: <button type="button" data-once="join">Play</button></p>
</main>
<script>
  const sounds = ${JSON.stringify(sounds)}
  const RING_MS = ${RING_SECONDS * 1000}
  let ringing = null
  function play(key) { const audio = new Audio(sounds[key]); audio.volume = 0.5; void audio.play() }
  function stop() {
    if (ringing === null) return
    clearInterval(ringing.timer); clearTimeout(ringing.end); ringing.button.setAttribute('aria-pressed', 'false'); ringing.button.textContent = 'Ring'; ringing = null
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (button === null) return
    if (button.dataset.once !== undefined) return play(button.dataset.once)
    const key = button.dataset.ring
    const same = ringing !== null && ringing.button === button
    stop()
    if (same) return
    play(key)
    ringing = { button, timer: setInterval(() => play(key), RING_MS), end: setTimeout(stop, 30000) }
    button.setAttribute('aria-pressed', 'true'); button.textContent = 'Stop'
  })
</script>
</body>
</html>
`
}
