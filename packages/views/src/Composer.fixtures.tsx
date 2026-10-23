import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { markupLayout, type MentionChannel, type MentionGroup, type MentionPerson } from '@juno/contract'
import { defineFixtures, fixture, scene, type TextareaMark } from '@juno/ui'
import { AttachButton } from './AttachButton'
import { AttachmentChips } from './AttachmentChips'
import { chips } from './AttachmentChips.fixtures'
import { AudienceWarning } from './AudienceWarning'
import { Composer } from './Composer'
import { useFixtureControl } from './juno-chat/fixtures/control'
import { LinkEditor } from './LinkEditor'
import { MentionSuggestions } from './MentionSuggestions'
import { mentionRowId } from './mentionRowId'
import { SendCheckBar, type SendCheckFinding } from './SendCheckBar'

const noop = () => {}

const imageEmoji = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${fill}"/><circle cx="11" cy="13" r="2" fill="#2B1E00"/><circle cx="21" cy="13" r="2" fill="#2B1E00"/><path d="M10 20c3 4 9 4 12 0" stroke="#2B1E00" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  )}`

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
const routeBar = <SendCheckBar finding={route} onPrimary={noop} onSecondary={noop} />
const clarityBar = <SendCheckBar finding={fixes} onPrimary={noop} onSecondary={noop} />
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

export const people: ReadonlyArray<MentionPerson> = [
  person('U0MAYA', 'Maya', 'Maya Chen', 'claret', 0),
  person('U0MARCO', 'Marco', 'Marco Silva', 'jordy', 0),
  person('U0MALIK', 'Malik', 'Malik Osei', 'emerald', 1),
  person('U0MARTA', 'Marta', 'Marta Nowak', 'plum', 2),
]

export const channels: ReadonlyArray<MentionChannel> = [
  { id: 'C0PLATFORM', name: 'platform', kind: 'public', tier: 0, order: 0, names: ['platform'] },
  { id: 'C0PLANNING', name: 'planning', kind: 'private', tier: 0, order: 1, names: ['planning'] },
  { id: 'C0PLAYBOOKS', name: 'playbooks', kind: 'public', tier: 1, order: 2, names: ['playbooks'] },
]

const groups: ReadonlyArray<MentionGroup> = [
  { id: 'S0MARKETING', handle: 'marketing', name: 'Marketing team', tier: 0, order: 0, names: ['marketing', 'Marketing team'] },
  { id: 'S0MAINT', handle: 'maintainers', name: 'Repository maintainers', tier: 1, order: 1, names: ['maintainers', 'Repository maintainers'] },
]

const LIST = 'mentions'

/** The composer with the @ or # list open over `value`, its trigger at `at`; with `withGroups`, user groups after the people. */
function MentionsOpen({ value, at, kind, withGroups = false }: { readonly value: string; readonly at: number; readonly kind: 'person' | 'channel'; readonly withGroups?: boolean }) {
  const rows = kind === 'person' ? { kind, rows: people, ...(withGroups ? { groups } : {}) } : { kind, rows: channels }
  const activeId = mentionRowId(LIST, rows.rows[0]!.id)
  return (
    <div {...stylex.props(styles.column)}>
      <Composer
        {...base}
        value={value}
        placeholder="Reply"
        marks={value.startsWith('Ask @Leo') ? [{ start: 4, end: 8, look: 'person', hue: 'midnight' }] : value.startsWith('cc @design-crew') ? [{ start: 3, end: 15, look: 'person', hue: 'jordy' }] : []}
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

const LINKED = 'Read the docs first, then example.com/notes.'
const linked: ReadonlyArray<TextareaMark> = [
  { start: 5, end: 13, look: 'link' },
  { start: 26, end: 43, look: 'link' },
]

/** The link editor open on "the docs" (inventory 7.1a). */
function LinkEditorOpen({ url }: { readonly url: string }) {
  return (
    <div {...stylex.props(styles.column)}>
      <Composer
        {...base}
        value={LINKED}
        placeholder="Reply"
        marks={url === '' ? linked.slice(1) : linked}
        popover={{ anchorAt: 5, content: <LinkEditor url={url} onSave={() => true} {...(url === '' ? {} : { onRemove: noop })} onCancel={noop} /> }}
      />
    </div>
  )
}

const picked: ReadonlyArray<TextareaMark> = [
  { start: 7, end: 12, look: 'person', hue: 'claret' },
  { start: 32, end: 41, look: 'channel' },
]

const MARKUP = [
  '*Ship it* _today_, ~not~ Friday. Run `pnpm test` first and ask *@Maya* about _example.com/plan_.',
  '> *Quoted* with `code`',
  '> and a second line',
  '```',
  'const done = await ship()',
  'return done',
  '```',
  'snake_case_name and 2*3*4 stay as typed.',
].join('\n')
const markupMarks: ReadonlyArray<TextareaMark> = [
  { start: MARKUP.indexOf('@Maya'), end: MARKUP.indexOf('@Maya') + 5, look: 'person', hue: 'claret' },
  { start: MARKUP.indexOf('example.com'), end: MARKUP.indexOf('example.com') + 16, look: 'link' },
]

/** The field with Slack's markup in it, drawn as it will look; it takes typing, for checking the caret against the drawn text. */
function MarkupField({ initial, marks = [] }: { readonly initial: string; readonly marks?: ReadonlyArray<TextareaMark> }) {
  const [value, setValue] = useState(initial)
  const shown = value === initial ? marks : []
  return <Composer {...base} value={value} onChange={setValue} placeholder="Message #eng" marks={shown} format={markupLayout(value, shown)} />
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
      'people-and-groups-open': scene(() => <MentionsOpen value="cc @design-crew and @ma" at={20} kind="person" withGroups />, { height: 380 }),
      'channels-open': scene(() => <MentionsOpen value="#pla" at={0} kind="channel" />, { height: 260 }),
      // Far right in a wide field: the list stays inside the composer's width.
      'open-at-the-end': scene(() => <MentionsOpen value={`${'The numbers for the quarter are in and they look good. '.repeat(1)}cc @ma`} at={58} kind="person" />, {
        height: 300,
      }),
    },
    // Inventory 7.1a: typed URLs and linked words, and the link editor ⌘K opens.
    Links: {
      'in-the-field': fixture({ ...base, value: LINKED, placeholder: 'Reply', marks: linked }),
      'editor-new': scene(() => <LinkEditorOpen url="" />, { height: 200 }),
      'editor-existing': scene(() => <LinkEditorOpen url="https://example.com/docs" />, { height: 200 }),
    },
    // Spec section 8: Slack's markup as it will look, in the field's own font.
    Markup: {
      mixed: scene(() => <MarkupField initial={MARKUP} marks={markupMarks} />, { height: 280 }),
      styles: scene(() => <MarkupField initial="*bold* _italic_ ~strike~ `code` and *_both_*" />),
      'code-block': scene(() => <MarkupField initial={'Before\n```\nmake build\nmake test\n```\nAfter'} />, { height: 200 }),
      quote: scene(() => <MarkupField initial={'> Can we ship Friday?\n> Or Monday\nFriday works.'} />, { height: 160 }),
    },
    Emoji: {
      'suggestions-open': scene(() => <div {...stylex.props(styles.column)}><Composer {...base} value=":smile" placeholder="Reply" marks={[]}
        mention={{ anchorAt: 0, listId: 'emoji', activeId: 'emoji-smile', onDismiss: noop,
          list: <MentionSuggestions kind="emoji" id="emoji" activeId="emoji-smile" onActivate={noop} onPick={noop}
            rows={[
              { id: 'smile', name: 'smile', insert: '😄' },
              { id: 'sweat-smile', name: 'sweat_smile', insert: '😅' },
              { id: 'smile-cat', name: 'smile_cat', insert: '😸' },
              { id: 'simple-smile', name: 'simple_smile', insert: ':simple_smile:', url: imageEmoji('#F4BC58') },
              { id: 'workspace-smile', name: 'workspace_smile', insert: ':workspace_smile:', url: imageEmoji('#C86BD6') },
            ]} /> }} /></div>, { height: 320 }),
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
