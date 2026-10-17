import { useEffect, useState } from 'react'
import { Schema } from 'effect'
import { ReleaseNotes, UpdateState } from '@juno/contract'
import { UpdateSettings, type UpdateOffer, type WhatsNew } from '@juno/views'

const decode = Schema.decodeUnknownSync(UpdateState)
const decodeNotes = Schema.decodeUnknownSync(ReleaseNotes)

function offerOf(state: UpdateState): UpdateOffer | null {
  if (state.kind === 'ready') return { kind: 'restart', version: state.version }
  if (state.kind === 'available') return { kind: 'download', version: state.version, download: state.download }
  return null
}

export function Updates() {
  const [state, setState] = useState<UpdateState>({ kind: 'unavailable' })
  const [whatsNew, setWhatsNew] = useState<WhatsNew>(null)
  useEffect(() => {
    let active = true
    const accept = (value: unknown) => { if (active) setState(decode(value)) }
    const unsubscribe = window.juno.updates.onChange(accept)
    void window.juno.updates.get().then(accept).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [])
  const offer = offerOf(state)
  // The update's notes belong to the offered version; close them when it goes.
  const shown = whatsNew?.for === 'update' && offer === null ? null : whatsNew
  const toggle = (scope: 'installed' | 'update') => {
    if (shown?.for === scope) return setWhatsNew(null)
    setWhatsNew({ for: scope, notes: 'loading' })
    void window.juno.updates.notes(scope)
      .then((value) => {
        const result = decodeNotes(value)
        setWhatsNew((current) => current?.for === scope ? { for: scope, notes: result.kind === 'notes' ? result.entries : 'failed' } : current)
      })
      .catch(() => setWhatsNew((current) => current?.for === scope ? { for: scope, notes: 'failed' } : current))
  }
  return <UpdateSettings
    available={state.kind !== 'unavailable'}
    enabled={state.kind === 'idle' || state.kind === 'ready' || state.kind === 'available'}
    offer={offer}
    whatsNew={shown}
    onChange={(enabled) => { void window.juno.updates.set(enabled).then((value) => setState(decode(value))).catch(() => {}) }}
    onRestart={() => { void window.juno.updates.restart().catch(() => {}) }}
    // The download's progress arrives through onChange; the answer may be older than it.
    onDownload={() => { void window.juno.updates.download().catch(() => {}) }}
    onWhatsNew={toggle}
  />
}
