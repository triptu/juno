import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import type { MentionChannel, MentionPerson } from '@juno/contract'
import { defineFixtures, fixture, scene, type TextareaMark } from '@juno/ui'
import { AttachButton } from './AttachButton'
import { AttachmentChips } from './AttachmentChips'
import { chips } from './AttachmentChips.fixtures'
import { AudienceWarning } from './AudienceWarning'
import { Composer } from './Composer'
import { useFixtureControl } from './juno-chat/fixtures/control'
import { MentionSuggestions, mentionRowId } from './MentionSuggestions'
import { SendCheckBar, type SendCheckFinding } from './SendCheckBar'

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
function NoticesComeAndGo({ withChips = false }: { readonly withChips?: boolean }) {
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
        {...(withChips ? { ...attach, attachments: <AttachmentChips files={[chips.image, chips.pdf]} onRemove={noop} /> } : {})}
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

const person = (id: string, name: string, realName: string, color: MentionPerson['color'], tier: number): MentionPerson => ({
  id,
  name,
  realName,
  color,
  tier,
  order: 0,
  names: [name, realName],
})

const people: ReadonlyArray<MentionPerson> = [
  person('U0MAYA', 'Maya', 'Maya Chen', 'claret', 0),
  person('U0MARCO', 'Marco', 'Marco Silva', 'jordy', 0),
  person('U0MALIK', 'Malik', 'Malik Osei', 'emerald', 1),
  person('U0MARTA', 'Marta', 'Marta Nowak', 'plum', 2),
]

const channels: ReadonlyArray<MentionChannel> = [
  { id: 'C0PLATFORM', name: 'platform', kind: 'public', tier: 0, order: 0, names: ['platform'] },
  { id: 'C0PLANNING', name: 'planning', kind: 'private', tier: 0, order: 1, names: ['planning'] },
  { id: 'C0PLAYBOOKS', name: 'playbooks', kind: 'public', tier: 1, order: 2, names: ['playbooks'] },
]

const LIST = 'mentions'

/** The composer with the @ or # list open over `value`, its trigger at `at`. */
function MentionsOpen({ value, at, kind }: { readonly value: string; readonly at: number; readonly kind: 'person' | 'channel' }) {
  const rows = kind === 'person' ? { kind, rows: people } : { kind, rows: channels }
  const activeId = mentionRowId(LIST, rows.rows[0]!.id)
  return (
    <div {...stylex.props(styles.column)}>
      <Composer
        {...base}
        value={value}
        placeholder="Reply"
        marks={value.startsWith('Ask @Leo') ? [{ start: 4, end: 8, look: 'person', hue: 'midnight' }] : []}
        mention={{
          anchorAt: at,
          listId: LIST,
          activeId,
          list: <MentionSuggestions {...rows} id={LIST} activeId={activeId} onActivate={noop} onPick={noop} />,
          onDismiss: noop,
        }}
      />
    </div>
  )
}

const picked: ReadonlyArray<TextareaMark> = [
  { start: 7, end: 12, look: 'person', hue: 'claret' },
  { start: 32, end: 41, look: 'channel' },
]

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
      'check-bar-with-chips': fixture({
        ...base,
        ...attach,
        value: 'the preview environments reaper should cut the staging bill',
        placeholder: 'Message #eng',
        notices: routeBar,
        onEscape: noop,
        attachments: <AttachmentChips files={[chips.image, chips.pdf]} onRemove={noop} />,
      }),
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
      // A narrow topic column (720px window): the choices take a line of their own under the finding.
      'narrow-audience-and-check': fixture(
        {
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
        },
        { width: 336 },
      ),
      'narrow-wrong-place': fixture({ ...base, value: 'the preview environments reaper should cut the staging bill', placeholder: 'Message #eng', notices: routeBar, onEscape: noop }, { width: 336 }),
    },
    // Inventory 7.1: @ and # suggestions, and the picked names as chips.
    Mentions: {
      chips: fixture({ ...base, value: 'Thanks @Maya for the notes, see #platform for the plan.', placeholder: 'Reply', marks: picked }),
      'people-open': scene(() => <MentionsOpen value="Ask @Leo and @ma" at={13} kind="person" />, { height: 300 }),
      'channels-open': scene(() => <MentionsOpen value="#pla" at={0} kind="channel" />, { height: 260 }),
      // Far right in a wide field: the list stays inside the composer's width.
      'open-at-the-end': scene(() => <MentionsOpen value={`${'The numbers for the quarter are in and they look good. '.repeat(1)}cc @ma`} at={58} kind="person" />, {
        height: 300,
      }),
    },
    Shift: {
      'notices-come-and-go': scene(() => <NoticesComeAndGo />, { height: 320 }),
      'notices-over-chips': scene(() => <NoticesComeAndGo withChips />, { height: 400 }),
    },
  },
  { width: 816, padded: false },
)

const styles = stylex.create({
  column: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    width: '100%',
    height: '100%',
  },
})
