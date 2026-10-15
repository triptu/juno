import { defineFixtures, fixture } from '@juno/ui'
import { Composer } from './Composer'

const noop = () => {}

const base = { onChange: noop, onSend: noop }

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
  },
  { width: 816, padded: false },
)
