import * as stylex from '@stylexjs/stylex'
import { At } from '@phosphor-icons/react/dist/icons/At'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { User } from '@phosphor-icons/react/dist/icons/User'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { useState } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button } from './Button'
import { Chip } from './Chip'
import { defineFixtures, scene } from './fixtures/define'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import type { ActivateEvent } from './internal/activate'
import { ListRow } from './ListRow'
import { Segmented } from './Segmented'
import { Surface } from './Surface'
import { Text } from './Text'

const decisions = [
  { value: 'now', label: 'Now' },
  { value: 'digest', label: 'Digest' },
  { value: 'silent', label: 'Silent' },
]

function TableRows() {
  return (
    <div>
      <ListRow minHeight={52} padding="table" onSelect={() => {}}>
        <div {...stylex.props(styles.cell)}>
          <span {...stylex.props(styles.titleLine)}>
            <Text variant="body" weight="semibold" truncate>
              #alerts-prod
            </Text>
            <Chip variant="outline">Main</Chip>
          </span>
          <Text variant="meta" tone="muted" truncate>
            Grafana: [RESOLVED] queue depth &gt; 5k on billing-consumer
          </Text>
        </div>
        <Chip variant="filled" size={22}>
          Open
        </Chip>
        <Text variant="ui" tone="muted" numeric>
          3m
        </Text>
      </ListRow>
      <ListRow minHeight={52} padding="table" onSelect={() => {}} selected>
        <div {...stylex.props(styles.cell)}>
          <Text variant="body" weight="medium" truncate>
            Postgres 16 migration plan
          </Text>
          <Text variant="meta" tone="muted" truncate>
            Dev: Booked 2–4pm. Will post results here.
          </Text>
        </div>
        <Chip variant="success" size={22}>
          Resolved
        </Chip>
        <Text variant="ui" tone="muted" numeric>
          4m
        </Text>
      </ListRow>
    </div>
  )
}

/**
 * A row with a nested button, logging every activation. The gallery's
 * behaviour spec drives it to check mouse-down activation.
 */
function Activation() {
  const [log, setLog] = useState<ReadonlyArray<string>>([])
  const record = (what: string) => (event: ActivateEvent) => setLog((prev) => [...prev, `${what}:${event.source}${event.metaKey ? ':meta' : ''}`])
  return (
    <div {...stylex.props(styles.cell)}>
      <ListRow
        minHeight={52}
        padding="table"
        onSelect={record('row')}
        onContextMenu={(event) => {
          event.preventDefault()
          setLog((prev) => [...prev, 'row:contextmenu'])
        }}
        trailing={
          <Button size="xs" variant="outline" onClick={() => setLog((prev) => [...prev, 'resolve:click'])}>
            Resolve
          </Button>
        }
      >
        <Text variant="body" weight="medium" truncate>
          Postgres 16 migration plan
        </Text>
      </ListRow>
      <Text variant="meta" tone="muted" numeric as="p" data-activation-log>
        {/* A non-breaking space keeps the line, so the first log entry moves nothing. */}
        {log.length > 0 ? log.join(' ') : '\u00a0'}
      </Text>
    </div>
  )
}

export default defineFixtures(
  ListRow,
  {
    'Settings rows': {
      'rules-group': scene(() => (
        <Surface kind="group">
          <ListRow
            leading={<Icon icon={Hash} size={16} />}
            trailing={
              <>
                <Text variant="meta" tone="muted" numeric>
                  1 today
                </Text>
                <Segmented options={decisions} value="now" onChange={() => {}} label="Decision for #incidents" />
                <IconButton icon={X} label="Remove rule" size={26} iconSize={13} tone="muted" />
              </>
            }
          >
            <Text variant="body">
              In <b>#incidents</b>
            </Text>
          </ListRow>
          <ListRow
            leading={<Icon icon={User} size={16} />}
            trailing={
              <>
                <Text variant="meta" tone="muted" numeric>
                  2 today
                </Text>
                <Segmented options={decisions} value="digest" onChange={() => {}} label="Decision for Maya Chen" />
                <IconButton icon={X} label="Remove rule" size={26} iconSize={13} tone="muted" />
              </>
            }
          >
            <Text variant="body">
              From <b>Maya Chen</b>
            </Text>
          </ListRow>
          <ListRow
            leading={<Icon icon={At} size={16} />}
            divider={false}
            trailing={
              <>
                <Segmented options={decisions} value="silent" onChange={() => {}} label="Decision for mentions in hiring" />
                <IconButton icon={X} label="Remove rule" size={26} iconSize={13} tone="muted" />
              </>
            }
          >
            <Text variant="body">
              Mentions of me in <b>hiring</b>
            </Text>
          </ListRow>
        </Surface>
      )),
      'ignored-channel': scene(() => (
        <Surface kind="group">
          <ListRow
            leading={<Icon icon={Hash} size={16} />}
            divider={false}
            trailing={
              <Button size="sm" variant="secondary">
                Stop ignoring
              </Button>
            }
          >
            <Text variant="body" weight="medium">
              deploys
            </Text>
            <Text variant="meta" tone="muted" numeric>
              3 messages hidden
            </Text>
          </ListRow>
        </Surface>
      )),
    },
    Table: {
      'table-row': scene(() => <TableRows />),
      'table-row-hover': scene(() => <TableRows />, { hover: '[role="button"]:nth-of-type(1)' }),
    },
    Activation: {
      activation: scene(() => <Activation />),
    },
  },
  { width: 720 },
)

const styles = stylex.create({
  cell: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    minWidth: 0,
    flexGrow: 1,
  },
  titleLine: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
  },
})
