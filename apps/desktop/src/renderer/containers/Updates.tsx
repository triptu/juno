import { useEffect, useState, type ReactNode } from 'react'
import { Schema } from 'effect'
import { ReleaseNotes, UpdateState } from '@juno/contract'
import { copyText } from '@juno/state'
import { UpdateSettings, type UpdateStatus, type WhatsNew } from '@juno/views'

const decode = Schema.decodeUnknownSync(UpdateState)
const decodeNotes = Schema.decodeUnknownSync(ReleaseNotes)

function statusOf(state: UpdateState): UpdateStatus | null {
  switch (state.kind) {
    case 'checking':
      return { kind: 'checking' }
    case 'current':
      return { kind: 'current' }
    case 'failed':
      return { kind: 'failed' }
    case 'ready':
      return { kind: 'restart', version: state.version }
    case 'available':
      return { kind: 'download', version: state.version, download: state.download, ...(state.progress === undefined ? {} : { progress: state.progress }) }
    default:
      return null
  }
}

export function Updates({ build }: { readonly build: ReactNode }) {
  const [state, setState] = useState<UpdateState>({ kind: 'unavailable' })
  const [whatsNew, setWhatsNew] = useState<WhatsNew>(null)
  useEffect(() => {
    let active = true
    const accept = (value: unknown) => { if (active) setState(decode(value)) }
    const unsubscribe = window.juno.updates.onChange(accept)
    void window.juno.updates.get().then(accept).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [])
  const status = statusOf(state)
  const offered = status?.kind === 'restart' || status?.kind === 'download'
  // The update's notes belong to the offered version; close them when it goes.
  const shown = whatsNew?.for === 'update' && !offered ? null : whatsNew
  const toggle = (scope: 'installed' | 'update') => {
    if (shown?.for === scope) return setWhatsNew(null)
    setWhatsNew({ for: scope, notes: 'loading' })
    void window.juno.updates.notes(scope)
      .then((value) => {
        const result = decodeNotes(value)
        setWhatsNew((current) => current?.for === scope ? { for: scope, notes: result.kind === 'notes' ? { installedVersion: result.installedVersion, availableVersions: result.availableVersions, entries: result.entries } : 'failed' } : current)
      })
      .catch(() => setWhatsNew((current) => current?.for === scope ? { for: scope, notes: 'failed' } : current))
  }
  return <UpdateSettings
    build={build}
    available={state.kind !== 'unavailable'}
    enabled={state.kind !== 'unavailable' && state.enabled}
    status={status}
    whatsNew={shown}
    onChange={(enabled) => { void window.juno.updates.set(enabled).then((value) => setState(decode(value))).catch(() => {}) }}
    // `checking` and then the result arrive through onChange; the answer may be older than them.
    onCheck={() => { void window.juno.updates.check().catch(() => {}) }}
    onRestart={() => { void window.juno.updates.restart().catch(() => {}) }}
    // The download's progress arrives through onChange; the answer may be older than it.
    onDownload={() => { void window.juno.updates.download().catch(() => {}) }}
    onCopyDetails={() => { if (state.kind === 'failed') copyText(state.details) }}
    onWhatsNew={toggle}
  />
}
