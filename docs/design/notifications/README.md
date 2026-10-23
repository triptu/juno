# Notifications

The current design is v2, approved by the owner on 10-23 and written into SPEC 14 and inventory 13 and 15.3. SPEC 14 decides behaviour; where this folder and the spec differ, the spec wins.

| File | What |
| --- | --- |
| `v2/index.html` | The v2 design page. Open it in a browser. A simulator shows how each case is decided, then the Settings page, the menus, the AI call and the research. Every person, channel and message in it is invented. |
| `mock.html`, `compare-light.png`, `compare-dark.png`, `around-light.png`, `around-dark.png` | The 10-14 page, before v2: the What matters to you text and the Every message and When it matters levels. `node ../../../scripts/heavy.mjs node render.mjs` writes the PNGs. |

## The model

Every message Juno decides on gets one of two outcomes. It **notifies** (a macOS banner, which then stays in Notification Center) or it **stays** (no banner, unread in Juno as usual). Nothing waits to notify later, nothing is bundled, and the owner has no state such as deep work to set.

The first step that applies decides:

1. **Notification hours.** Outside them, nothing notifies, not even Always.
2. **Always** on the thread, channel or person notifies. Always beats Never.
3. **Never**, or an ignored channel, stays. A direct mention of the owner by name, or of a group they are in, still notifies. @here and @channel do not.
4. **Always notify** switches: Direct messages, Group DMs, Mentions (on by default), Threads you started and Threads you follow.
5. **AI assist off:** DMs and mentions notify, as in Slack.
6. **Auto:** a closer ("thanks", "ok") after the owner's own message stays; a message in a group DM, thread or channel that names someone else and not the owner stays ("Asks Dev, not you."); a reply within 10 minutes of the owner writing in the conversation notifies; otherwise Juno reads it.

Then, messages that arrive within 10 seconds of a banner for the same conversation do not notify again. A later message is decided on its own.

**Juno's reading** is one decision-classifier call. It asks which of the owner's instructions the message is mainly about, and whether it needs the owner: an ask, an answer to the owner's question, a follow-up, a decision, something serious, or else a greeting, an update or chatter. A clear instruction decides. Otherwise answers, follow-ups and serious matters notify. An ask notifies in a DM or group DM, or in a thread the owner started, wrote last in or is named in. A decision notifies only in the owner's own thread. The rest stay. With no answer within 2 seconds, DMs and mentions notify.

**Your instructions** replace the What matters to you text. Each is one line with a direction the owner picks, Notify me or Don't notify. An instruction that is really about one person or channel is offered as a setting instead, since a setting is exact.

**Why.** Each decision keeps what decided it and a one-line reason built from facts, never from generated text ("You were talking with Priya 2 minutes ago."). The page shows one line for today with Details, which lists every decision of the day. From a row the owner can change the setting that decided it, or say it should or shouldn't have notified, which proposes an instruction.

What Juno decides: whether a message on Auto needs the owner. What the owner decides: the two sets of hours, the levels for a few people, channels and threads, the Always notify switches, and the instructions.

## Hours and presence

1. **Notification hours.** Outside them the Mac does not notify. Juno always writes the same hours to Slack's own schedule, so the phone goes quiet too (SPEC 14, "Slack's notification schedule"). It writes only when the hours change, never its defaults, and leaves a schedule changed in Slack alone until Use Juno's hours.
2. **Active in Slack.** Inside them Slack shows the owner as active; outside, away. Both sets of hours default to weekdays, 9am to 7pm, and can differ.
3. **Away by hand.** The avatar menu has "Set yourself away" or "Set yourself active". It changes presence only, and lasts until the next switch in the active hours.

### Presence and the honest limits

- Slack has `presence.set` for the self user (`docs/research/slack-data-access.md`, Presence). `away` is a manual away that holds on every client until set back; `auto` lets Slack decide from activity. There is no `getPresence`; Juno learns its own state from `manual_presence_change` events on the socket.
- At the start of the active hours Juno sets `auto`; at the end, `away`. "Active" always means `auto`, so an idle owner still shows as away.
- Juno can switch presence only while it runs. On launch and on wake from sleep, it applies what the schedule says for now. If the Mac sleeps through the end of the day, Slack's own idle away covers it. If Juno is closed when the active hours start, the owner stays away until it opens. The page says this in one line.
- A manual change in the official Slack client is respected until the next switch in the schedule, the same as a manual change in Juno.

## The page

Inventory 13 has the measurements. Top to bottom: Notification hours, Active in Slack, Always notify, Your instructions, People, channels and threads (the Always and Never lists), How Auto decides, Today with Details, then Huddles and Test notification. A conversation's menu has Notify me › Always, Auto or Never, and How Auto decides…, which opens the page at that box.

## Cut from the page

| Cut | Reason |
| --- | --- |
| Rule order and "first match wins" set by the owner | The order is fixed and short. Always beats Never |
| Now, Digest and Silent on every rule | A message notifies or stays. Requested digests are a Juno schedule (SPEC 13.6) |
| Keyword rules | Instructions cover them, read by the classifier instead of matched as substrings |
| A threshold slider | The cutoffs are named constants we set from labelled replays |
| Quiet hours and digest times | Folded into notification hours |
| The What matters to you text | Replaced by instructions, each with its direction |
| The switch for Slack's schedule and Restore | Juno always writes the hours to Slack |
| An exception for outside hours | Nothing notifies outside notification hours |

## Where it is written

- **SPEC.md:** section 3 (following), section 5 (Notify me on a thread), 13.9 (corrections from a message Juno read), section 14 (rewritten), section 15 (the reading), section 20 (incoming huddles follow the hours and levels).
- **inventory.md:** section 13 (the page), 15.1 and 15.3 (Notify me).
- **docs/architecture.md** and **packages/ai/README.md:** the reading in place of the old gate.

Not changed: no Quint spec, since notification settings are owner-set values, not a sync protocol.

The engine is in `packages/notifications` and `packages/engine/src/notificationRuntime.ts`; the page is `NotificationsPage` in `@juno/views`. Inventory 13 marks what v2 still has to build.

## Owner decisions

1. 10-14: simplify the page to hours, a few levels and Juno's judgement.
2. 10-16: no automatic summaries; requested digests are Juno schedules.
3. 10-14: presence and notifications have separate hours, the same by default.
4. 10-23: v2. Two outcomes, the fixed order above, the Always notify switches, instructions with a direction, the Always, Auto and Never levels, Slack's schedule always written, and Why with Details.
