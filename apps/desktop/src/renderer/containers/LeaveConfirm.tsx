/**
 * Leave channel… on a private channel asks once, in the pill Delete… uses
 * (SPEC 5): "Leave #eng? You'll need an invite to come back." with Cancel and
 * Leave, where the channel's menu opened. Enter leaves; Esc, Cancel or a
 * press outside keeps the channel.
 */
import { useEffect, useRef } from 'react'
import { flushSidebar, leaveChannel, leaveConfirmAtom, registry, type LeaveConfirm } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { DeleteConfirmAt } from '@juno/views'

/** Where the pointer last pressed: a native menu opens there, so the question shows where the menu was. */
let point = { x: 0, y: 0 }

/** Where the last menu opened, as near as the renderer knows. */
export const lastMenuPoint = (): { readonly x: number; readonly y: number } => point

/** Mounted with the window: follows the pointer's presses, and draws the question while one waits. */
export function LeaveConfirmHost() {
  const asking = useAtomValue(leaveConfirmAtom)
  useEffect(() => {
    const press = (event: MouseEvent) => {
      point = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('mousedown', press, true)
    window.addEventListener('contextmenu', press, true)
    return () => {
      window.removeEventListener('mousedown', press, true)
      window.removeEventListener('contextmenu', press, true)
    }
  }, [])
  return asking === undefined ? null : <Question key={asking.channel.id} asking={asking} />
}

const close = () => registry.set(leaveConfirmAtom, undefined)

function Question({ asking }: { readonly asking: LeaveConfirm }) {
  const box = useRef<HTMLDivElement>(null)
  const leave = () => {
    close()
    flushSidebar(registry)
    void leaveChannel(registry, asking.channel)
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      else if (event.key === 'Enter') leave()
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    const press = (event: MouseEvent) => {
      if (!(event.target instanceof Node && box.current?.contains(event.target))) close()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('mousedown', press, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('mousedown', press, true)
    }
  })
  return (
    <DeleteConfirmAt
      at={asking.at}
      boxRef={box}
      question={`Leave ${asking.channel.label}? You’ll need an invite to come back.`}
      confirmLabel="Leave"
      onConfirm={leave}
      onCancel={close}
    />
  )
}
