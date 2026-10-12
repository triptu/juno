import { AtSign, Hash, User, X } from 'lucide-react'
import { Button } from './Button'
import { Chip } from './Chip'
import { defineFixtures, scene } from './fixtures/define'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { ListRow } from './ListRow'
import { Segmented } from './Segmented'
import { Surface } from './Surface'
import { Text } from './Text'

const decisions = [
  { value: 'now', label: 'Now' },
  { value: 'digest', label: 'Digest' },
  { value: 'silent', label: 'Silent' },
]

export default defineFixtures(
  ListRow,
  {
    'rules-group': scene(() => (
      <Surface kind="group">
        <ListRow
          leading={<Icon icon={Hash} size={15} />}
          trailing={
            <>
              <Text role="meta" tone="muted" numeric>
                1 today
              </Text>
              <Segmented options={decisions} value="now" onChange={() => {}} label="Decision for #incidents" />
              <IconButton icon={X} label="Remove rule" size={26} iconSize={13} tone="muted" />
            </>
          }
        >
          <Text role="body">
            In <b>#incidents</b>
          </Text>
        </ListRow>
        <ListRow
          leading={<Icon icon={User} size={15} />}
          trailing={
            <>
              <Text role="meta" tone="muted" numeric>
                2 today
              </Text>
              <Segmented options={decisions} value="digest" onChange={() => {}} label="Decision for Maya Chen" />
              <IconButton icon={X} label="Remove rule" size={26} iconSize={13} tone="muted" />
            </>
          }
        >
          <Text role="body">
            From <b>Maya Chen</b>
          </Text>
        </ListRow>
        <ListRow
          leading={<Icon icon={AtSign} size={15} />}
          divider={false}
          trailing={
            <>
              <Segmented options={decisions} value="silent" onChange={() => {}} label="Decision for mentions in hiring" />
              <IconButton icon={X} label="Remove rule" size={26} iconSize={13} tone="muted" />
            </>
          }
        >
          <Text role="body">
            Mentions of me in <b>hiring</b>
          </Text>
        </ListRow>
      </Surface>
    )),
    'ignored-channel': scene(() => (
      <Surface kind="group">
        <ListRow
          leading={<Icon icon={Hash} size={15} />}
          divider={false}
          trailing={
            <Button size="sm" variant="secondary">
              Stop ignoring
            </Button>
          }
        >
          <Text role="body" weight="medium">
            deploys
          </Text>
          <Text role="meta" tone="muted" numeric>
            3 messages hidden
          </Text>
        </ListRow>
      </Surface>
    )),
    'table-row': scene(() => (
      <div>
        <ListRow minHeight={52} padding="table" onSelect={() => {}}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flexGrow: 1 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Text role="body" weight="semibold" truncate>
                #alerts-prod
              </Text>
              <Chip variant="outline">Main</Chip>
            </span>
            <Text role="meta" tone="muted" truncate>
              Grafana: [RESOLVED] queue depth &gt; 5k on billing-consumer
            </Text>
          </div>
          <Chip variant="filled" size={22}>
            Open
          </Chip>
          <Text role="ui" tone="muted" numeric>
            3m
          </Text>
        </ListRow>
        <ListRow minHeight={52} padding="table" onSelect={() => {}} selected>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flexGrow: 1 }}>
            <Text role="body" weight="medium" truncate>
              Postgres 16 migration plan
            </Text>
            <Text role="meta" tone="muted" truncate>
              Dev: Booked 2–4pm. Will post results here.
            </Text>
          </div>
          <Chip variant="success" size={22}>
            Resolved
          </Chip>
          <Text role="ui" tone="muted" numeric>
            4m
          </Text>
        </ListRow>
      </div>
    )),
  },
  { width: 720 },
)
