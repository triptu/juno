import * as stylex from '@stylexjs/stylex'
import { ArrowUp, Plus } from 'lucide-react'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { IconButton } from './IconButton'
import { Surface } from './Surface'
import { Textarea } from './Textarea'

export default defineFixtures(
  Textarea,
  {
    plain: fixture({ variant: 'plain', placeholder: 'Write a message', label: 'Message' }),
    'plain-filled': fixture({ variant: 'plain', defaultValue: 'Kicking off the Q1 planning cycle. Drafts due Friday.', label: 'Message' }),
    card: fixture({ variant: 'card', defaultValue: 'The Wednesday slot works for eng.', label: 'Message' }),
    composer: scene(() => (
      <Surface kind="inset" radius="2xl" padding="none" sx={styles.composer}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, padding: 6 }}>
          <IconButton icon={Plus} label="Attach" size={28} radius="full" iconSize={18} />
          <Textarea variant="inline" placeholder="Reply" label="Reply" />
          <IconButton icon={ArrowUp} label="Send" size={28} radius="full" variant="primary" dimmed />
        </div>
      </Surface>
    )),
    'composer-grown': scene(() => (
      <Surface kind="inset" radius="2xl" padding="none" sx={styles.composer}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, padding: 6 }}>
          <IconButton icon={Plus} label="Attach" size={28} radius="full" iconSize={18} />
          <Textarea
            variant="inline"
            label="Reply"
            defaultValue={'Thursday works. I will pair.\n\n> What is the rollback if replication lags on cutover day?\n\nWe keep the old primary warm for 48h.'}
          />
          <IconButton icon={ArrowUp} label="Send" size={28} radius="full" variant="primary" />
        </div>
      </Surface>
    )),
  },
  { width: 560 },
)

const styles = stylex.create({
  composer: { width: '100%' },
})
