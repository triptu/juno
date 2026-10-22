import { useEffect, useState } from 'react'
import { mark, measure } from '@juno/state/perf'
import type { warmEmojiSearch, isEmojiSearchWarm } from '@juno/contract'

interface SearchIndex {
  readonly warmEmojiSearch: typeof warmEmojiSearch
  readonly isEmojiSearchWarm: typeof isEmojiSearchWarm
}

/** Keep cold name searches usable while the full index waits for a paint and idle time. */
export function useEmojiSearchReady(rows: Parameters<typeof warmEmojiSearch>[0], index: SearchIndex | undefined): boolean {
  const [prepared, setPrepared] = useState<typeof rows | undefined>(undefined)
  const ready = prepared === rows || index?.isEmojiSearchWarm(rows) === true
  useEffect(() => {
    if (ready || index === undefined) return
    let idle: number | undefined
    const frame = requestAnimationFrame(() => {
      idle = requestIdleCallback(() => {
        const started = mark('juno.emoji-search-index')
        index.warmEmojiSearch(rows)
        measure('juno.emoji-search-index', started, { replace: true })
        setPrepared(rows)
      }, { timeout: 100 })
    })
    return () => {
      cancelAnimationFrame(frame)
      if (idle !== undefined) cancelIdleCallback(idle)
    }
  }, [rows, index, ready])
  return ready
}
