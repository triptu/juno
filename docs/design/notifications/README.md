# Notifications: a simplification pass

Approved by the owner on 10-14 and applied to SPEC 14, inventory 13 and `@juno/domain`. It replaces the old notification page and adds a presence schedule. `mock.html` shows the current page next to the proposal, and what moves off the page. `node ../../../scripts/heavy.mjs node render.mjs` writes the PNGs.

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
- **Two timing concepts that overlap.** Digest times and quiet hours both say when you may be interrupted, in different words.
- **A five-column Today log.** Time, place, message, outcome chip, reason, for every message of the day. It is the busiest thing on the page, and the owner needs it only when one specific message surprised them.
- **Keyword rules.** "Contains lunch" is the kind of judgement a model does better than a substring.

Every row on the page is a control, and the page needs a scroll before the log starts. In the proposal, most of the page is read rather than operated, and it fits in one screen.

## The simplified model

Two sets of hours, one paragraph of plain words, two short lists, and Juno's judgement for everything else.

1. **Hours.** Two rows, each with days and a from and to time. Both default to weekdays, 9am to 7pm. They can differ: active until 8pm, notifications until 6pm.
   - **Notifications.** Outside them your Mac does not notify, and once Slack's own schedule is verified (open items), Juno writes the same hours to Slack so your phone goes quiet too, with no extra switch. When they start, one notification sums up anything that would have notified you, if there was any.
   - **Active in Slack.** Inside them Slack shows you as active; outside, away.
2. **Inside notification hours, Juno decides** each message: notify now, or hold. Held means no notification; the message is in the sidebar as always. There is no threshold. The decision model's cutoff is calibrated by us and checked by the gate eval, not set by the owner.
3. **What matters to you.** A short text the owner writes ("The launch and hiring. Anything from my reports that needs a decision today."). Juno's gate reads it with every message. It replaces keyword rules and most person and channel rules. The owner can edit it on the page or tell Juno in chat.
4. **People and channels** have three levels, set from their context menu:
   - **Every message** notifies, even outside notification hours. This is the safety valve (#incidents, your manager).
   - **When it matters** is the default. Juno decides. It is not listed on the page.
   - **Never** notifies, but the messages stay in Juno. Ignore (in Preferences) still exists for hiding a channel entirely.
   - There is no order. If a person and a channel disagree, **Every message wins**, so nothing important is silently lost.
5. **Away by hand.** The avatar menu has "Set yourself away" or "Set yourself active". It changes presence only, and lasts until the next switch in the active hours.
6. **Why, on demand.** A message's context menu has "Why did this notify?" or "Why no notification?". A small popover gives the reason in words. If the reason is a setting, it offers Change; if it was Juno's call, Tell Juno opens the chat quoting the message. The page keeps only a one-line Today ("4 messages interrupted you. Juno held 23.") with Show why, which lists the ones that interrupted you and their reasons.
7. **AI assist off.** Juno's judgement is off, so inside notification hours you are notified for DMs and mentions, as in Slack. Every message and Never still apply. The "What matters" field shows "AI assist is off. You're notified about DMs and mentions." in place of its text.

What Juno decides: whether a message needs you now, given what matters to you, who wrote it, where, and whether it asks you something. What the owner decides: the two sets of hours, the words, and Every message or Never for a few places and people.

### Presence and the honest limits

- Slack has `presence.set` for the self user (`docs/research/slack-data-access.md`, Presence). `away` is a manual away that holds on every client until set back; `auto` lets Slack decide from activity. There is no `getPresence`; Juno learns its own state from `manual_presence_change` events on the socket.
- At the start of the active hours Juno sets `auto`; at the end, `away`. "Active" always means `auto`, so an idle owner still shows as away.
- Juno can switch presence only while it runs. On launch and on wake from sleep, it applies what the schedule says for now. If the Mac sleeps through the end of the day, Slack's own idle away covers it. If Juno is closed when the active hours start, the owner stays away until it opens. The page says this in one line.
- A manual change in the official Slack client is respected until the next switch in the schedule, the same as a manual change in Juno.

## The page

`compare-*.png`, right column. Page max-width 880, padding `40 40 56`, gap 36, as today.

1. Title "Notifications". Sub: "During your notification hours, Juno lets through what needs you and holds the rest. Everything is in Juno whenever you open it."
2. **Hours.** One group card, two rows. Each row: a label (14/500) with a 12px muted sub, seven day toggles (28px round, on is `--secondary-default`), then the from and to selects.
   - "Notifications", sub "When it starts, one notification sums up what needed you."
   - "Active in Slack", sub "Outside these hours you show as away."
   Below a hairline, one 12px muted line: "Juno switches your status while it's open. If it's closed when your active hours start, you stay away until you open it." Once Slack's own schedule is verified and written, the Notifications sub adds "Slack on your phone pauses too."
3. **What matters to you.** Sub: "Juno reads this for every message. You can also just tell Juno." A plain text field, max-width 620, at least three lines, saved on blur.
4. **People and channels.** One group card, two rows: "Every message" (sub "Even outside notification hours") and "Never" (sub "Still in Juno, no alerts"). Each row holds removable tags (channel icon or avatar, name, `x`). Hint below: "Right-click a channel or person to change how it notifies you." With both lists empty, the card is one muted row: "Every channel and person is set to When it matters."
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
| Quiet hours | Folded into notification hours, inverted |
| Today so far chips | Replaced by one sentence |
| Five-column Today log | Replaced by Show why (interrupted messages only) and the per-message why |
| "Next digest 3pm" hint in the avatar menu | No digest times; the hint becomes "Paused until 9am" outside notification hours, and nothing inside |

## Where it was applied

- **SPEC.md:** section 3 (presence and notification settings in the Slack table), section 5 (avatar menu), 13.6 (schedule delivery), 13.9 (notification settings change from the owner's own words, with Undo), section 14 (rewritten), section 15 (the gate), section 19 (Slack's notification schedule).
- **inventory.md:** the avatar menu, section 6 (the message menu's why), section 13 (rewritten), section 14 (Preferences link), 15.1 and 15.2 (Notify me).
- **`@juno/domain` `notifications.ts`:** `decideNotification` (ignored → Every message → Never → outside notification hours → AI assist off → Juno), `hoursStartSummary`, `inHours`, `nextSwitch`, `untilLabel`, `scheduledPresence` and `slackPresence`. Table tests in `test/notifications.test.ts`.
- **docs/architecture.md:** the M10 line.
- **docs/backlog.md:** the engine presence job, the gate change, the hours-start summary, Juno's settings tool, and the read-only check of Slack's notification schedule.

Not changed: no Quint spec, since presence and notification settings are owner-set values, not a sync protocol.

The M10 engine implementation is in `packages/notifications` and `packages/engine/src/notificationRuntime.ts`. The page, Preferences' Appearance group, the Notify me menus, the why popover, Set yourself away or active, main's OS notifier and the dock badge are built (`NotificationsPage`, `PreferencesPage`, `WhyPopover` and `AccountMenu` in `@juno/views`, `engine/src/notifications/handlers.ts`, `apps/desktop/src/main/notifier.ts`); inventory 2.1, 13, 14 and 15 say what differs. Writing the hours into Slack's schedule waits for the owner's approval. The remaining work is in `docs/backlog.md`.

## Open items

- **Slack's own notification schedule.** The research shows a `dnd` object in `client.userBoot`, `dnd_updated` events, and `users.prefs.set`, but no `dnd.*` call site and no schedule pref keys. Slack's public API has `dnd.setSnooze` and `dnd.endSnooze`, and the schedule appears to be prefs (`dnd_enabled`, `dnd_start_hour`, `dnd_end_hour`, and possibly per-day keys). Unverified. Find the pref or endpoint read-only (`users.prefs.get`, the boot `dnd` object, the official client's bundle), never by writing. Until then the page does not say "on your phone".
- **Every message on the phone.** Slack's schedule may not let #incidents through at night the way Juno's Every message does (Slack has VIPs for people, not channels). If so, the page says Every message reaches only the Mac outside notification hours.

## Owner decisions (10-14)

1. Apply the proposal.
2. Digest times are cut: one summary when notification hours start; extra digests only as Juno schedules.
3. Presence and notifications have separate hours, two rows in one section, the same hours by default.
4. Once verified read-only, notification hours also set Slack's own notification schedule, with no extra switch.
