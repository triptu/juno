// Typing in the composer: "@ma" typed quickly in a reply. Each character
// shows in the next frame, the @ suggestions open above the field with rows
// in their first frame, narrow in place without emptying, and nothing moves.
import { expect } from '@playwright/test'
import { feedbackInOneFrame, landsAndStays, noFlicker, noLayoutShift, noLongFrames, opensWhole, shotOfFrame, type Check } from './checks'
import { test } from './feel'
import { tag } from './pane'
import type { Probe, Rect } from './recorder'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

const POSTGRES = 'Draft plan is in the doc'
const LIST = '[data-topic-view] [data-mention-suggestions]'

const isRect = (value: unknown): value is Rect => typeof value === 'object' && value !== null && 'width' in value

/** Once open, the list stays open and keeps its left and bottom edges while it narrows: only its top moves. */
const narrowsInPlace: Check = (evidence) => {
  const { recording } = evidence
  const shots = (frames: ReadonlyArray<{ readonly index: number }>) => [...new Set(frames.slice(0, 6).map((frame) => shotOfFrame(evidence, frame.index)))]
  const name = 'the suggestions narrow in place'
  const open = recording.frames.filter((frame) => isRect(frame.values['list']))
  const first = recording.frames.findIndex((frame) => isRect(frame.values['list']))
  if (first === -1) return { name, status: 'fail', detail: 'the list never opened', shots: [] }
  const closed = recording.frames.slice(first).filter((frame) => !isRect(frame.values['list']))
  if (closed.length > 0) return { name, status: 'fail', detail: `closed in ${closed.length} frames after opening`, shots: shots(closed) }
  const at = open[0]!.values['list'] as Rect
  const moved = open.filter((frame) => {
    const box = frame.values['list'] as Rect
    return Math.abs(box.x - at.x) > 1 || Math.abs(box.y + box.height - (at.y + at.height)) > 1
  })
  if (moved.length > 0) return { name, status: 'fail', detail: `its left or bottom edge moved in ${moved.length} frames`, shots: shots(moved) }
  return { name, status: 'pass', detail: `left ${Math.round(at.x)}, bottom ${Math.round(at.y + at.height)} in every frame`, shots: [] }
}

test('typing a mention', { tag: ['@heavy', '@heavy-feel'] }, async ({ juno, win, feel }) => {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.topic.composer.focus()
  await juno.topic.composer.pressSequentially('Thanks ')
  const field = await tag(juno.topic.composerField, 'composer-field')

  const probes: Probe[] = [
    { kind: 'rect', name: 'field', selector: field },
    // The field's text is drawn by the layer under it, so the layer's text is what the user sees.
    { kind: 'text', name: 'typed', selector: `${field} [data-textarea-layer]` },
    { kind: 'rect', name: 'list', selector: LIST },
    { kind: 'text', name: 'listText', selector: LIST },
  ]
  await feel.run(
    {
      name: 'mention-typing',
      title: 'Type "@ma" quickly in a reply: each character in the next frame, the list opens whole above the field and narrows in place',
      probes,
      checks: [
        feedbackInOneFrame('typed', 'keydown', '"@"', { from: 'at' }),
        feedbackInOneFrame('typed', 'keydown', '"m"', { from: 'm' }),
        feedbackInOneFrame('typed', 'keydown', '"a"', { from: 'a' }),
        opensWhole('list', 'listText', 'the suggestions', { from: 'at' }),
        narrowsInPlace,
        landsAndStays('field', 'the composer', { from: 'at' }),
        // The list's top moves down as it narrows, in answer to the key; `narrowsInPlace` holds its other edges.
        noLayoutShift(),
        noFlicker('window', 'the window'),
        noLongFrames(),
      ],
    },
    async (rec) => {
      await rec.mark('at')
      await win.keyboard.press('@')
      await rec.mark('m')
      await win.keyboard.press('m')
      await rec.mark('a')
      await win.keyboard.press('a')
      await expect(juno.topic.suggestion('Maya')).toBeVisible()
      await win.waitForTimeout(300)
    },
  )
})
