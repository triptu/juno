import { useEffect, useRef, useState } from 'react'

const MAX_ZOOM = 8
const DOUBLE_CLICK_ZOOM = 2.5

/**
 * Zoom for an image, inside its frame: a pinch (a wheel event with ctrlKey) zooms around the pointer from fit to 8x,
 * a double-click goes between fit and 2.5x at the click, and while zoomed a scroll or a drag pans. The picture's
 * edges never come inside the frame, and at fit it is centred again. The transform is written to `content` directly,
 * so a gesture renders nothing; `zoomed` changes only on leaving fit and coming back to it. The viewer keys each
 * item, so moving to another starts it at fit.
 */
export function useZoom(enabled: boolean) {
  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  // Kept in a ref, not the effect: a hidden tab runs the effect again and the picture stays as it was.
  const view = useRef({ scale: 1, x: 0, y: 0 })
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => {
    const box = frame.current
    const node = content.current
    if (!enabled || box === null || node === null) return
    const at = view.current
    let dragFrom: { readonly x: number; readonly y: number } | undefined

    const show = (nextScale: number, nextX: number, nextY: number) => {
      const { width, height } = box.getBoundingClientRect()
      if ((at.scale > 1) !== (nextScale > 1)) setZoomed(nextScale > 1)
      at.scale = nextScale
      at.x = Math.min(0, Math.max(width - width * nextScale, nextX))
      at.y = Math.min(0, Math.max(height - height * nextScale, nextY))
      node.style.transform = nextScale === 1 ? '' : `translate(${at.x}px, ${at.y}px) scale(${nextScale})`
    }
    // The point under the pointer stays where it is.
    const zoomAt = (to: number, clientX: number, clientY: number) => {
      const { left, top } = box.getBoundingClientRect()
      const next = Math.min(MAX_ZOOM, Math.max(1, to))
      const px = clientX - left
      const py = clientY - top
      show(next, px - ((px - at.x) * next) / at.scale, py - ((py - at.y) * next) / at.scale)
    }
    // Not passive, so a pinch does not zoom the page and a scroll while zoomed moves only the picture.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault()
        zoomAt(at.scale * Math.exp(-event.deltaY / 100), event.clientX, event.clientY)
      } else if (at.scale > 1) {
        event.preventDefault()
        show(at.scale, at.x - event.deltaX, at.y - event.deltaY)
      }
    }
    const onDoubleClick = (event: MouseEvent) => zoomAt(at.scale > 1 ? 1 : DOUBLE_CLICK_ZOOM, event.clientX, event.clientY)
    const onPointerDown = (event: PointerEvent) => {
      if (at.scale === 1 || event.button !== 0) return
      box.setPointerCapture(event.pointerId)
      dragFrom = { x: event.clientX, y: event.clientY }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (dragFrom === undefined) return
      show(at.scale, at.x + event.clientX - dragFrom.x, at.y + event.clientY - dragFrom.y)
      dragFrom = { x: event.clientX, y: event.clientY }
    }
    const onDragEnd = () => {
      dragFrom = undefined
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    box.addEventListener('dblclick', onDoubleClick)
    box.addEventListener('pointerdown', onPointerDown)
    box.addEventListener('pointermove', onPointerMove)
    box.addEventListener('lostpointercapture', onDragEnd)
    return () => {
      box.removeEventListener('wheel', onWheel)
      box.removeEventListener('dblclick', onDoubleClick)
      box.removeEventListener('pointerdown', onPointerDown)
      box.removeEventListener('pointermove', onPointerMove)
      box.removeEventListener('lostpointercapture', onDragEnd)
    }
  }, [enabled])

  return { frame, content, zoomed }
}
