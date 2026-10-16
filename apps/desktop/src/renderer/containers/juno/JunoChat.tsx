import { useEmojiSuggestions } from '../emojiSuggestions'
import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { chatCopy, type ChatPage, type Quote, type SendContext } from '@juno/agent-contract'
import { nowAtom } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { JunoChatFrame, JunoChatList, JunoComposer, NewMessagesPill } from '@juno/views'
import { useChatActions, useChatSend, useFocusRequest, useReactionPicker, useRemoval } from './chatActions'
import { useBubbleMeasure, useChatPosition, useChatTarget, useEdges, useReadMarks, useScrollRelease, useStickToBottom } from './chatScroll'
import { useAgentState, useChatItems, useChatWindow } from './chatWindow'

/** Times change at most at a day boundary; re-render for it this often. */
const TIME_STEP = 10 * 60_000

export interface JunoChatProps {
  /** `page` in the Juno tab, `panel` beside a topic. */
  readonly column: 'page' | 'panel'
  readonly header: (banner: ChatPage['banner']) => ReactNode
  /** What the next message is about, read at send time (the panel's topic, an About chip). */
  readonly contextOf?: () => SendContext | undefined
  /** Above the composer field: the panel's selection quote, About chip and Catch me up. */
  readonly composerContext?: ReactNode
  /** A message went out, with the context it carried. */
  readonly onSent?: (context: SendContext | undefined) => void
  /** Esc in the empty composer. */
  readonly onEscape?: () => void
  /** For the panel's Catch me up: sends `text` as if typed. */
  readonly sendRef?: RefObject<((text: string) => void) | null>
}

/**
 * The one Juno chat (SPEC 13.1), as the Juno tab and the panel show it.
 *
 * - The window is the agent's page: the tab opens at the "New" divider when
 *   Juno has said something unread, the panel at the bottom. The divider
 *   stays where it was when the chat showed. Near either
 *   edge it moves by `OVERLAP` rows; rows stay in flow, so scroll anchoring
 *   keeps the rows in view still. A window that reaches the newest row
 *   follows it (`latest`).
 * - At the bottom, a new row is scrolled into view before paint; scrolled
 *   up, the "New message" pill shows.
 * - A Juno bubble fully on screen for a second in the focused window is read.
 *   A hidden tab sits in `<Activity>` with its effects gone, so it reads
 *   nothing and takes no focus until shown.
 * - Sends show at once (`chatItemsAtom` holds them as `sending`).
 */
export function JunoChat({ column, header, contextOf, composerContext, onSent, onEscape, sendRef }: JunoChatProps) {
  const agent = useAgentState()
  const { page, pageRef, current, loaded, setWindow } = useChatWindow(column, agent)
  const now = useAtomValue(nowAtom, (time) => Math.floor(time / TIME_STEP) * TIME_STEP)
  const scrollRef = useRef<HTMLElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const topEdgeRef = useRef<HTMLDivElement>(null)
  const bottomEdgeRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // The hooks run their effects in this order; keep it.
  const items = useChatItems(page, current)
  const { pinnedRef, positioned, atBottom, setAtBottom, unseen } = useChatPosition(column, loaded, items, scrollRef, anchorRef)
  const { sentAtRef, newestBubbleId } = useBubbleMeasure(items)
  useStickToBottom(scrollRef, pinnedRef, positioned, items, page.moreBelow)
  useScrollRelease(scrollRef, pinnedRef, pageRef, setAtBottom)
  useEdges({ scrollRef, topEdgeRef, bottomEdgeRef }, positioned, page, items, setWindow)
  useReadMarks(scrollRef, positioned, items)
  // The composer: the draft, and the bubble or card a reply quotes.
  const [draft, setDraft] = useState('')
  const emojiSuggestions = useEmojiSuggestions({ text: draft, onChange: setDraft, field: inputRef })
  const [quote, setQuote] = useState<Quote | undefined>(undefined)
  useFocusRequest(column, inputRef)
  const { toBottom, send } = useChatSend({ contextOf, onSent, sendRef, quote, setQuote, sentAtRef, newestBubbleId, scrollRef, pinnedRef, pageRef, setAtBottom, setWindow })
  const { setRemoval, sheet } = useRemoval(now)
  const { setPicker, pickerAt } = useReactionPicker(items)
  useChatTarget(column, positioned, items, scrollRef, pinnedRef, setWindow)
  const actions = useChatActions({ items, scrollRef, pinnedRef, inputRef, setQuote, setPicker, setRemoval })

  return (
    <>
    {sheet}
    <JunoChatFrame
      column={column}
      header={header(page.banner)}
      pill={positioned && !atBottom && (unseen || page.moreBelow) ? <NewMessagesPill count={0} label={chatCopy.list.newMessage} onJump={toBottom} /> : undefined}
      composer={
        <JunoComposer
          column={column}
          value={draft}
          onChange={emojiSuggestions.onChange}
          onCaret={emojiSuggestions.onCaret}
          onFieldKey={emojiSuggestions.onFieldKey}
          {...(emojiSuggestions.mention === undefined ? {} : { mention: emojiSuggestions.mention })}
          onSend={() => {
            const text = draft.trim()
            if (text === '') return
            setDraft('')
            send(text)
          }}
          {...(onEscape === undefined ? {} : { onEscape })}
          {...(quote === undefined ? {} : { quote, onClearQuote: () => setQuote(undefined) })}
          enabled={page.composerEnabled}
          {...(column === 'panel' ? { placeholder: chatCopy.composer.panelPlaceholder } : {})}
          inputRef={inputRef}
          context={composerContext}
        />
      }
      {...(pickerAt === undefined ? {} : { picker: pickerAt })}
    >
      <JunoChatList
        column={column}
        items={items}
        banner={page.banner}
        moreAbove={page.moreAbove}
        moreBelow={page.moreBelow}
        now={now}
        actions={actions}
        onSuggest={(text) => send(text)}
        scrollRef={scrollRef}
        anchorRef={anchorRef}
        topEdgeRef={topEdgeRef}
        bottomEdgeRef={bottomEdgeRef}
        enterEmpty={loaded && agent !== 'off'}
      />
    </JunoChatFrame>
    </>
  )
}
