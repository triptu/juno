import type { BodyBlock, BodyInline, BodyTableColumn } from '@juno/contract'
import { channel, emoji, link, mention, p, t, window } from './messages'
import { channels, people } from './topics'

type Cell = ReadonlyArray<BodyInline> | string

const table = (rows: ReadonlyArray<ReadonlyArray<Cell>>, columns?: ReadonlyArray<BodyTableColumn>): BodyBlock => ({
  kind: 'table',
  rows: rows.map((row) => row.map((cell) => (typeof cell === 'string' ? (cell === '' ? [] : [t(cell)]) : cell))),
  ...(columns === undefined ? {} : { columns }),
})

const code = (text: string): BodyInline => t(text, { code: true })

/** A status table as a release bot posts it: four columns, a header and five rows, with mentions, a link, code and an empty cell. */
export const statusTable = table([
  ['Service', 'Owner', 'Status', 'Notes'],
  ['API', [mention(people.maya)], [emoji('white_check_mark', '✅'), t(' Healthy')], [t('p95 at '), code('212 ms')]],
  ['Worker', [mention(people.leo)], [emoji('warning', '⚠️'), t(' Degraded')], [t('Queue backlog, see '), link('https://example.test/runbooks/queue', 'runbook')]],
  ['Search', [mention(people.priya)], [emoji('white_check_mark', '✅'), t(' Healthy')], ''],
  ['Billing', [mention(people.sam)], [emoji('hourglass', '⏳'), t(' Deploying')], [t('Rolling out '), code('v2.14.0')]],
  ['Web', [channel(channels.eng)], [emoji('white_check_mark', '✅'), t(' Healthy')], 'No open issues'],
])

/** Ten columns, wider than the message column: the box scrolls sideways. Numbers are right aligned. */
export const wideTable = table(
  [
    ['Region', 'Requests', 'Errors', 'Error rate', 'p50', 'p95', 'p99', 'CPU', 'Memory', 'Instances'],
    ['us-east-1', '1,284,113', '1,920', '0.15%', '38 ms', '212 ms', '480 ms', '61%', '7.2 GB', '24'],
    ['eu-west-1', '842,550', '611', '0.07%', '41 ms', '198 ms', '455 ms', '54%', '6.8 GB', '16'],
    ['ap-south-1', '310,902', '1,402', '0.45%', '57 ms', '301 ms', '722 ms', '73%', '5.1 GB', '8'],
  ],
  [{}, { align: 'right' }, { align: 'right' }, { align: 'right' }, { align: 'right' }, { align: 'right' }, { align: 'right' }, { align: 'right' }, { align: 'right' }, { align: 'center' }],
)

/** A table taller than ten rows: ten show, then Show all. The last column wraps. */
export const tallTable = table(
  [
    ['Ticket', 'Title', 'Summary'],
    ...Array.from({ length: 14 }, (_, index) => [
      code(`OPS-${410 + index}`),
      index % 3 === 0 ? 'Rotate the staging certificates' : index % 3 === 1 ? 'Raise the worker memory limit' : 'Pin the base image digest',
      index === 0 ? 'Certificates expire at the end of the month; the rotation script needs the new vault path before it can run.' : 'Done',
    ].map((cell) => (typeof cell === 'string' ? [t(cell)] : [cell]))),
  ],
  [{}, {}, { wrap: true }],
)

/** A short id column and a long description Slack wraps: at a narrow width the description wraps and the table fits. */
export const wrappedTable = table(
  [
    ['ID', 'Description'],
    [[code('OPS-410')], 'Certificates expire at the end of the month; the rotation script needs the new vault path before it can run on staging.'],
    [[code('OPS-411')], 'Raise the worker memory limit after the queue backlog on Tuesday.'],
  ],
  [{}, { wrap: true }],
)

/** A cell with a tab and two paragraphs, as Slack can send them: copying its row keeps it one cell. */
export const copyTable = table([
  ['Step', 'Notes'],
  ['Deploy', [t('Run\tmigrate'), { kind: 'break' }, t('then restart')]],
  ['Verify', 'Check the dashboards'],
])

/** Messages with tables, for the Message gallery's Table group. */
export const tableMessages = window([
  { ago: 30, from: people.grafana, blocks: [p('Service status for the 14:00 release:'), statusTable] },
  { ago: 20, from: people.dev, blocks: [p('Traffic by region over the last hour:'), wideTable] },
  { ago: 10, from: people.elena, blocks: [p('Open ops tickets:'), tallTable] },
  { ago: 5, from: people.grafana, blocks: [statusTable] },
  { ago: 4, from: people.elena, blocks: [p('Open tickets, with notes:'), wrappedTable] },
  { ago: 3, from: people.leo, blocks: [p('Release steps:'), copyTable] },
])
