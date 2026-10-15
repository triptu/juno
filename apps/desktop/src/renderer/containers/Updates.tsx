import { useEffect, useState } from 'react'
import { Schema } from 'effect'
import { UpdateState } from '@juno/contract'
import { UpdateSettings } from '@juno/views'

const decode = Schema.decodeUnknownSync(UpdateState)

export function Updates() {
  const [state, setState] = useState<UpdateState>({ kind: 'unavailable' })
  useEffect(() => {
    let active = true
    const accept = (value: unknown) => { if (active) setState(decode(value)) }
    const unsubscribe = window.juno.updates.onChange(accept)
    void window.juno.updates.get().then(accept).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [])
  return <UpdateSettings
    available={state.kind !== 'unavailable'}
    enabled={state.kind === 'idle' || state.kind === 'ready'}
    version={state.kind === 'ready' ? state.version : null}
    onChange={(enabled) => { void window.juno.updates.set(enabled).then((value) => setState(decode(value))).catch(() => {}) }}
    onRestart={() => { void window.juno.updates.restart().catch(() => {}) }}
  />
}
