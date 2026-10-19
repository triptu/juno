#!/usr/bin/env node
/**
 * Writes the huddle's join and leave sounds (SPEC 20, "Sounds") as small WAV
 * files: two soft sine notes each, rising for a join and falling for a leave.
 * They are Juno's own, made here from plain tones, so nothing is copied from
 * Slack. Run it again only to change them:
 *
 *   node scripts/huddle-sounds.mjs
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 24_000
/** The loudest a sample gets, of full scale. The page plays them quieter still. */
const PEAK = 0.3
const NOTE_SECONDS = 0.16
/** The second note starts this long after the first. */
const STEP_SECONDS = 0.11
const ATTACK_SECONDS = 0.008

const G5 = 783.99
const C6 = 1046.5

/** One note: a sine with a quiet octave above it, a short fade in and an exponential fade out. */
function note(frequency, at, samples) {
  const start = Math.round(at * RATE)
  const length = Math.round(NOTE_SECONDS * RATE)
  for (let i = 0; i < length && start + i < samples.length; i++) {
    const t = i / RATE
    const attack = Math.min(1, t / ATTACK_SECONDS)
    const decay = Math.exp(-t * 22)
    const tone = Math.sin(2 * Math.PI * frequency * t) + 0.15 * Math.sin(4 * Math.PI * frequency * t)
    samples[start + i] += (tone / 1.15) * attack * decay * PEAK
  }
}

function sound(frequencies) {
  const samples = new Float64Array(Math.round((STEP_SECONDS * (frequencies.length - 1) + NOTE_SECONDS) * RATE))
  frequencies.forEach((frequency, index) => note(frequency, index * STEP_SECONDS, samples))
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

const folder = join(dirname(fileURLToPath(import.meta.url)), '../apps/desktop/src/renderer/containers/huddle/sounds')
writeFileSync(join(folder, 'huddle-join.wav'), wav(sound([G5, C6])))
writeFileSync(join(folder, 'huddle-leave.wav'), wav(sound([C6, G5])))
