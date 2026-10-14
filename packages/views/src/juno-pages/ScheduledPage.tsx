import * as stylex from '@stylexjs/stylex'
import { type ScheduledPage as ScheduledPageModel, type ScheduleId, type ScheduleRow } from '@juno/agent-contract'
import { Button, Chip, EmptyState, ListRow, Page, PageHeader, Surface, Text } from '@juno/ui'
import { cell } from './cell'
import { fullTime, messageTime } from '../time'

export interface ScheduledPageProps {
  readonly page: ScheduledPageModel
  readonly now: number
  readonly onPause: (id: ScheduleId) => void
  readonly onResume: (id: ScheduleId) => void
  readonly onEdit: (id: ScheduleId) => void
  readonly onDelete: (id: ScheduleId) => void
}

const deliverLabel = { now: 'Now', digest: 'Digest', silent: 'Silent' } as const

/** The schedules Juno runs (SPEC 13.6): what, when, the next run, how each delivers, with Pause, Edit and Delete. */
export function ScheduledPage({ page, now, onPause, onResume, onEdit, onDelete }: ScheduledPageProps) {
  return (
    <Page>
      <PageHeader title="Scheduled" subtitle="What Juno does on its own, and when. Juno creates these only from a conversation with you." />
      {page.schedules.length === 0 ? (
        <EmptyState illustration="nothing-here" title="Nothing scheduled" body='Ask for something on a schedule, like "catch me up on #eng every weekday at 9", and it shows up here.' enter={false} />
      ) : (
        <Surface kind="group" role="list" aria-label="Schedules">
          {page.schedules.map((row, index) => (
            <Row key={row.id} row={row} now={now} last={index === page.schedules.length - 1} onPause={onPause} onResume={onResume} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </Surface>
      )}
    </Page>
  )
}

function Row({ row, now, last, onPause, onResume, onEdit, onDelete }: { readonly row: ScheduleRow; readonly now: number; readonly last: boolean } & Pick<ScheduledPageProps, 'onPause' | 'onResume' | 'onEdit' | 'onDelete'>) {
  const paused = row.state === 'paused'
  return (
    <ListRow
      role="listitem"
      data-schedule={row.state}
      divider={!last}
      trailing={
        <span {...stylex.props(cell.controls)}>
          <Chip variant={paused ? 'outline' : 'filled'} size={20}>
            {paused ? 'Paused' : deliverLabel[row.deliver]}
          </Chip>
          <Button variant="ghost" size="xs" tone="subtle" onClick={() => (paused ? onResume(row.id) : onPause(row.id))}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="ghost" size="xs" tone="subtle" onClick={() => onEdit(row.id)}>
            Edit
          </Button>
          <Button variant="ghost" size="xs" tone="subtle" onClick={() => onDelete(row.id)}>
            Delete
          </Button>
        </span>
      }
    >
      <span {...stylex.props(cell.lines)}>
        <Text variant="body" weight="medium" truncate dir="auto">
          {row.what}
        </Text>
        <Text variant="meta" tone="muted" truncate>
          {row.when}
          {row.nextAt !== undefined ? (
            <>
              {' · '}
              <time title={fullTime(row.nextAt)}>Next {messageTime(row.nextAt, now)}</time>
            </>
          ) : null}
        </Text>
        {row.selfPaused ? (
          <Text variant="meta" tone="muted" sx={cell.wrap}>
            Paused itself after 30 days without a change.
          </Text>
        ) : null}
      </span>
    </ListRow>
  )
}
