import { useMemo } from 'react'
import { customEmojiLookup, workspaceEmoji } from '@juno/contract'
import { composerEmojiAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'

const EMPTY: ReadonlyArray<never> = []

/** The shared workspace query; closed pickers do not start a subscription. */
export function useWorkspaceEmoji(open = true) {
  const answer = useAtomValue(composerEmojiAtom(open))
  const rows = answer._tag === 'Success' ? answer.value : EMPTY
  return useMemo(() => {
    const lookup = customEmojiLookup(rows)
    return {
      custom: workspaceEmoji(rows).map((emoji) => ({ ...emoji, url: imageUrl(emoji.url) })),
      url: (name: string) => {
        const url = lookup(name)
        return url === undefined ? undefined : imageUrl(url)
      },
    }
  }, [rows])
}

// Wrap after the port: escaping every URL would enlarge the workspace snapshot.
const imageUrl = (url: string) => url.startsWith('juno:') || url.startsWith('data:') ? url : `juno://files/emoji?url=${encodeURIComponent(url)}`
