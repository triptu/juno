import { useLayoutEffect, useRef, useState } from 'react'
import { Text } from '@juno/ui'

/** Measures the rendered font and available width so both ends of the path survive. */
export function BackupPath({ path }: { readonly path: string }) {
  const holder = useRef<HTMLSpanElement>(null)
  const [label, setLabel] = useState(path)
  useLayoutEffect(() => {
    const node = holder.current
    const context = document.createElement('canvas').getContext('2d')
    if (node === null || context === null) return
    let active = true
    const measure = () => {
      if (!active) return
      const text = node.firstElementChild
      if (text === null) return
      const style = getComputedStyle(text)
      context.font = style.font
      context.letterSpacing = style.letterSpacing
      const width = node.getBoundingClientRect().width
      const fits = (value: string) => context.measureText(value).width <= width
      if (fits(path)) {
        setLabel(path)
        return
      }
      const chars = Array.from(path)
      const middle = (count: number) => `${chars.slice(0, Math.ceil(count / 2)).join('')}…${chars.slice(chars.length - Math.floor(count / 2)).join('')}`
      let low = 0
      let high = chars.length
      while (low < high) {
        const count = Math.ceil((low + high) / 2)
        if (fits(middle(count))) low = count
        else high = count - 1
      }
      setLabel(middle(low))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    measure()
    void document.fonts.ready.then(measure)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [path])
  return (
    <span ref={holder}>
      <Text variant="body" truncate title={path} aria-label={path} data-backup-folder="">
        {label}
      </Text>
    </span>
  )
}
