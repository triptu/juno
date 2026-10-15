import * as stylex from '@stylexjs/stylex'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { useState, type ReactNode } from 'react'
import type { Hours, NotifyTag, TodayRow } from '@juno/contract'
import { colors, spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, Button, Chip, DayToggles, ListRow, Page, PageHeader, Popover, Section, Select, Surface, Text, Textarea, type PhosphorIcon } from '@juno/ui'
import { hueFor, initials } from './look'
import { clockLabel, hourLabel } from './time'

export type HoursKind = 'notifications' | 'presence'

export interface NotificationsPageProps {
  readonly notificationHours: Hours
  readonly presenceHours: Hours
  /** "What matters to you", as saved. */
  readonly matters: string
  /** Off: the field gives way to one line, DMs and mentions notify. */
  readonly aiAssist: boolean
  readonly every: ReadonlyArray<NotifyTag>
  readonly never: ReadonlyArray<NotifyTag>
  readonly interrupted: number
  readonly held: number
  /** The messages that notified today, newest first. */
  readonly today: ReadonlyArray<TodayRow>
  readonly onHoursChange: (which: HoursKind, hours: Hours) => void
  /** On blur, with the text as typed. */
  readonly onMattersSave: (text: string) => void
  /** Back to When it matters. */
  readonly onRemove: (tag: NotifyTag) => void
  /** Show why starts open (fixtures). */
  readonly showWhy?: boolean
}

const HALF_HOUR = 30
const times = Array.from({ length: (24 * 60) / HALF_HOUR }, (_, index) => {
  const minutes = index * HALF_HOUR
  return { value: String(minutes), label: hourLabel(minutes) }
})

const channelIcons: Record<Extract<NotifyTag, { kind: 'channel' }>['channelKind'], PhosphorIcon> = { public: Hash, private: Lock, im: User, mpim: Users }

/**
 * The Notifications page (SPEC 14, inventory 13): two sets of hours, what
 * matters in the owner's words, the channels and people set to Every
 * message or Never, and one line for today with Show why. Everything else
 * is said to Juno or set from a channel's or person's menu.
 */
export function NotificationsPage(props: NotificationsPageProps) {
  const { notificationHours, presenceHours, matters, aiAssist, every, never, interrupted, held, today, onHoursChange, onMattersSave, onRemove, showWhy = false } = props
  return (
    <Page width="wide">
      <PageHeader title="Notifications" subtitle="During your notification hours, Juno lets through what needs you and holds the rest. Everything is in Juno whenever you open it." />

      <Section heading="Hours">
        <Surface kind="group">
          <HoursRow which="notifications" title="Notifications" sub="When it starts, one notification sums up what needed you." hours={notificationHours} onChange={onHoursChange} />
          <HoursRow which="presence" title="Active in Slack" sub="Outside these hours you show as away." hours={presenceHours} onChange={onHoursChange} />
          <div {...stylex.props(styles.note)}>
            <Text variant="meta" tone="muted" as="p">
              Juno switches your status while it's open. If it's closed when your active hours start, you stay away until you open it.
            </Text>
          </div>
        </Surface>
      </Section>

      <Section heading="What matters to you" sub="Juno reads this for every message. You can also just tell Juno.">
        {aiAssist ? (
          <div {...stylex.props(styles.matters)}>
            <Textarea
              key={matters}
              variant="card"
              rows={3}
              label="What matters to you"
              defaultValue={matters}
              placeholder="For example: the launch, hiring, and anything from my reports that needs a decision today."
              onBlur={(event) => {
                if (event.currentTarget.value.trim() !== matters) onMattersSave(event.currentTarget.value)
              }}
            />
          </div>
        ) : (
          <Text variant="ui" tone="muted" as="p">
            AI assist is off. DMs and mentions notify you.
          </Text>
        )}
      </Section>

      <Section heading="People and channels">
        <Surface kind="group">
          {every.length === 0 && never.length === 0 ? (
            <ListRow divider={false}>
              <Text variant="ui" tone="muted">
                Every channel and person is set to When it matters.
              </Text>
            </ListRow>
          ) : (
            <>
              <LevelRow title="Every message" sub="Even outside notification hours" tags={every} onRemove={onRemove} divider />
              <LevelRow title="Never" sub="Still in Juno, no alerts" tags={never} onRemove={onRemove} divider={false} />
            </>
          )}
        </Surface>
        <Text variant="meta" tone="muted" as="p">
          Right-click a channel or person to change how it notifies you.
        </Text>
      </Section>

      <Section heading="Today">
        <Today interrupted={interrupted} held={held} rows={today} initiallyOpen={showWhy} />
      </Section>
    </Page>
  )
}

function HoursRow({ which, title, sub, hours, onChange }: { readonly which: HoursKind; readonly title: string; readonly sub: string; readonly hours: Hours; readonly onChange: NotificationsPageProps['onHoursChange'] }) {
  const set = (patch: Partial<Hours>) => onChange(which, { ...hours, ...patch })
  const from = String(Math.floor(hours.from / HALF_HOUR) * HALF_HOUR)
  const to = String(Math.floor(hours.to / HALF_HOUR) * HALF_HOUR)
  return (
    <ListRow
      aria-label={title}
      trailing={
        <span {...stylex.props(styles.controls)}>
          <DayToggles days={hours.days} label={`${title} days`} onChange={(days) => set({ days })} />
          <Select size={32} label={`${title} from`} options={times} value={from} onChange={(event) => set({ from: Number(event.currentTarget.value) })} />
          <Text variant="ui" tone="muted">
            to
          </Text>
          <Select size={32} label={`${title} to`} options={times} value={to} onChange={(event) => set({ to: Number(event.currentTarget.value) })} />
        </span>
      }
    >
      <Label title={title} sub={sub} />
    </ListRow>
  )
}

function Label({ title, sub }: { readonly title: string; readonly sub: string }) {
  return (
    <span {...stylex.props(styles.label)}>
      <Text variant="ui" weight="medium">
        {title}
      </Text>
      <Text variant="meta" tone="muted">
        {sub}
      </Text>
    </span>
  )
}

function LevelRow({ title, sub, tags, onRemove, divider }: { readonly title: string; readonly sub: string; readonly tags: ReadonlyArray<NotifyTag>; readonly onRemove: (tag: NotifyTag) => void; readonly divider: boolean }) {
  return (
    <ListRow
      aria-label={title}
      divider={divider}
      trailing={
        <span {...stylex.props(styles.tags)}>
          {tags.map((tag) => (
            <Tag key={`${tag.kind}:${tag.id}`} tag={tag} onRemove={() => onRemove(tag)} />
          ))}
        </span>
      }
    >
      <Label title={title} sub={sub} />
    </ListRow>
  )
}

function Tag({ tag, onRemove }: { readonly tag: NotifyTag; readonly onRemove: () => void }) {
  const removeLabel = `Remove ${tag.name}`
  if (tag.kind === 'channel') {
    return (
      <Chip variant="filled" size={28} icon={channelIcons[tag.channelKind]} onRemove={onRemove} removeLabel={removeLabel}>
        {tag.name}
      </Chip>
    )
  }
  const avatar: ReactNode = <Avatar size={18} label={initials(tag.name)} name={tag.name} hue={hueFor('', tag.id)} {...(tag.avatarUrl === undefined ? {} : { src: tag.avatarUrl })} />
  return (
    <Chip variant="filled" size={28} onRemove={onRemove} removeLabel={removeLabel}>
      <span {...stylex.props(styles.person)}>
        {avatar}
        {tag.name}
      </span>
    </Chip>
  )
}

function count(n: number) {
  return (
    <Text variant="body" tone="inherit" weight="semibold" numeric as="span">
      {n}
    </Text>
  )
}

function Today({ interrupted, held, rows, initiallyOpen }: { readonly interrupted: number; readonly held: number; readonly rows: ReadonlyArray<TodayRow>; readonly initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const showWhy = (
    <Button variant="ghost" size="sm" tone="subtle" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      Show why
    </Button>
  )
  return (
    <div {...stylex.props(styles.todayLine)}>
      <Text variant="body" tone="subtle">
        {interrupted === 0 ? (
          <>Nothing has interrupted you today.{held > 0 ? <> Juno held {count(held)}.</> : null}</>
        ) : (
          <>
            {count(interrupted)}
            {interrupted === 1 ? ' message interrupted you.' : ' messages interrupted you.'} Juno held {count(held)}.
          </>
        )}
      </Text>
      {rows.length === 0 ? null : (
        <Popover open={open} onClose={() => setOpen(false)} anchor={showWhy} placement="top-start" width="picker" maxHeight="picker" padding="sm" label="Messages that interrupted you">
          <div role="list" aria-label="Messages that interrupted you" {...stylex.props(styles.log)}>
            {rows.map((row) => (
              <div key={row.id} role="listitem" {...stylex.props(styles.logRow)}>
                <span {...stylex.props(styles.logLine)}>
                  <Text variant="meta" tone="muted" numeric>
                    {clockLabel(row.at)}
                  </Text>
                  <Text variant="meta" tone="subtle" truncate>
                    {row.place}
                  </Text>
                </span>
                <Text variant="ui" clamp={2}>
                  {row.sender === '' ? null : (
                    <Text variant="ui" weight="semibold" as="span">{`${row.sender} `}</Text>
                  )}
                  {row.text}
                </Text>
                <Text variant="meta" tone="muted">
                  {row.reason}
                </Text>
              </div>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}

/** The label column of a row: 260px (inventory 13). */
const LABEL_WIDTH = 260
/** What matters to you: at most 620px wide. */
const MATTERS_WIDTH = 620

const styles = stylex.create({
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    width: LABEL_WIDTH,
    maxWidth: '100%',
    minWidth: 0,
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2'],
    flexShrink: 0,
  },
  note: {
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colors['--border-subtle'],
    paddingBlockStart: spacing['--space-2-5'],
    paddingBlockEnd: spacing['--space-3'],
    paddingInline: spacing['--space-3-5'],
  },
  matters: {
    display: 'flex',
    flexDirection: 'column',
    maxWidth: MATTERS_WIDTH,
  },
  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  person: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
  },
  todayLine: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
  },
  log: {
    display: 'flex',
    flexDirection: 'column',
  },
  logRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-1-5'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
  },
  logLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing['--space-2'],
    minWidth: 0,
  },
})
