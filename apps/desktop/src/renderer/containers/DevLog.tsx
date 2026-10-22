/**
 * The developer log tab (⌘K, "Open developer log"): wires `devLogListAtom`
 * and the open entry to `DevLogPage`. The list subscription runs only while
 * this tab is open. Pause holds the rows shown; the engine keeps recording.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { DEV_LOG_CAPACITY, type DevLogFilter, type DevLogRow } from '@juno/contract'
import { copyText, DEV_LOG_PAGE, devLogDetailAtom, devLogFilterAtom, devLogLimitAtom, devLogListAtom, registry } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { DevLogPage, type DevLogKindFilter } from '@juno/views'

/** Typing settles this long before the filter goes to the engine. */
const TEXT_SETTLE_MS = 150
const COPIED_MS = 2000

const kindOf = (filter: DevLogFilter): DevLogKindFilter => (filter.errorsOnly ? 'errors' : filter.kinds[0] ?? 'all')

const filterOf = (kind: DevLogKindFilter, text: string): DevLogFilter =>
  kind === 'errors' ? { kinds: [], errorsOnly: true, text } : { kinds: kind === 'all' ? [] : [kind], errorsOnly: false, text }

export function DevLogTab() {
  const list = useAtomValue(devLogListAtom)
  const filter = useAtomValue(devLogFilterAtom)
  const limit = useAtomValue(devLogLimitAtom)
  const [text, setText] = useState(filter.text)
  const [paused, setPaused] = useState<ReadonlyArray<DevLogRow> | undefined>(undefined)
  const [expanded, setExpanded] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState<string | undefined>(undefined)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (text === filter.text) return
    const timer = setTimeout(() => registry.set(devLogFilterAtom, { ...registry.get(devLogFilterAtom), text }), TEXT_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [text, filter.text])
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const live = useMemo(() => list.order.flatMap((id) => list.rows.get(id) ?? []), [list])
  const rows = paused ?? live
  const total = list.meta.seq === 0 ? undefined : list.meta.total ?? live.length
  const detail = useAtomValue(devLogDetailAtom(expanded))

  return (
    <DevLogPage
      rows={rows}
      total={total}
      kind={kindOf(filter)}
      onKind={(kind) => registry.set(devLogFilterAtom, filterOf(kind, filter.text))}
      text={text}
      onText={setText}
      paused={paused !== undefined}
      onPause={(pause) => setPaused(pause ? live : undefined)}
      expanded={expanded}
      onToggle={(id) => setExpanded((open) => (open === id ? undefined : id))}
      detail={detail}
      copied={copied}
      onCopy={(value) => {
        void copyText(value).then((done) => {
          if (!done) return
          setCopied('Copied')
          clearTimeout(copiedTimer.current)
          copiedTimer.current = setTimeout(() => setCopied(undefined), COPIED_MS)
        })
      }}
      onShowMore={paused === undefined && total !== undefined && total > rows.length && limit < DEV_LOG_CAPACITY
        ? () => registry.set(devLogLimitAtom, Math.min(DEV_LOG_CAPACITY, limit + DEV_LOG_PAGE))
        : undefined}
    />
  )
}
