# New chat, and the window controls

Two designs from the 10-14 simplification pass. SPEC §9 (New chat), §4 to §6 and §18 (window and tabs) decide behaviour; inventory §8, §1 and §4 have the sizes. `mock.html` holds both; `node ../../../scripts/heavy.mjs node render.mjs` writes the PNGs.

| File | What |
| --- | --- |
| `new-chat-light.png`, `new-chat-dark.png` | The New chat states: write first, thread first, destination set, sent, and a person never messaged |
| `window-light.png`, `window-dark.png` | The window with Back, Forward and Hide sidebar, pinned tabs, unread dots and the tab menu; then the sidebar hidden |

## New chat

The owner: "a new chat icon, which opens like a new blank chat, but with destination selector on top of composer, and as i change the destination there ... the conversation above populates."

- **One flow, three ways in.** The title bar icon, the tab strip's "+" and ⌘N (also ⌘T, the browser habit) all open a New chat in a new tab. A new tab is a new chat, so "+" no longer opens search or All topics; ⌘K stays the way to find things.
- **Write first.** The composer has focus when the tab opens. The pickers sit above it and can be set before, during or after writing. Enter with no destination opens the conversation picker; the draft never goes anywhere by accident.
- **Two pickers, as the owner described.** Conversation (channel, person or group DM), then thread with Main as the default. The thread picker works alone and fills in the conversation when you pick a thread from it. Both are searchable lists with ↑ ↓, Enter and Esc.
- **The picker is the context pill.** Once a conversation is chosen, its button takes the pill's tint, icon and name ("eng", amber for private, blue for DMs; no kind text, as the header pill since SPEC §7). The wrong-place defence is the same as in a topic, in the place your eye already is, and the send checks still run.
- **Preview, not a visit.** The destination's latest messages fill the space above, read-only, and nothing is marked read, like peek. Changing your mind costs nothing. It becomes a visit only when you send: the tab turns into the topic and opens it as usual.
- **People you have never messaged** are in the conversation list with "No messages yet". The DM opens with `conversations.open` on send. This closes SPEC §19's "Starting a new DM".
- **The tab's title** is "New chat" until a destination is picked, then the destination's name, keeping the New chat icon until you send. Back from the sent topic goes to what the tab showed before.

Left out on purpose: starting a group DM from several people, sending to several places, and a "From" or schedule control. Each can be asked of Juno.

## Window controls

The owner asked for back and forward, a resizable and collapsible sidebar, browser tab shortcuts, a tab menu with pin and close variants, and a dot on tabs with unread.

- **Back and Forward** sit after the traffic lights, per tab like a browser. An entry is a topic or page opened in that tab; scroll is restored, not recorded. ⌘[ and ⌘], the mouse's side buttons and a three-finger swipe (Electron's `swipe` event; the two-finger swipe is not exposed to apps) do the same. Holding a button lists the history.
- **Hide sidebar** is ⌃⌘S, the macOS standard (Mail, Notes, Reminders and SwiftUI's sidebar command), rather than Finder's ⌥⌘S or editors' ⌘\. Hidden, the traffic lights and the three buttons move to the start of the tab strip.
- **Resize** by dragging the edge, 280 to 480px, double-click to reset. During a drag only the sidebar's width changes, once per frame, and the width is saved on release, so the list never re-renders per pixel.
- **Pinned tabs** are the calmest browser form: 40px, icon only, first in the strip, no close button. Close others, to the right and all leave them.
- **Unread dot**: one 6px soft grey dot after the title, the same grey as unread counts. Not on the active tab (opening marks read), not coloured for mentions: the sidebar already carries the "@".
- **Shortcuts**: ⌘T, ⌘W, ⌘⇧T (a stack of 20 closed tabs), ⌘1 to ⌘8 and ⌘9, ⌃Tab and ⌃⇧Tab, ⌘⇧] and ⌘⇧[. None clashes with ⌘K, ⌘J, ⌘N, ⌘, or ⌘Z.

## Review notes (better-interface lens)

- One new control per need, each in a place macOS users already look. No new setting: width, hidden state and pins are remembered, not configured.
- No layout shift: the picker row is replaced by the topic header in the frame the message is sent; the composer does not move. The unread dot has a fixed slot after the title.
- The open picker in the mock shows the keyboard focus ring (`--focus-ring`); with the pointer it shows no ring.
