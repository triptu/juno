# Home merged with New chat, round 2

Round 1 (`../README.md`) had three looks. The owner chose a direction:

- One composer, at the bottom, where every topic's composer is. Nothing on the page moves when a message is sent.
- Juno is the destination until you pick another.
- With no destination picked, `@` or `#` as the first character lets you pick one from the composer.
- Recent people and channels are visible and generous. Density is fine if the layout is disciplined.

This round explores five layouts, then refines the two strongest. All of them are gallery fixtures built from the real `Home` rows, `HomeScene`, `Composer`, `OptionList`, `Avatar`, `ChannelIcon` and the picker pill, with tokens throughout:

- Code: `packages/views/src/HomeWrite.tsx` (the composer, the destination chip and the "Send to" list), `HomeWriteParts.tsx` (shared rows and lists), `HomeWriteCentre.tsx` (D1, D3, D4) and `HomeWriteBottom.tsx` (D2, D5).
- Gallery: `HomeWrite1` to `HomeWrite5`, and `HomeWriteRefined1` and `HomeWriteRefined2`.
- Screenshots: `GALLERY_SHOTS_ONLY=HomeWrite1,…,HomeWriteRefined2 pnpm gallery:shots`. They show a 1056 by 720 workspace (a 1440px window less the sidebar), and 560 wide for `narrow`.

## The composer rule, used by every direction

The hard case: a question for Juno can start with `@` or `#` ("#eng what happened today?", "@Maya's PR").

**Chosen: suggest, never take over, with the destination in a chip on the field's leading edge.**

- With Juno chosen and the field empty, a first `@` or `#` opens a "Send to a person" or "Send to a channel" list above the field. The first match is highlighted. The text stays in the field as typed.
- **Tab** or **Enter** picks the highlighted row. The typed `@ma` leaves the text and becomes the chip ("Maya Chen", in the DM tint), and the field is empty and ready.
- **Space** or **Esc** closes the list and keeps the text. A `#eng` that stays becomes an ordinary channel mention in the question (`juno-hash` state).
- The list's footer shows both keys: "Tab: Send to #eng" and "Space: Keep as text". The rule is taught where it applies, not in a help page.
- Once a destination is chosen, `@` and `#` anywhere are ordinary mentions, as in every topic.
- **Backspace in an empty field** sets the destination back to Juno. **Esc** with an empty field and no list does nothing, so nothing changes by accident.
- The chip is a button. A click or ⌘N opens the full conversation list with search (today's New chat picker), for anyone not in the suggestions.

Why this, by the better-interface rules:

- **Always know where it goes** (SPEC principle 4, better-colors "one colour, one meaning"). The chip carries the context tint, the same as the topic header's pill, and the placeholder names the destination ("Message Maya Chen"). The token option (D3) puts the destination inside the text as a chip that looks exactly like an @mention, so one look means two things. Backspace walks into it and silently changes where the message goes.
- **Never block the common case.** Most of what you type to Juno does not start with `@` or `#`, and when it does, Space is the next key you would press anyway. A list that took over (Enter always picks) would turn "#eng what happened" into a destination unless you noticed.
- **Visible keys.** A first-time user sees both outcomes in the footer before choosing one (better-writing: say what happens next).
- **One edge case:** `#eng` alone, then Enter, picks #eng rather than asking Juno about it. Esc, then Enter, sends it to Juno. This is rare and visible, and the result is a chip, not a sent message, so nothing goes out by mistake.

After a send to a person, the composer stays where it is, empty, and the destination returns to Juno. The page does not move. The row you sent to shows "✓ Sent" in place of its time (`sent` state), and the app's usual toast offers Open. The toast sits in the window's toast spot, outside these workspace-only shots.

A send to Juno opens the Juno chat in the tab, with Back to Home. The Juno tab's composer has the same bottom inset, but its field is 656px wide where a topic's is 752px (`--page-width` less 64 against `--composer-width`). To keep the field still, the Juno tab's field would take the topic width.

## Five directions

Contact sheets of all nine states, light and dark: `explore/<n>-<name>-{light,dark}.jpg`. The full-size shots are in `apps/gallery/shots/HomeWrite<n>/states/`, which is not committed.

| | Where recents live | How the destination shows | Caught up vs waiting |
| --- | --- | --- | --- |
| **1 · Address book** | Two columns in the page, People and Channels, six each with time | Chip on the field | The header and columns stay; Needs you comes and goes above the columns |
| **2 · Shelf** | One band of faces and channel art just above the field, Juno first | A face or Juno's mark at the field's start, and the chosen tile filled | Home as it is (scene, greeting, rows); the shelf never moves |
| **3 · Mosaic** | One grid of cards: Needs you first (with an accent ring), then people and channels with their last line | A token, the destination as the text's first word | The scene shows only when caught up |
| **4 · Inbox** | One list: Needs you rows with what they want, then "Write to" rows | A "To" line above the field, as in Mail | The list shortens; the greeting stays at the start |
| **5 · Dock** | A raised panel at the bottom holding People and Channels (three each) and the field | Chip on the field | Home as it is above the dock |

What each one taught:

- **1 · Address book.** The densest that still reads calmly. Every destination is named, with its time, and the columns start on the composer's edges, so the page has one set of edges. The cost is that the scene becomes a small figure beside the greeting.
- **2 · Shelf.** Keeps Home's calm and puts the choice right beside the field. You see faces, not names, and channel names cut short past about nine characters, so the tiles carry tooltips. It holds about ten destinations.
- **3 · Mosaic.** Rich, but busy. Cards and accent rings add lines where space would do (better-layout: group with space first). The token destination is the weak point above.
- **4 · Inbox.** One list is simple to scan, but two kinds of rows behave differently: a Needs you row opens its topic, a Write to row picks a destination. The accent-red "what it wants" labels compete with the send button and read as alerts.
- **5 · Dock.** Groups writing into one object, which looks good wide. At 560px the dock covers Home's rows (`narrow`), content hidden at a supported width. Three rows per column is not generous.

## Refined: 1 · Address book and 2 · Shelf

Shots of all nine states, light and dark: `refined/1-address-book/<state>-{light,dark}.png` and `refined/2-shelf/<state>-{light,dark}.png`.

The states are `items-waiting`, `caught-up`, `at-person`, `at-channel`, `juno-hash`, `writing`, `sent`, `first-run` and `narrow`.

**1 · Address book, refined**

- Each recent row has a 40px leading slot, as wide as a Needs you row's art, so names start on the same edge as the Needs you titles. Before, they were 8px off.
- The column labels carry their key on the trailing edge (`@` for People, `#` for Channels), so the shortcut is on screen where the list is.
- First run keeps the two columns, each with one line ("Type @ and a name to write to someone."), so the page has the same shape before and after you have history.
- The list footer says "Keep as text", not "Ask Juno". Space does not send; it only keeps the text.

**2 · Shelf, refined**

- Juno's tile is 36px, the same as every other tile. It was 44.
- The band is centred with `safe center`, so when it is wider than the field it starts at Juno and scrolls, rather than cutting Juno off.
- Tiles carry their full name as a tooltip, since names cut short.
- First run shows Juno with one line beside it: "Type @ or # to write to a person or a channel. The ones you use show here."

## Recommendation: 1 · Address book

- **It shows the most with the least.** Twelve named destinations with times, which round 1 could not fit (better-layout: order by importance, group with space). Needs you, People and Channels are three groups separated by space alone, with no cards or rules.
- **One set of edges.** The page column is the composer's width, the Needs you titles and the names share one start edge, and the chip sits on the field. The eye travels down one column to the field.
- **Calm across states.** Caught up, Needs you goes and the columns move up. Nothing else changes, and the composer never moves.
- **Names, not faces.** Every destination is named on screen; the Shelf needs tooltips for its channel names.
- **The Shelf's strength is proximity:** the choice sits beside the field. The Address book gets most of that from the chip and the @ and # suggestions, which open right above the field.

Choose the Shelf if Home should stay a resting page first and a place to write second.

## Keyboard (both refined directions)

| Key | Does |
| --- | --- |
| ⌘N | Focuses Home's composer and opens the full destination list with search. With a Home tab open it uses it; otherwise it opens one. |
| ⌘J | On Home, focuses the composer with Juno chosen. Elsewhere it opens the Juno chat, as today. |
| ⌘T, "+" | A new tab with Home, the composer focused, Juno chosen. |
| Tab | Needs you rows, then the recents (one stop: arrows move inside, ↑↓ within a column and ←→ between People and Channels in the Address book, ←→ along the Shelf), then the destination chip, then the field. Shift Tab from the field reaches the chip, as in New chat today. |
| @ or # first | Opens the "Send to" list; ↑↓ move, Tab or Enter picks, Space or Esc keeps the text. |
| Enter on a recent | Makes it the destination and moves focus to the field. ⌘Enter opens the conversation instead. |
| Backspace, field empty | Destination back to Juno. |
| Enter in the field | Sends to the destination. With Juno, opens the Juno chat in this tab with the question. |

## What this changes in the removal plan (`../README.md`)

The plan stands, with these changes. Home's composer replaces Ask Juno and New chat's composer. Frequent becomes People and Channels (the same ranking, split by kind). New chat's preview and its separate Frequent block go. ⌘N opens the destination list, not a new page.
