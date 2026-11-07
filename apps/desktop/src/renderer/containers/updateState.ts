import { useEffect, useState } from 'react'
import { Schema } from 'effect'
import { UpdateState } from '@juno/contract'

const decode = Schema.decodeUnknownSync(UpdateState)

/** Calls `accept` with main's update state now and on each change (`Events.updatesChanged`); returns the unsubscribe. */
function watchUpdates(accept: (state: UpdateState) => void): () => void {
  let active = true
  const take = (value: unknown) => { if (active) accept(decode(value)) }
  const unsubscribe = window.juno.updates.onChange(take)
  void window.juno.updates.get().then(take).catch(() => {})
  return () => { active = false; unsubscribe() }
}

/** Main's update state, live: Settings › About's update line. */
export function useUpdateState(): [UpdateState, (state: UpdateState) => void] {
  const [state, setState] = useState<UpdateState>({ kind: 'unavailable' })
  useEffect(() => watchUpdates(setState), [])
  return [state, setState]
}

/**
 * Whether a downloaded update installs on restart: the sidebar's Update
 * ready pill. A boolean, so a download's progress or a check re-renders nothing.
 */
export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => watchUpdates((state) => setReady(state.kind === 'ready')), [])
  return ready
}

/** Restart to update, as Settings › About's button runs it; main asks first while a huddle runs. */
export function restartToUpdate(): void {
  void window.juno.updates.restart().catch(() => {})
}
