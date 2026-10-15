/**
 * The check bar for a draft the checks on send found something in. Loaded
 * on its own (`lazy` in `TopicComposer.tsx`) because it only shows after
 * Enter; the chunk is fetched once a composer has mounted, before the first
 * Enter can need it.
 */
import { SendCheckBar } from '@juno/views'
import { findingOf, type CheckBar } from './sendChecks'

export interface SendCheckPanelProps {
  readonly bar: CheckBar
  readonly onPick: (choice: 'primary' | 'secondary') => void
}

export default function SendCheckPanel({ bar, onPick }: SendCheckPanelProps) {
  return <SendCheckBar {...findingOf(bar)} onPrimary={() => onPick('primary')} onSecondary={() => onPick('secondary')} />
}
