import { useEffect, useState } from 'react'

/** How long a page step Slack could not answer, or that changed nothing, waits before the view asks again. */
const RETRY_MS = 5000

/**
 * The guard on a page step at the window's edge (`useOlderPages`, `useNewerPages`): a step Slack could not
 * answer (offline, rate limited) or one served from the store twice for the same row with the edge still
 * unknown is not asked again for `RETRY_MS`, so the view neither loops on Slack nor stops for good.
 * `stalled` is the row waiting; `settle` is stable.
 * Out of the React Compiler, as the hooks that use it are.
 */
export function useStepStall() {
  'use no memo'
  const [stalled, setStalled] = useState<string | undefined>(undefined)
  const [guard] = useState(() => {
    let asked: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    return {
      /** After a step for `row`: `answered` when Slack or the store answered, `fetched` when it asked Slack. */
      settle: (row: string, answered: boolean, fetched: boolean) => {
        const repeated = !fetched && asked === row
        asked = row
        if (answered && !repeated) return
        setStalled(row)
        clearTimeout(timer)
        timer = setTimeout(() => {
          asked = undefined
          setStalled(undefined)
        }, RETRY_MS)
      },
      dispose: () => clearTimeout(timer),
    }
  })
  useEffect(() => guard.dispose, [guard])
  return { stalled, settle: guard.settle }
}
