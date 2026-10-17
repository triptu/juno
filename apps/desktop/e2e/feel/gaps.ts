/** The space between items that must stay what the design says, frame by frame. */
import { fail, framesIn, pass, shot, shotsOf, type Check, type Window as Frames } from './checks'
import type { ProbeFrame } from './recorder'

/**
 * Consecutive boxes of a `rows` probe with the same key (bubbles of one
 * group) sit exactly `gap` apart in every frame: no space opens between them,
 * whether a row was laid out at its size estimate or not.
 */
export function evenGaps(probe: string, label: string, gap: number, options: Frames = {}): Check {
  const name = `${label} stay ${gap} px apart`
  return (evidence) => {
    const frames = framesIn(evidence.recording, options)
    const off: Array<{ frame: ProbeFrame; by: number }> = []
    let pairs = 0
    for (const frame of frames) {
      const boxes = frame.values[probe]
      if (!Array.isArray(boxes)) continue
      for (let i = 1; i < boxes.length; i++) {
        const above = boxes[i - 1]!
        const below = boxes[i]!
        if (above.key === '' || above.key !== below.key) continue
        pairs++
        const by = below.y - (above.y + above.height)
        if (Math.abs(by - gap) > 0.5) off.push({ frame, by })
      }
    }
    if (pairs === 0) return fail(name, 'no two bubbles of one group were in view', [])
    if (off.length === 0) return pass(name, `${pairs} pairs over ${frames.length} animation frames`)
    const frameCount = new Set(off.map((o) => o.frame.index)).size
    return fail(name, `${off.length} of ${pairs} pairs off, in ${frameCount} animation frames: ${off.slice(0, 6).map((o) => `${Math.round(o.by * 10) / 10}px at frame #${shot(evidence, o.frame)}`).join(', ')}`, shotsOf(evidence, off.map((o) => o.frame)).slice(0, 12))
  }
}
