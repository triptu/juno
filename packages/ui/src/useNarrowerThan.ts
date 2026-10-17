import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Whether the element is narrower than `px`: read before the first paint,
 * then on each resize. For a narrow layout that changes what is rendered
 * (an accessible name, a tooltip), which a container query cannot do.
 */
export function useNarrowerThan(ref: RefObject<HTMLElement | null>, px: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const measure = () => setNarrow(node.offsetWidth < px)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref, px])
  return narrow
}
