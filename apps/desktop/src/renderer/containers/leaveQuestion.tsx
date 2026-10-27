/**
 * Leave channel…'s question (`LeaveConfirm.tsx`), in its own chunk: Enter
 * leaves; Esc, Cancel or a press outside keeps the channel.
 */
import { useEffect, useRef } from 'react'
import { flushSidebar, leaveChannel, leaveConfirmAtom, registry, type LeaveConfirm } from '@juno/state'
import { DeleteConfirmAt } from '@juno/views'

const close = () => registry.set(leaveConfirmAtom, undefined)

export function LeaveQuestion({ asking }: { readonly asking: LeaveConfirm }) {
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
