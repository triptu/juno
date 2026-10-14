import { useState } from 'react'
import { defineFixtures, fixture, scene, type FixtureFrame } from '@juno/ui'
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
    Interaction: {
      focus: composer({}, { ...frame, focus: 'textarea' }),
      'send-hover': composer({ value: 'What did I miss?' }, { ...frame, hover: '[aria-label="Send"]' }),
      live: scene(() => <Live />, { ...frame, padded: true }),
    },
  },
  frame,
)
