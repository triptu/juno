import type { DevLogDetail, DevLogRow } from '@juno/contract'
import { defineFixtures, fixture } from '@juno/ui'
import { DevLogPage, type DevLogPageProps } from './DevLogPage'

const at = Date.UTC(2026, 9, 21, 9, 30, 0)
const noop = () => {}

// Invented entries in the shapes the engine records.
const rows: ReadonlyArray<DevLogRow> = [
  { id: '9', rev: 0, at: at + 900, kind: 'slack', name: 'conversations.history', context: 'interactive · open-topic', durationMs: null, outcome: 'running', failed: false },
  { id: '8', rev: 1, at: at + 820, kind: 'socket', name: 'message', context: 'C0EXAMPLE1', durationMs: 3.2, outcome: 'ok', failed: false },
  { id: '7', rev: 1, at: at + 700, kind: 'slack', name: 'conversations.replies', context: 'background · follow-pass', durationMs: 184, outcome: 'ok', failed: false },
  { id: '6', rev: 1, at: at + 640, kind: 'slack', name: 'chat.getPermalink', context: 'interactive', durationMs: 92, outcome: 'channel_not_found', failed: true },
  { id: '5', rev: 1, at: at + 600, kind: 'sync', name: 'catch-up', context: '', durationMs: 1840, outcome: 'ok', failed: false },
  { id: '4', rev: 0, at: at + 400, kind: 'socket', name: 'connected', context: '', durationMs: null, outcome: 'ok', failed: false },
  { id: '3', rev: 1, at: at + 200, kind: 'slack', name: 'search.modules.messages', context: 'background · sweep', durationMs: 30_400, outcome: 'rate limited, retry after 30 s', failed: true },
  { id: '2', rev: 0, at: at + 100, kind: 'sync', name: 'phase live', context: '', durationMs: null, outcome: 'ok', failed: false },
  { id: '1', rev: 1, at, kind: 'slack', name: 'edge:users/info', context: 'background', durationMs: 61, outcome: 'ok', failed: false },
]

const detail: DevLogDetail = {
  row: rows[2]!,
  sections: [
    { title: 'Request', lines: [{ label: 'lane', value: 'background' }, { label: 'reason', value: 'follow-pass' }, { label: 'channel', value: 'C0EXAMPLE1' }, { label: 'ts', value: '1760000000.000100' }, { label: 'limit', value: '200' }] },
    { title: 'Timing', lines: [{ label: 'duration', value: '184 ms' }, { label: 'waiting', value: '41 ms' }, { label: 'attempts', value: '1' }, { label: 'response size', value: '6.2 KB' }] },
    { title: 'Response', lines: [{ label: 'has_more', value: 'false' }, { label: 'ok', value: 'true' }, { label: 'messages', value: '12 items' }, { label: 'response_metadata', value: '{ next_cursor }' }] },
  ],
}

const base: DevLogPageProps = {
  rows,
  total: rows.length,
  kind: 'all',
  onKind: noop,
  text: '',
  onText: noop,
  paused: false,
  onPause: noop,
  expanded: undefined,
  onToggle: noop,
  detail: undefined,
  onCopy: noop,
}

export default defineFixtures(DevLogPage, {
  List: {
    live: fixture(base),
    expanded: fixture({ ...base, expanded: '7', detail }),
    copied: fixture({ ...base, expanded: '7', detail, copied: 'Copied' }),
    paused: fixture({ ...base, paused: true }),
    'show-more': fixture({ ...base, total: 1840, onShowMore: noop }),
  },
  Filters: {
    errors: fixture({ ...base, kind: 'errors', rows: rows.filter((row) => row.failed), total: 2 }),
    'no-match': fixture({ ...base, text: 'reactions', rows: [], total: 0 }),
    empty: fixture({ ...base, rows: [], total: 0 }),
  },
})
