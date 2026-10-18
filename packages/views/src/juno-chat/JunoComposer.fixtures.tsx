import { useState } from 'react'
import { chatCopy } from '@juno/agent-contract'
import { defineFixtures, fixture, scene, type FixtureFrame, type TextareaMark } from '@juno/ui'
import { AttachButton } from '../AttachButton'
import { AttachmentChips, type AttachmentChip } from '../AttachmentChips'
import { chips } from '../AttachmentChips.fixtures'
import { AttachmentNote } from '../AttachmentNote'
import { channels, people } from '../Composer.fixtures'
import { MentionSuggestions } from '../MentionSuggestions'
import { mentionRowId } from '../mentionRowId'
import { bubbleId, cardId, quoteOf } from './fixtures/data'
import { JunoComposer, type JunoComposerProps } from './JunoComposer'

const noop = () => {}

const composer = (overrides: Partial<JunoComposerProps> = {}, frame?: FixtureFrame) => fixture<JunoComposerProps>({ value: '', onChange: noop, onSend: noop, enabled: true, ...overrides }, frame)

/** A live draft, so typing and Enter can be tried in the gallery. */
function Live() {
  const [value, setValue] = useState('')
  const [sent, setSent] = useState<string | undefined>(undefined)
  return (
    <>
      <JunoComposer value={value} onChange={setValue} onSend={() => { setSent(value); setValue('') }} enabled />
      <p>{sent === undefined ? 'Nothing sent yet' : `Sent: ${sent}`}</p>
    </>
  )
}

const frame: FixtureFrame = { width: 816, padded: false }

const LIST = 'juno-mentions'
const maya: TextareaMark = { start: 4, end: 9, look: 'person', hue: 'claret' }

/** The composer with the @ or # list open, its trigger at `at`, over a draft that already holds a picked person. */
function MentionsOpen({ value, at, kind, column = 'page' }: { readonly value: string; readonly at: number; readonly kind: 'person' | 'channel'; readonly column?: 'page' | 'panel' }) {
  const rows = kind === 'person' ? { kind, rows: people } : { kind, rows: channels }
  const activeId = mentionRowId(LIST, rows.rows[0]!.id)
  return (
    <JunoComposer
      value={value}
      onChange={noop}
      onSend={noop}
      enabled
      column={column}
      marks={[maya]}
      mention={{ anchorAt: at, listId: LIST, activeId, list: <MentionSuggestions {...rows} id={LIST} activeId={activeId} onActivate={noop} onPick={noop} />, onDismiss: noop }}
    />
  )
}

/** The attach button and the chips, as the Juno tab and the panel show them. */
const files = (list: ReadonlyArray<AttachmentChip>, note?: string): Partial<JunoComposerProps> => {
  const shown = <AttachmentChips files={list} onRemove={noop} />
  return { leading: <AttachButton onFiles={noop} />, onFiles: noop, hasFiles: true, attachments: note === undefined ? shown : <AttachmentNote chips={shown} note={note} /> }
}
const notes: AttachmentChip = { id: 'c-notes', name: 'cutover-notes.md', size: 6_120, mimetype: 'text/markdown', state: 'ready' }
const reading: AttachmentChip = { id: 'c-reading', name: 'IMG_2041.png', size: 2_418_221, mimetype: 'image/png', state: 'staging' }

export default defineFixtures(
  JunoComposer,
  {
    Composer: {
      empty: composer(),
      draft: composer({ value: 'What did I miss in #eng?' }),
      'multi-line': composer({ value: 'Three things:\n1. the plan\n2. the flake\n3. the offsite\n4. and the room\n5. and the pricing copy\n6. and the hiring loop\n7. and the PR' }),
      'job-line': composer({ placeholder: 'T3 Code · tests running, 2 of 5' }),
      disabled: composer({ enabled: false }),
      'right-to-left': composer({ value: 'מה פספסתי ב-#eng הבוקר?' }),
      'quote-bubble': composer({ value: 'which deploy?', quote: quoteOf({ _tag: 'bubble', id: bubbleId('b1') }, 'The deploy is green on staging. Production goes at 4.'), onClearQuote: noop }),
      'quote-card': composer({ quote: quoteOf({ _tag: 'card', id: cardId('c1') }, 'Send message · #eng'), onClearQuote: noop }),
      'quote-removed': composer({ quote: quoteOf({ _tag: 'bubble', id: bubbleId('b2') }, '', true), onClearQuote: noop }),
    },
    // SPEC 13.1: @ and # suggest people and channels as in a topic's composer, and the picks show as chips.
    Mentions: {
      chips: composer({ value: 'Ask @Maya what changed in #platform this week', marks: [maya, { start: 26, end: 35, look: 'channel' }] }),
      'people-open': scene(() => <MentionsOpen value="Ask @Maya and @ma" at={14} kind="person" />, { ...frame, height: 300 }),
      'channels-open': scene(() => <MentionsOpen value="Ask @Maya about #pla" at={16} kind="channel" />, { ...frame, height: 260 }),
      'panel-people-open': scene(() => <MentionsOpen value="Ask @Maya and @ma" at={14} kind="person" column="panel" />, { width: 400, padded: false, height: 300 }),
    },
    Files: {
      attach: composer({ leading: <AttachButton onFiles={noop} />, onFiles: noop }),
      'image-attached': composer({ value: 'What does this dashboard show?', ...files([chips.image]) }),
      'image-only': composer(files([chips.image])),
      'image-reading': composer({ value: 'And this one?', ...files([reading]) }),
      'image-and-text-file': composer({ value: 'Do these agree?', ...files([chips.image, notes]) }),
      'model-cannot-read': composer({ value: 'What does this show?', ...files([chips.image], chatCopy.composer.filesLeft.images), hasFiles: false }),
      'file-stays': composer({ value: 'Summarise the runbook', ...files([chips.image, chips.pdf], chatCopy.composer.filesLeft.otherHere) }),
      panel: composer({ column: 'panel', placeholder: chatCopy.composer.panelPlaceholder, value: 'Is this the same error?', ...files([chips.image]) }, { width: 400, padded: false }),
    },
    Interaction: {
      focus: composer({}, { ...frame, focus: 'textarea' }),
      'send-hover': composer({ value: 'What did I miss?' }, { ...frame, hover: '[aria-label="Send"]' }),
      live: scene(() => <Live />, { ...frame, padded: true }),
    },
  },
  frame,
)
