# Break pass B, 10-17

Done on 2026-10-17 in the `break-pass-1017b` worktree, cut from `origin/main`
at `2c4d4584`. Against the fake Slack through the e2e driver, on one remote
Linux machine. No live Slack. The aim was what landed on 10-16 and 10-17,
used fast and from the keyboard: the unified Home, the keys held after ⌘N
and ⌘T, the lazy parts, duotone, the restored caret and the sidebar drag.

The tests are in `apps/desktop/e2e/break-pass-1017b.spec.ts`. Each one
failed on `origin/main` before its fix, except the waiting-send test, whose
first run failed on a wrong fake call in the test itself (see 5).

## Fixed, by how much a user would notice

1. **"@j" and Enter, typed at speed, sent to the wrong person.** Home's
   first @ shows the rows of the last answered query while the next one
   loads (`useHeld`). Enter picked the first of those rows: typing "@",
   then "j" and Enter made Maya the destination, not Jonas. The destination
   list's search already waited for its rows (`usePendingEnter`); the Send
   to list did not. Tab or Enter while the rows for the typed text are on
   their way now waits and picks the first of them, and keys typed after it
   are held and go into the field once the field shows the pick.
   Test: "a first @ and a name typed fast with Enter picks the person
   typed, not a row from before".

2. **Typing after a restored Home draft went in before it.** The topic
   composer's fix (`0e79f505`) was in `TopicComposer` only. Home's field,
   shown again after Back, a relaunch or a tab switch that remounts it, had
   the caret at the start: "A long thought" plus " and more" gave
   " and moreA long thought". The caret-at-end now lives in the `Textarea`
   primitive, so Home, the Juno composers, the edit field and the topic
   composer all have it; the topic's own copy is gone.
   Test: "a Home draft shown again takes typing at its end".

3. **In a short window the destination list ran off the top.** At 720 by
   480 the list (search plus a 360px list) is taller than the room above
   the chip, and `Popover` positions an upward panel with no vertical
   limit, so the search was clipped out of view while still focused.
   `Popover` now caps a panel that opens upward at the room above its
   anchor; the list's rows scroll and the search stays.
   Test: "in the smallest window the destination list from ⌘N fits above
   the chip, its search in view".

4. **Holding Backspace to clear the text dropped the destination.** Key
   repeat carried on past the last character and the next repeat counted as
   "Backspace in an empty field", so Maya went back to Juno. The next
   message then went to Juno. A repeat no longer does this; a new press
   still does.
   Test: "holding Backspace to clear the text keeps the destination; a new
   Backspace in the empty field goes back to Juno".

5. **Text typed while a Home send waited was wiped.** Home kept the draft
   until `messages.send` answered, which for a person never messaged waits
   for `conversations.open`. Typing meanwhile appended to the shown draft,
   and the success then emptied the field. The field now empties at once,
   as a topic's does; if nothing is queued the draft and destination come
   back unless something new was written. The first remote run of this test
   failed on a wrong `holdNext` call in the test, not on the bug; the fixed
   test runs in `pnpm affected` with the fix.
   Test: "text typed while a Home send waits for Slack stays in the field".

6. **A paste right after ⌘T or ⌘N was lost.** ⌘V passes the key hold (it
   has ⌘), and the paste went to the field the old tab had focused or,
   once that was blurred, nowhere. A paste during a hold is now held with a
   copy of its data and given to the focused field in its place among the
   keys (the field's own paste handling first, so files still attach).
   Test: "text pasted right after ⌘T goes into the new Home, in order with
   the keys typed around it".

## Found, not fixed

- **A sidebar drag that loses its pointer capture keeps going.** If the
  window loses focus mid-drag (⌘Tab) and the button comes up elsewhere,
  `SidebarEdge` never sees `pointerup`; the next pointer move over the 6px
  edge resizes the sidebar with no button down. Low impact. Fix: end the
  drag on `lostpointercapture`, or when a move has `buttons === 0`.
- **Downward popovers are not capped.** The All topics place picker opens
  below its button and can run past the bottom of a 480px window. The cap
  in 3 is for upward panels only, to keep the change small; applying it
  downward too wants a look at menus opened near a pane's bottom edge.
- **The suggestion list's chunk, before the idle preload.** In a topic,
  `useMentions` only takes Enter for the list while its chunk has loaded.
  If the engine answers "@ma" before the chunk loads, Enter sends "@ma" as
  text. The window is a few milliseconds after the first trigger of a
  session; not reproduced.
- **IME right after ⌘T.** The hold passes composition keys through, so a
  composition started before Home's field has focus goes to no field. Not
  testable on the Linux runners; check on the Mac with a Japanese input
  source.

## Taste calls

1. **Esc from ⌘N's list puts focus on the chip, and typing then goes
   nowhere.** This matches SPEC 12 ("Esc closes and puts focus back on the
   chip"), but someone who pressed ⌘N, changed their mind and starts typing
   a question for Juno loses those keys. Recommend: printable keys typed on
   the chip go into the field.
2. **Files attached with Juno chosen.** Paste and drop attach files while
   Juno is the destination; a send to Juno takes the text only and the
   files stay on the tab, unmentioned. Recommend: with Juno chosen, a paste
   or drop of files says Juno takes text only, or picking a person keeps
   them as now but the chip shows a hint.
3. **⌘N while the destination list is open empties its search.** Harmless,
   but a second ⌘N reads as "start again" rather than "keep going".
   Recommend leaving it.

## Held up

- ⌘N from a topic, typing "maya", Enter, "Hi": all in order (the earlier
  tests in `new-message-typing.spec.ts` cover it).
- Duotone: only `duotone.ts` names the weight, `check-duotone.mjs` guards
  the rest, and the build's list is read from the same file. Read, not
  swept for blank SVGs at runtime.
- The lazy edit field, peek, link editor and sync cards draw only once
  loaded (`usePreloaded`) and are preloaded on idle and on first want; no
  lost key found by reading. Not timed against a cold chunk.
