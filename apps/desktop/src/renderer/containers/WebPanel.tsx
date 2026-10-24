import { useLayoutEffect, useRef } from 'react'
import type { WebPanelBounds } from '@juno/contract'
import { closeWebPanel, openExternal, paletteOpenAtom, registry, webPanelStateAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { WebPanel as WebPanelView } from '@juno/views'
import { focusTopicComposer } from './juno/topicContext'

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function boundsOf(box: HTMLElement): WebPanelBounds {
  const { x, y, width, height } = box.getBoundingClientRect()
  return { x, y, width, height }
}

function close(): void {
  closeWebPanel(registry)
  focusTopicComposer()
}

/**
 * The web panel in the active tab (SPEC 7). Main draws the page over the
 * view's empty box, so the box's place goes to main on every change of
 * size. The page hides while the tab is put away (this unmounts) and while
 * the palette is open, since a native view draws over the app's HTML.
 */
export function WebPanel({ url }: { readonly url: string }) {
  const state = useAtomValue(webPanelStateAtom)
  const paletteOpen = useAtomValue(paletteOpenAtom)
  const page = useRef<HTMLDivElement>(null)
  // The page as it is now, so coming back to the tab shows where it was, not the link it opened with.
  // Before the first page commits, main reports an empty url.
  const current = state?.url ? state.url : url
  const currentRef = useRef(current)
  useLayoutEffect(() => {
    currentRef.current = current
  })

  useLayoutEffect(() => {
    const box = page.current
    if (box === null || paletteOpen) return
    void window.juno.webPanel.show(currentRef.current, boundsOf(box)).catch(() => {})
    let frame: number | undefined
    const move = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        void window.juno.webPanel.setBounds(boundsOf(box)).catch(() => {})
      })
    }
    const observer = new ResizeObserver(move)
    observer.observe(box)
    window.addEventListener('resize', move)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', move)
      if (frame !== undefined) cancelAnimationFrame(frame)
      void window.juno.webPanel.hide().catch(() => {})
    }
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- A new initial URL must recreate the native panel even though the current URL is read through its ref.
  }, [url, paletteOpen])

  return (
    <WebPanelView
      title={state?.title ?? ''}
      host={hostOf(current)}
      favicon={state?.favicon ?? null}
      loading={state?.loading ?? true}
      onOpenInBrowser={() => openExternal(current)}
      onClose={close}
      pageRef={page}
    />
  )
}
