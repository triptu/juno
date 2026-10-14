# Notifications: a simplification pass

A proposal, not yet applied. It replaces SPEC 14's notification page and adds a presence schedule. `mock.html` shows the current page next to the proposal, and what moves off the page. `node ../../../scripts/heavy.mjs node render.mjs` writes the PNGs.

| File | What |
| --- | --- |
| `compare-light.png`, `compare-dark.png` | The current page (SPEC 14, inventory 13) beside the proposed page |
| `around-light.png`, `around-dark.png` | The sidebar menu, the avatar menu, the message "why" popover, and changing settings in the Juno chat |

## The problem

The owner: "the notifications preferences might have become overcomplicated as a setting, the page looks so busy".

The current page asks a busy manager to run a small rules engine:

- **Ordered rules, first match wins.** Order is an engineer's idea. If Maya posts in #design-review, the owner has to know which row comes first to predict the result. There is no way to reorder rows anyway.
- **Three outcomes on every row.** Now, Digest and Silent, as a segmented control repeated five times. Digest and Silent look the same to the owner in the moment (no buzz); they differ only later.
- **A rule builder with three selects.** Type, value, action. It is a form for writing a rule, when the owner already knows the channel they want to change and is usually looking at it.
- **Hit counts on every rule.** "1 today" five times is noise. It answers a question nobody asked.
- **A threshold slider.** "80% sure it's urgent" is the wrong mental model. Nobody knows what 75% feels like, and the score is not calibrated the same way from month to month as the model changes.
- **Three timing concepts.** Digest times, quiet hours and (now) a presence schedule are three ways of saying "when I am working".
- **A five-column Today log.** Time, place, message, outcome chip, reason, for every message of the day. It is the busiest thing on the page, and the owner needs it only when one specific message surprised them.
- **Keyword rules.** "Contains lunch" is the kind of judgement a model does better than a substring.

Every row on the page is a control, and the page needs a scroll before the log starts. In the proposal, most of the page is read rather than operated, and it fits in one screen.

## The simplified model

One schedule, one paragraph of plain words, two short lists, and Juno's judgement for everything else.

1. **Working hours.** Days and a from and to time (default weekdays, 9am to 7pm). Outside them:
   - Slack shows you as away.
   - Your Mac does not notify, and (once verified, see open items) neither does Slack on your phone.
   - When your hours start, one notification sums up anything that would have notified you overnight, if there was any.
2. **Inside working hours, Juno decides** each message: notify now, or hold. Held means no notification; the message is in the sidebar as always. There is no threshold. The decision model's cutoff is calibrated by us and checked by the gate eval, not set by the owner.
3. **What matters to you.** A short text the owner writes ("The launch and hiring. Anything from my reports that needs a decision today."). Juno's gate reads it with every message. It replaces keyword rules and most person and channel rules. The owner can edit it on the page or tell Juno in chat.
4. **People and channels** have three levels, set from their context menu:
   - **Every message** notifies, even outside working hours. This is the safety valve (#incidents, your manager).
   - **When it matters** is the default. Juno decides. It is not listed on the page.
   - **Never** notifies, but the messages stay in Juno. Ignore (in Preferences) still exists for hiding a channel entirely.
   - There is no order. If a person and a channel disagree, **Every message wins**, so nothing important is silently lost.
5. **Away by hand.** The avatar menu has "Set yourself away" or "Set yourself active". Away by hand means the same as outside working hours (away and paused). It lasts until the next switch in the schedule.
6. **Why, on demand.** A message's context menu has "Why did this notify?" or "Why no notification?". A small popover gives the reason in words. If the reason is a setting, it offers Change; if it was Juno's call, Tell Juno opens the chat quoting the message. The page keeps only a one-line Today ("4 messages interrupted you. Juno held 23.") with Show why, which lists the ones that interrupted you and their reasons.
7. **AI assist off.** Juno's judgement is off, so inside working hours you are notified for DMs and mentions, as in Slack. Every message and Never still apply. The "What matters" field shows "AI assist is off. You're notified about DMs and mentions." in place of its text.

What Juno decides: whether a message needs you now, given what matters to you, who wrote it, where, and whether it asks you something. What the owner decides: working hours, the words, and Every message or Never for a few places and people.

### Presence and the honest limits

- Slack has `presence.set` for the self user (`docs/research/slack-data-access.md`, Presence). `away` is a manual away that holds on every client until set back; `auto` lets Slack decide from activity. There is no `getPresence`; Juno learns its own state from `manual_presence_change` events on the socket.
- At the start of working hours Juno sets `auto`; at the end, `away`. "Active" always means `auto`, so an idle owner still shows as away.
- Juno can switch presence only while it runs. On launch and on wake from sleep, it applies what the schedule says for now. If the Mac sleeps through the end of the day, Slack's own idle away covers it. If Juno is closed when the hours start, the owner stays away until it opens. The page says this in one line.
- A manual change in the official Slack client is respected until the next switch in the schedule, the same as a manual change in Juno.

## The page

`compare-*.png`, right column. Page max-width 880, padding `40 40 56`, gap 36, as today.

1. Title "Notifications". Sub: "During your working hours, Juno lets through what needs you and holds the rest. Everything is in Juno whenever you open it."
2. **Working hours.** One group card. Row: seven day toggles (28px round, on is `--secondary-default`), then the from and to selects. Below a hairline, a muted note: "Outside these hours, Slack shows you as away and your notifications pause, here and on your phone. When your hours start, one notification sums up anything that needed you." and, at 12px: "Juno switches your status while it's open. If it's closed when your hours start, you show as away until you open it."
3. **What matters to you.** Sub: "Juno reads this for every message. You can also just tell Juno." A plain text field, max-width 620, at least three lines, saved on blur.
4. **People and channels.** One group card, two rows: "Every message" (sub "Even outside working hours") and "Never" (sub "Still in Juno, no alerts"). Each row holds removable tags (channel icon or avatar, name, `x`). Hint below: "Right-click a channel or person to change how it notifies you." With both lists empty, the card is one muted row: "Every channel and person is set to When it matters."
5. **Today.** One line: "4 messages interrupted you. Juno held 23." and a ghost button Show why. Show why expands the interrupted messages only (time, place, sender and text, and the reason under them in 12px muted). Held messages are not listed; the per-message menu answers for them.

No segmented controls, no slider, no builder, no counts per rule, no digest chips.

## What moves elsewhere

| Thing | Where it goes | Why |
| --- | --- | --- |
| Per-channel and per-DM setting | "Notify me" submenu in the sidebar row, tab, header More and channel menus (inventory 15.1, 15.2): Every message, When it matters, Never | You decide while looking at the channel, not on a form |
| Per-person setting | The same submenu on a person (DM row, name or avatar in a message) | Same reason |
| Manual away | Avatar menu: "Set yourself away" or "Set yourself active", header shows "Away until 9am" | It's a status, and the avatar menu is where status lives |
| The why for one message | Message context menu, "Why did this notify?" or "Why no notification?" | The question comes up about one message, so the answer sits on it |
| Anything else | Say it to Juno: "stop pinging me about #design-review", "I'm off Friday", "Sam can always reach me" | The model already understands this; a form would only constrain it |
| Extra digests | A Juno schedule: "summarise what you held at 1pm on weekdays" (SPEC 13.6) | Digests at fixed times are a schedule, and schedules already exist |

Changing notification settings from the chat is a Local action (SPEC 13.9): no click, a quiet "Notifications changed · Undo" line under Juno's reply. It is taken only from the owner's own words in a clean conversation, like a new schedule, so a Slack message Juno read cannot silence #incidents.

## What's cut

| Cut | Reason |
| --- | --- |
| Rule order and "first match wins" | No order needed: Every message wins over Never, and there are only two levels to compare |
| Now, Digest, Silent on every rule | The owner picks Every message or Never; the default is Juno |
| The rule builder (three selects and Add) | Rules are set from the menu on the thing itself, or in words |
| Hit counts per rule | Noise; the why popover answers the real question |
| Keyword rules | "What matters to you" covers them, with judgement instead of substrings |
| "Mentions of me in" rules | Juno already weighs mentions; Every message covers a channel where every mention matters |
| "Let Juno decide" checkbox | Juno deciding is the product. AI assist off has a fixed fallback (DMs and mentions) |
| Threshold slider | A percentage is the wrong model and the score shifts as models change; the cutoff is ours to calibrate |
| Digest times | Folded into one start-of-hours summary; more digests are a Juno schedule |
| Quiet hours | Folded into working hours, inverted |
| Today so far chips | Replaced by one sentence |
| Five-column Today log | Replaced by Show why (interrupted messages only) and the per-message why |
| "Next digest 3pm" hint in the avatar menu | No digest times; the hint becomes "Paused until 9am" outside working hours, and nothing inside |

## Changes this implies, to apply once the owner picks

### SPEC.md

- **Section 2 or 3:** the Slack table's "Not in Slack" row: "notification rules" becomes "notification settings". Add a row: "Presence (active, away) | Set by your working hours and the avatar menu, written to Slack with `presence.set`."
- **Section 5, item 1:** the avatar menu holds "away or active, status, Notifications, Preferences, ...".
- **Section 13.6:** "Delivery" unchanged in spirit; schedules deliver as "Notify" or "Don't notify" (no Digest).
- **Section 13.9 table, Local row:** add "notification settings and working hours from your own words". "Settings are yours" bullet: say it covers Juno's own settings (models, spend cap, rules, tiers, connections), not notification settings.
- **Section 14:** rewrite to the model above: working hours (presence and notifications together), Juno decides inside them, What matters to you, Every message and Never on people and channels (Every message wins), the start-of-hours summary, the why on a message, AI assist off falls back to DMs and mentions. The Juno messages table: "A scheduled message | As the schedule says: notify or not, at any hour, since you set the time"; the job rows stay Now inside working hours and go to the start-of-hours summary outside them. Replace figure 12 once built.
- **Section 15 table:** Notification gate: "Each incoming message, after Every message and Never, inside working hours". The gate reads the owner's What matters text.
- **Section 18:** none.
- **Section 19:** add the open item on Slack's notification schedule (below).

### inventory.md

- **Section 2, avatar menu:** add "Set yourself away" / "Set yourself active" (`moon` / `sun`) first; header sub line "Active" or "Away until 9am" with a presence dot on the avatar; Notifications hint becomes "Paused until 9am" outside working hours, empty inside.
- **Section 13:** replace with the page described above (title, sub, Working hours card, What matters field, People and channels card, Today line and Show why list). Drop the rule row, segmented control, new rule row, checkbox row, threshold row, digest row, quiet hours row and log grid. Replace the decision order with: ignored → Every message (person or channel) → Never → outside working hours or away by hand (hold for the start-of-hours summary) → AI assist off (notify for DMs and mentions) → Juno.
- **Section 14:** the Notifications group's sub becomes "Working hours, and what Juno lets through."
- **Section 15.1 and 15.2:** add "Notify me" (`bell`) with a submenu Every message, When it matters, Never (checkmark on the current one), above Ignore. Add the same submenu to a person's menu.
- **Message context menu (section 6):** add "Why did this notify?" / "Why no notification?" (`circle-help`) and the popover: 300px, radius 13, `--pop-shadow`, title 13/600, reason 13 subtle, one button (Change or Tell Juno) 28px secondary.

### packages/domain/src/notifications.ts

- `NotificationOutcome` becomes `'now' | 'hold'`; held messages that Juno would have sent now while outside hours are flagged for the start-of-hours summary (`'later'` may be the cleaner third value).
- `NotificationRule` becomes `NotificationLevel = 'every' | 'never'` keyed by `{ kind: 'channel' | 'person', id }`. Delete `RuleKind` 'mention' and 'keyword', `firstMatchingRule` and rule ids. Every wins over Never.
- `NotificationSettings` becomes `{ workingHours: { days: ReadonlySet<Weekday>, from: number, to: number }, mattersText: string, levels }`. Delete `aiGate`, `threshold`, `quietHours`, `digestTimes`, `CHATTER_CUTOFF`, `nextDigestSlot`, `nextDigestLabel`, `decisionChip`.
- `UrgencyScore` becomes the gate's answer `{ notify: boolean, reason: string }` from a fixed set of reasons ("asks you to decide", "about something you said matters", ...), so the why popover never shows a percentage.
- Add `presenceAt(minutes, weekday, workingHours, manual?)` returning `'active' | 'away'` and `nextSwitch(...)` for the "until 9am" hints. Pure, unit tested.
- Reasons become the popover strings: "#design-review is set to Never", "Maya Chen is set to Every message", "Outside your working hours", "You set yourself away", "Juno: asks you to approve the release before 2pm".

### Engine and elsewhere

- **Presence job:** at each schedule switch, on launch and on wake, call `presence.set` with `auto` or `away` as `presenceAt` says; track the current state from `manual_presence_change`. The avatar menu's switch calls the same path.
- **Gate:** pass the What matters text to the `classify` call. The gate eval (decision log 10-13 22:04) is re-run with it, and the p50 must stay near 516 ms.
- **Start-of-hours summary:** one OS notification at the start of working hours when anything was held as later; clicking it opens For you or the first topic (to settle when building).
- **Juno Agent:** a local tool to read and change notification settings and working hours, Local tier with Undo.
- No Quint spec change: presence and notification settings are owner-set values, not a sync protocol.

### Open items

- **Slack's own notification schedule.** The research shows a `dnd` object in `client.userBoot`, `dnd_updated` events, and `users.prefs.set`, but no `dnd.*` call site and no schedule pref keys. Slack's public API has `dnd.setSnooze` and `dnd.endSnooze`, and the schedule appears to be prefs (`dnd_enabled`, `dnd_start_hour`, `dnd_end_hour`, and possibly per-day keys). Unverified. Before building, read `users.prefs.get` and the boot `dnd` object (read-only) and find the client's setter in the bundle. Only then can Juno write the schedule so the phone stays quiet too. Until it is verified the page must not say "on your phone".
- **Every message on the phone.** Slack's schedule may not let #incidents through at night the way Juno's Every message does (Slack has VIPs for people, not channels). If so, the line on the page says Every message reaches only the Mac outside hours.
