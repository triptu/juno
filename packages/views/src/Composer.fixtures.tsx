import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { defineFixtures, fixture, scene } from '@juno/ui'
import { AudienceWarning } from './AudienceWarning'
import { Composer } from './Composer'
import { useFixtureControl } from './juno-chat/fixtures/control'
import { SendCheckBar, type SendCheckFinding } from './SendCheckBar'

const noop = () => {}

const base = { onChange: noop, onSend: noop }

const route: SendCheckFinding = { kind: 'route', title: 'Staging bill doubled since August' }
const fixes: SendCheckFinding = { kind: 'clarity', fixes: ['recieve → receive', 'the the → the', 'add ?'] }
const routeBar = <SendCheckBar finding={route} confidence={0.97} onPrimary={noop} onSecondary={noop} />
const clarityBar = <SendCheckBar finding={fixes} confidence={0.9} onPrimary={noop} onSecondary={noop} />
const audience = <AudienceWarning message="This reads like hiring or people detail. eng is a public channel." />

/**
 * The composer at the bottom of a column, as a topic shows it, with the
 * audience line and the check bar coming and going. The test drives them
 * through `window.__fixtureControls` and checks that the text row and the
 * field's bottom edge never move.
 */
function NoticesComeAndGo() {
  const [notices, setNotices] = useState<'none' | 'audience' | 'bar' | 'both'>('none')
  useFixtureControl('audience', () => setNotices('audience'))
  useFixtureControl('bar', () => setNotices('bar'))
  useFixtureControl('both', () => setNotices('both'))
  useFixtureControl('none', () => setNotices('none'))
  return (
    <div {...stylex.props(styles.column)}>
      <Composer
        {...base}
        value="the preview environments reaper should cut the staging bill"
        placeholder="Message #eng"
        notices={
          notices === 'none' ? undefined : (
            <>
              {notices === 'audience' || notices === 'both' ? audience : null}
              {notices === 'bar' || notices === 'both' ? routeBar : null}
            </>
          )
        }
      />
    </div>
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
    // Spec section 8: the check bar on Enter, and the audience line while typing.
    Checks: {
      'wrong-place': fixture({ ...base, value: 'the preview environments reaper should cut the staging bill', placeholder: 'Message #eng', notices: routeBar, onEscape: noop }),
      clarity: fixture({ ...base, value: 'can you recieve the the report by friday', placeholder: 'Message #eng', notices: clarityBar, onEscape: noop }),
      audience: fixture({ ...base, value: 'The offer for Rina goes out Friday, salary is settled', placeholder: 'Message #eng', notices: audience }),
      'audience-and-check': fixture({
        ...base,
        value: 'the offer for rina goes out friday',
        placeholder: 'Message #eng',
        notices: (
          <>
            {audience}
            {clarityBar}
          </>
        ),
        onEscape: noop,
      }),
    },
    Shift: {
      'notices-come-and-go': scene(() => <NoticesComeAndGo />, { height: 320 }),
    },
  },
  { width: 816, padded: false },
)

const styles = stylex.create({
  column: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    height: '100%',
  },
})
