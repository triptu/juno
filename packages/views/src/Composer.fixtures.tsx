import { useState } from 'react'
import { defineFixtures, fixture, scene } from '@juno/ui'
import { AttachButton } from './AttachButton'
import { AttachmentChips } from './AttachmentChips'
import { chips } from './AttachmentChips.fixtures'
import { Composer } from './Composer'
import { useFixtureControl } from './juno-chat/fixtures/control'

const noop = () => {}

const base = { onChange: noop, onSend: noop }

const attach = { leading: <AttachButton onFiles={noop} />, onFiles: noop }

/**
 * Chips leave one by one on the test's command; the test checks that the text
 * row stays put. The remove buttons do nothing here, so the generic shift
 * guard can press them.
 */
function ChipRemoval() {
  const [files, setFiles] = useState([chips.image, chips.pdf, chips.sheet])
  useFixtureControl('remove', () => setFiles((current) => current.slice(1)))
  return (
    <Composer
      {...base}
      {...attach}
      value="Numbers from last night"
      placeholder="Reply"
      attachments={<AttachmentChips files={files} onRemove={noop} />}
    />
  )
}

export default defineFixtures(
  Composer,
  {
    Draft: {
      empty: fixture({ ...base, value: '', placeholder: 'Message' }),
      'one-line': fixture({ ...base, value: 'Thursday works for me.', placeholder: 'Reply' }),
      'several-lines': fixture({ ...base, value: 'Three things before the cutover:\n1. Replica lag under a second\n2. Support signed off\n3. Rollback tested', placeholder: 'Message #eng' }),
      // Taller than the field allows: it scrolls inside.
      long: fixture({ ...base, value: Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of a long draft`).join('\n'), placeholder: 'Message #eng' }),
      'right-to-left': fixture({ ...base, value: 'مرحبا، هل يمكننا نقل الموعد إلى الخميس؟', placeholder: 'Message محمد' }),
      sending: fixture({ ...base, value: 'Thursday works for me.', placeholder: 'Reply', sending: true }),
    },
    Attachments: {
      'attach-button': fixture({ ...base, ...attach, value: '', placeholder: 'Reply' }),
      'with-chips': fixture({
        ...base,
        ...attach,
        value: 'Numbers from last night, with the runbook.',
        placeholder: 'Reply',
        attachments: <AttachmentChips files={[chips.image, { ...chips.pdf, state: 'staging' }]} onRemove={noop} />,
      }),
      dropping: fixture({ ...base, ...attach, value: '', placeholder: 'Message #eng', dropping: true }),
      'dropping-with-chips': fixture({
        ...base,
        ...attach,
        value: '',
        placeholder: 'Message #eng',
        dropping: true,
        attachments: <AttachmentChips files={[chips.pdf]} onRemove={noop} />,
      }),
      'chip-removal': scene(() => <ChipRemoval />),
    },
  },
  { width: 816, padded: false },
)
