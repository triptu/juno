import { useEffect, useRef, useState } from 'react'
import { Effect } from 'effect'
import type { Diagnostics as Reading } from '@juno/contract'
import { appInfoAtom, appStateAtom, copyDiagnostics, showLogs, describeTabs, diagnosticsReport, formatCpu, readDiagnostics, tabsAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { ProcessesView, type ProcessRow } from '@juno/views'
import { EngineStatus, useEngineLine } from './EngineStatus'

/** How often About reads the processes again while it shows. */
const REFRESH_MS = 3_000

const rowOf = (reading: Reading['processes'][number]): ProcessRow => ({
  name: reading.name,
  detail: `${reading.type}, pid ${reading.pid}`,
  cpu: formatCpu(reading.cpu),
  memory: `${reading.memoryMb} MB`,
})

/** Settings › About › Diagnostics: the engine line and Ping engine, each process's CPU and memory, and Copy diagnostics. */
export function Diagnostics() {
  const [reading, setReading] = useState<Reading | undefined>(undefined)
  const [copied, setCopied] = useState<string | undefined>(undefined)
  const app = useAtomValue(appInfoAtom)
  const { view } = useAtomValue(appStateAtom)
  const tabs = describeTabs(useAtomValue(tabsAtom))
  const { line } = useEngineLine()
  const cleared = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let active = true
    const read = () => void Effect.runPromise(readDiagnostics).then((value) => { if (active) setReading(value) }, () => {})
    read()
    const timer = setInterval(read, REFRESH_MS)
    return () => {
      active = false
      clearInterval(timer)
      clearTimeout(cleared.current)
    }
  }, [])

  const copy = () => {
    clearTimeout(cleared.current)
    void Effect.runPromise(readDiagnostics).then(async (fresh) => {
      setReading(fresh)
      // Main logs a failure there, with no content.
      const copied = await copyDiagnostics(diagnosticsReport({ app: app._tag === 'Success' ? app.value : undefined, diagnostics: fresh, engineLine: line, view, tabs, at: new Date() }))
      setCopied(copied ? 'Copied' : 'Could not copy')
    }).catch(() => setCopied('Could not copy')).finally(() => {
      cleared.current = setTimeout(() => setCopied(undefined), 2_000)
    })
  }

  return (
    <>
      <EngineStatus />
      <ProcessesView rows={reading?.processes.map(rowOf) ?? []} copied={copied} onCopy={copy} onShowLogs={() => { void showLogs().catch(() => setCopied('Could not open logs')) }} />
    </>
  )
}
