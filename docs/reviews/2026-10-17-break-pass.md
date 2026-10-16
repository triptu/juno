# Break pass, 10-17

Done on 2026-10-16 in the `break-pass-1017` worktree, cut from `origin/main`
at `82dfb402`. Everything ran against the fake Slack and the fake OpenRouter
through the e2e driver, on Namespace Linux machines (`pnpm remote
test:desktop`). No live Slack.

The aim was to use the features that landed on 10-16 and 10-17 together, the
way a busy day does: several tabs on one topic, the Juno panel, New chat with
Frequent, Settings, emoji suggestions, a dropped connection and a relaunch.

The tests are in `apps/desktop/e2e/break-pass-1017.spec.ts` and
`apps/desktop/e2e/juno-agent/break-pass-1017.spec.ts`.

## Fixed

1. **An About chip followed you to another tab.** Ask Juno on Leo in tab A,
   then open the panel in tab B on another topic: the panel said "Juno sees
   About Leo" and the question went to Juno about Leo, not about B's topic.
   Closing the panel in B also dropped A's chip. The chip was one global
   atom. `junoAboutAtom` is now keyed by tab (the Juno tab has its own key),
   and closing a tab's panel clears only that tab's chip.
   Test: "an About chip from Ask Juno in one tab does not follow to the panel
   of another tab".

2. **The panel lost its draft.** The panel's composer kept its text in
   component state. Switching to a tab without the panel and back, or
   closing the panel with ⌘J, threw the half-written question away. Two
   tabs with the panel open shared one text. The draft is now
   `junoDraftAtom`, one per tab's panel and one per Juno tab.
   Test: "the panel draft is kept when the tab is switched away and back".

3. **A keyboard tab switch lost composer focus.** SPEC 6 says each tab keeps
   its composer focus. After ⌃Tab, ⌘⇧[ or ⌘1 to ⌘9 focus was nowhere, so
   the next keys went nowhere. The workspace now remembers the element that
   had focus in each tab and gives it back when a switch leaves focus
   nowhere. It runs after the pages' effects, so a composer on a topic open
   in two tabs still takes the other tab's newer draft first.
   Test: "each tab gets its composer focus back after a keyboard tab switch".

4. **Enter right after typing in a New chat picker picked nothing.** Each
   query starts a new live query, so for a moment the list has no rows.
   Typing "eng" and Enter at typing speed landed in that moment and was
   dropped; the draft stayed with no destination. An Enter while the rows
   load now waits and picks the first row when they land. Typing again
   drops the waiting Enter. Both pickers (conversation and thread).
   Test: "Enter right after typing in the conversation search picks the
   match".

5. **Esc in a picker's search dropped focus.** The option list's own Esc
   handler closed the popover before the key reached `Popover`, so Popover
   never saw that focus was inside and did not put it back on the button.
   Focus went to the page. This hit every popover whose content closes on
   Esc (New chat's two pickers among them). Popover now marks where focus
   was on the way down, for that key only.
   Test: "New chat works from the keyboard alone: write, pick with Enter,
   send".

## Open findings

Ranked by how much a daily user would feel them.

1. **`:thumbs` and Enter gives 👎.** With no recent use, matches in the
   prefix tier are in name order, so `thumbsdown` comes before `thumbsup`.
   SPEC 8 ranks by recent use, then prefix, then
   substring, which this follows; the ranking needs a common-emoji prior
   (👍 ✅ 👀 🙏 🎉 first) before recent use exists. Steps: a fresh profile,
   any composer, type `:thumbs`, Enter.

2. **A New chat tab forgets its draft and destination on relaunch.** The tab
   comes back as an empty "New chat". `newChatAtom` holds them only while
   the app runs (by design in `packages/state/src/newChat.ts`), but a topic
   draft survives a restart (SPEC 8), and an update restart loses what was
   being written. Needs the draft and destination stored with the tab.
   Test, marked as expected to fail: "a relaunch keeps a New chat tab with
   its destination and draft".

3. **Clicking a tab leaves focus on the tab, not in its page.** Fix 3 covers
   keyboard switches only. A mouse press on a tab focuses the tab element,
   so typing after a click goes nowhere until you click the composer.
   Safari and Chrome give the page its focus back. Doing that means the tab
   must not take focus on a mouse press (`keepFocus` in its activate
   handlers) while keeping keyboard focus in the strip. Steps: type in a
   topic, click another tab, click back, type.

4. **New chat's Tab order has Attach files between the composer and the
   thread picker.** SPEC 9 says Shift Tab from the composer reaches the
   thread picker; it now takes two. The attach button also comes in with a
   lazy chunk, so the order can change a moment after the tab opens. Either
   take Attach files out of the Tab order there or update SPEC 9.

5. **The inline edit field has no `:emoji:` suggestions.** SPEC 8 says every
   composer. The topic composer, New chat and the Juno composers have them;
   editing a message (E, or More › Edit) does not. Found by reading the
   code (`useEmojiSuggestions` is used only by `mentions.tsx` and
   `JunoChat.tsx`).

6. **The picker list may empty for a frame on each keystroke.** Each query
   is a new `pickConversationsAtom` member that starts with no result, and
   the view draws no rows until it lands (the cause of fix 4). Not measured;
   a feel scenario typing into the picker would show whether it flickers.

## Held up

These were tried and behaved as the spec says:

- Two tabs on one topic share the draft; a send from one clears it in both,
  posted once.
- Two tabs on one topic with the panel open in one: a send, a 👍 and an edit
  in one tab show in the other.
- Closing the last tab while its message waits for Slack: a New chat opens
  with its composer focused, the message is posted once, and ⌘⇧T brings
  the topic back with the message sent and an empty composer.
- ⌘T during the first sync focuses the untouched New chat, a second ⌘T opens
  another, and a draft written during the sync sends once after it.
- Settings from the avatar menu (⌘, on macOS), its Notifications item and
  Settings again: one Settings tab, focused, at the asked section.
- A Frequent pick and its draft survive switching to another tab and back,
  and send once.
- A relaunch with six tabs (two on one topic, Main, Home) restores the
  order, the active tab and each topic's draft.
- The topic switcher with 60 threads in a 600px high window fits the window
  and keeps the keyboard row fully in view after 40 ↓.
- A send while the network and socket are down shows at once and is posted
  once when they are back.
- A 720 by 480 window with ten tabs keeps the strip, "+", the pill and the
  composer on screen, with no horizontal scroll.
- The panel keeps its draft and focus across the cover breakpoint (1400,
  1100, 900 and 1600px wide).
- In the panel, Enter takes an emoji suggestion rather than sending, and Esc
  closes the list without closing the panel.
- Dark mode: no light surface in New chat with Frequent, its conversation
  list, the topic switcher, Settings or the panel with a reply in it.
- The emoji picker and the other surfaces over a title bar are `no-drag`
  (checked in code: the chat's reaction picker is in `Popover`, which sets
  it; `app.spec.ts` checks the rest).

## Verification

`pnpm affected` passed after the fixes: typecheck, lint, the unit tests, the
gallery and the whole desktop e2e on four remote shards. The New chat
relaunch test is marked `test.fail()` until finding 2 is fixed.

## Not covered

- Auto-review cards while Juno is paused, and pacing caps: they need the MCP
  fixture and the engine's clock, and there was no time left in this pass.
- Integration cards and Home filling during the first sync: their own suites
  cover them (`integration-messages.spec.ts`, `home.spec.ts`), and nothing
  here exercised them together with tabs.
- Anything that needs the Mac (`@mac`, feel, perf). The focus change should
  be checked by `pnpm test:feel -g tabs` on the Mac before merge.
