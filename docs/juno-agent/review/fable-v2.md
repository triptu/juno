# Review of plan v2: the experience (Fable)

Written 2026-10-14 against `plan-v2.md`, from the owner's side of the screen. The question for every finding is the same: when Juno is built as the plan says, what does the owner see, and is it what he asked for in `BRIEF.md` and his decisions on v1?

Severity: **Blocking** means the plan should change before the work package that builds it starts. **High** means the owner would notice and object. **Medium** means a gap the implementer would fill badly without a decision. **Low** means polish.

Overall: v2 takes the experience research seriously. The four item kinds, the status bubble, the delivery line, the fixed card catalogue, the proactive label, origin-bound schedules and the five tiers are all there. The findings below are mostly places where two rules in the plan contradict each other, where a structural guarantee has a hole, or where a state the owner will meet has no design.

## Blocking

### B1. The status bubble has two jobs and two clearing rules

- **Section:** §7 "Status cadence", §10 "Status bubble", §0.2 row 10.
- **Problem:** §7 says the bubble "clears on pi's settled state", and in the same list says that "while only background jobs run, it shows the newest job ... and '+1 more' with a popover of jobs, each with Stop". These contradict each other: pi settles when the turn ends, but a T3 job runs for another forty minutes. §10 also says the bubble "becomes the first reply bubble in place". So after Juno says "I've handed this to T3 Code", does a second status bubble appear below it for the job, with looping dots, for forty minutes? And when the owner asks something else meanwhile, does the job bubble turn into the reply and then come back?
- **Consequence:** In iMessage the three dots mean "they are typing now". A typing bubble that sits at the bottom of the chat for an hour, with a popover of jobs and Stop buttons inside it, is exactly the machinery the brief wants hidden. It also makes the dots meaningless, so the owner stops trusting them when a real reply is coming.
- **Change:** One rule. The status bubble exists only while a run is active (owner input, a report run or a wake run) and clears on settled. Background jobs are shown by the Task card under the message that started them: its state line is live ("Tests running, 2 of 5"), it has Open and Stop, and the sidebar's Juno row shows the duotone sparkle. Drop the "+1 more" popover. "How is the fix going?" is answered from turn state, which already lists active jobs. Put this in the spec chapter and in WP12's fixtures.

### B2. A watch can spawn watches

- **Section:** §11 "origin is required", §13.2 `scheduleHasOrigin`.
- **Problem:** `schedule_create` accepts any owner message id, job id or watch request as `origin`. A wake run (origin_kind `wake`) can call it with the id of the message that set up the original watch. The tool accepts, the Quint property passes, and the owner never asked for the new schedule. The same hole exists for `delegate.spawn` from a wake: Tier 2 needs a card there, which is right, but a subagent's report then starts a report run, and a report run can again create schedules.
- **Consequence:** This breaks the owner's decision that proactive messages come only from things he set up. One "watch PR 412" can grow into a feed of watches, each with a valid-looking "Why this?" answer.
- **Change:** Make it structural the way pins are: `schedule_create` succeeds only in a run with `origin_kind = owner`, and its `origin` must be a `user` message from that run. From wake and report runs the only allowed schedule tools are `schedule_pause` and `schedule_delete` on the schedule that woke them. Add `scheduleFromOwnerRun` to `agent-actions.qnt` and a bug schedule for a wake run creating a schedule. Keep `scheduleHasOrigin` as well.

### B3. Named read-only lookups may default to a card

- **Section:** §6 `call_tool` classification, §8 Tier 0, §0.1 "No click".
- **Problem:** The default tier for an MCP tool is Tier 0 "only when `readOnlyHint` is true and the server is `trusted`"; otherwise Tier 3. The plan never says what `trust` defaults to for Notion, Littlebird and T3, and §6 already says Littlebird's hints are unknown. If any of these ship as `untrusted`, or a server omits `readOnlyHint` (Opus's research says hints cannot be relied on), every "what's on the Notion page" becomes a card.
- **Consequence:** The owner decided read-only lookups in Slack, Notion, Littlebird, topics and T3 status need no click. A card for a lookup is the first thing he would hit and the first thing he would call wrong.
- **Change:** Ship Notion, Littlebird and T3 as `trusted` with a fixed read allowlist per server in `agent-cards` or the policy package (Notion search and fetch; Littlebird search and read; T3 thread read, list, search, wait and pending-request list). Allowlisted tools are Tier 0 regardless of hints. Tools not on the list follow the hint rule. Servers the owner adds later default to `untrusted`. State the default in §6 and show it on Settings › Connections.

### B4. The chat's states are not enumerated, and WP12 is "done when every state is in the gallery"

- **Section:** §10, §15 WP12, §5, §8, §12.
- **Problem:** §10 designs the happy path, Queued, Not delivered and "working on your Mac". It has no design for: AI assist off (the home README says the chat "shows its own AI is off state"); no provider configured yet (first run: no OpenRouter key, no Codex); the provider failing after admission (the plan's "Not delivered" covers admission only; a run that starts and then loses the model shows nothing); offline; the spend cap reached ("new runs ask before spending", but how, and what the owner clicks); Pause Juno on; an expired card (7 days or source changed); a Codex turn interrupted ("Juno was interrupted. Ask again?" is a question, not an action). WP5 writes the chat view models before any of these exist.
- **Consequence:** The implementer invents these states one by one in M2 and M3, the contract gets patched each time, and the owner meets a stack trace or a silent chat on his first bad network day.
- **Change:** Add a state table to §10 (and the spec chapter) with copy for each: empty, idle, running, queued, not delivered (admission or provider, same line: "Not delivered · Try again", and Try again resubmits the same text), interrupted ("Juno was interrupted. Your message is kept. [Try again]"), offline (composer still works, send fails fast to Not delivered, wakes due while offline are delivered once when back), AI off (one line and the composer disabled, schedules shown as paused), no provider (a Connect-style card: "Pick how Juno thinks" with OpenRouter and Codex), spend cap (a `question` card: "Juno has used today's budget. [Continue today] [Wait until tomorrow]", the click is the owner's, not the model's), paused, expired card ("Expired · Ask again"), another device owns. Do this before WP5 starts (see H1).

### B5. Esc stops background jobs

- **Section:** §7 "Stop".
- **Problem:** "Stop (on hover or focus, and Esc when the composer is empty) aborts the run and stops jobs through their own API (`t3_thread_interrupt`, `delegate.stop`)." Everywhere else in Juno, Esc means close (SPEC §18). An Esc meant to close a popover, with the composer empty, interrupts a T3 session that has been running for twenty minutes.
- **Consequence:** The owner loses work from a key he presses by reflex, and nothing in the chat asks first or undoes it.
- **Change:** Esc and the status bubble's Stop abort the current run only. A job is stopped only from its Task card's Stop. After Stop, Juno says what was kept, as planned. Record the shortcut change in SPEC §18.

## High

### H1. The chat view models are written by the wrong package owner, in the wrong order

- **Section:** §2 `agent-contract`, §15 WP5 and WP12.
- **Problem:** WP5 (Astra) owns `agent-contract`, which includes "chat view models". WP12 (Fable) owns the views and the spec chapter and depends on WP5. So the shape of what the chat shows is fixed by the package with no UI remit, before the states (B4) and the spec chapter exist. The decision log's model routing says Codex never does UI.
- **Consequence:** Either the views bend to a contract that lacks states, or the contract is rewritten after WP12.
- **Change:** Split `agent-contract`: WP12 owns `packages/agent-contract/src/chat/**` (chat items, card view models, status, delivery, page view models) and writes the SPEC chapter first, in M1. WP5 keeps the RPC groups and the `AgentHost` port and imports the chat types. WP12 then depends only on WP1.

### H2. Steering a running T3 session needs a click

- **Section:** §8 tiers, §7 T3 jobs.
- **Problem:** `t3_start` is Tier 2 with the owner rule. `t3_thread_send` (telling a running session "also fix the tests") is not listed, so it falls under "any unknown MCP tool", Tier 3, a card every time.
- **Consequence:** "Tell it to use the dark variant" produces a card. The owner's no-click decision for T3 sessions he asked for is about the whole session, not only its first message.
- **Change:** Add `t3_send` and `t3_stop` to Tier 2 with the same origin rule. `t3_pending_request_respond` stays Tier 3, as planned, because it is T3's own permission gate.

### H3. Job milestones have no notification rule, so "proactively updated" is undefined

- **Section:** §7 milestones, §11 notification routing.
- **Problem:** §11 routes "proactive messages" through rules, then Now, Digest or Silent, then quiet hours, with defaults for "tell me when X" and "digest-type" schedules. It does not say who decides a schedule is digest-type (if the model does, it is a prompt rule, not a setting), and it says nothing about job milestones: started, needs a decision, done, failed, quiet too long. The Slack rules (person, channel, keyword) do not apply to Juno's own messages anyway.
- **Consequence:** The owner walks away from "fix the sidebar flake", T3 asks a question ten minutes later, and whether he is told depends on the model's mood.
- **Change:** Make delivery a field, not a judgement. Each schedule has `deliver: now | digest`, set at creation from the owner's words and editable on Scheduled. Job milestones: needs a decision, failed and quiet past `expected_by` are Now; done is Now for owner-started jobs; started is Silent (the chat already shows it). Quiet hours hold Now except schedules the owner marked Now. AI assist off means nothing is delivered. Put this table in the spec chapter and drop "rules first" for Juno messages.

### H4. Quiet hours hold the wrong thing

- **Section:** §4.2 dispatcher, §13.2 `quietHolds`.
- **Problem:** "Tier 3 dispatch from a schedule waits until morning, held as a card." Tier 3 never dispatches without a click, so there is nothing for quiet hours to hold at dispatch. What quiet hours should hold is the OS notification. The Quint property models the wrong layer.
- **Consequence:** Either the dispatcher gains a sleeping state that can never be reached, or an owner-clicked card at 11 pm silently waits until 8 am.
- **Change:** Quiet hours hold OS notifications (except Now schedules) and nothing else. A wake run may still run and write to the chat; its cards appear normally; the owner reads them with the "New" divider in the morning. Rewrite `quietHolds` as "no OS notification in quiet hours unless the schedule is Now".

### H5. Tier 1 "Juno-side settings" is too wide

- **Section:** §8 Tier 1.
- **Problem:** Tier 1 includes "Juno-side settings" with no click. The spend cap, the provider, the model and the rules are Juno-side settings. §8 also says the model can never write a rule, which contradicts this.
- **Consequence:** A prompt-injected "raise your daily budget" or "switch to the expensive model" runs without a click.
- **Change:** Tier 1 is exactly: `remember`, `schedule_create` (under B2), `schedule_pause` and `schedule_delete` on its own schedules, and `notify`. Every other setting is owner-only through Settings, with no tool.

## Medium

### M1. One card, several messages: the schema disagrees with the rule

- **Section:** §9 `sendMessage` props and the last bullet.
- **Problem:** `sendMessage` has one `target` and one `text`, but the section ends with "one card can hold several messages, so Juno proposes sends merged rather than as five cards".
- **Change:** `sendMessage` takes `messages: [{ target, text }]` (1 to 5), each row editable with its own context pill, one Send that sends them all, and a per-row status after ("Sent · Open", "Not sent · Try again"). Partial results are shown per row, as the research's "two of three are sent" rule needs.

### M2. The Change card approves a summary, the ledger executes a payload

- **Section:** §9 `change`, §4.2 "Approval is bound to the payload".
- **Problem:** The card shows a model-written "before and after summary" plus an "argument preview". The approval binds the payload digest. If the summary says "add one line" and the payload rewrites the page, the owner approved the summary and the ledger ran the payload.
- **Change:** The argument preview is mandatory, is rendered from the payload by the card (not written by the model), and is the thing the owner reads: the target, the fields that change, and the new values, with "Show all" for long text. The summary is a caption at most.

### M3. Activity will be one row per zoom

- **Section:** §8 Tier 0 "Logged in Activity", §10 Activity page.
- **Problem:** Every read, zoom and date call is a Tier 0 action and "logged in Activity". A recall answer makes fifteen rows. The page the owner opens when something looks wrong becomes a tool log, which is the machinery the brief hides.
- **Change:** Activity is grouped by run. A run row says who asked (owner, schedule name, job name), when, and the outcome. Under it, one row per outward or local action (Tier 1 to 3) with the decision, and one folded line for reads ("Read 3 topics, looked back 4 times"). Each failed action carries the ledger's `outcome_detail` in plain words with "Copy details", so the technical reason has a home now that "Show details" is gone.

### M4. The living home and ⌘J are not wired to the agent's states

- **Section:** §10 "Elsewhere", `docs/design/home/README.md`.
- **Problem:** The plan says the sidebar's Juno row shows the sparkle while work runs. It does not say that the home's Ask Juno field and ⌘J open the Juno tab with the composer focused (the inventory's rule), what the Juno nav item shows when Juno has posted an unread proactive message, or whether the home reflects a running job (the research proposed it; the home README has no slot and forbids timers).
- **Change:** Ask Juno and ⌘J open the Juno tab and focus the composer; ⌘J inside the chat focuses the composer. The Juno nav item shows the same soft grey count as For you for unread Juno messages, never an accent badge. While a job runs, the home's Ask Juno field reads the job's state line ("T3 Code · tests running") in place of its placeholder. This is a text swap in a fixed-height element, so it keeps the home's no-reflow rule, and it reads from the same live query as the sidebar sparkle.

### M5. Proactive messages can join a normal group

- **Section:** §10 "Grouping" and "Proactive label".
- **Problem:** Grouping is "same sender within 2 minutes". A wake message two minutes after a normal reply groups with it, and the label lands above both.
- **Change:** A message with a different origin always starts a new group. The label belongs to the group.

### M6. The pin rules and the editable pins page contradict each other

- **Section:** §3.4, §13.1 `pinsExact`.
- **Problem:** A live pin must equal its source `user` message. The owner "edits pins on What Juno remembers". An edited pin equals no message.
- **Change:** An edit on the page writes a new pin with `created_by = owner` and the page edit as its source (an owner-authored record), superseding the old one. `pinsExact` applies to model-created pins; owner-created pins need only a non-model author. Also: when the owner types "remember …" and the model does not call `remember`, nothing shows. Add "remember" requests to the eval so the Remembered line is reliable.

### M7. "Not delivered" has no owner for a steer that Stop drops

- **Section:** §7 router, §10 delivery line.
- **Problem:** A message sent while busy is a steer and shows Queued. If the owner presses Stop before the steer is read, the plan does not say what happens to it.
- **Change:** Stop aborts the run; a queued steer then starts a fresh run on its own. Queued never becomes Not delivered except through admission failure. Also delay the Queued treatment by 500 ms so a steer read within a tool round never flickers.

### M8. Status text before the first tool call

- **Section:** §7 "Specific text appears by 1.5 s".
- **Problem:** Before a tool runs there is nothing specific to say, and "Thinking" is banned by the friendly layer. The 1.5 s rule cannot be met on a slow first token.
- **Change:** Dots alone until either the first token (the bubble becomes the reply) or the first tool call (the bubble gets its text). The 1.5 s budget applies to "first text or token" as §10 already says; delete the stricter line in §7.

### M9. The spec chapter touches more than §13

- **Section:** §3 (preamble), §15 WP12 "SPEC.md §13 rewrite".
- **Problem:** SPEC §12 says the chat "is a chat only" and §15's table says the Juno chat runs "on request". Proactive messages change both. §14 gains Juno's delivery rule (H3). §18 changes Esc and ⌘J. §16 gains the bubbles. §19's sync question is answered for the agent.
- **Change:** WP12's spec work is "the Juno Agent chapter plus the cross-edits to §12, §14, §15, §16, §18 and §19", using the 14-section outline from `research/fable.md` §6, with the state table (B4), the tier table, the card catalogue, the delivery table and the four off switches (Stop, Pause Juno, per-connection, global AI assist) in one place.

### M10. Page views are blocked behind host wiring

- **Section:** §15 WP13.
- **Problem:** The Scheduled, What Juno remembers, Memory of this chat, Activity and Connections views are in WP13 with the containers, which depends on WP11 (Opus's wiring). Dumb views need no wiring, and M3's gallery review needs them.
- **Change:** WP12 owns all dumb views (`juno-chat/**` and `juno-pages/**`) plus their fixtures. WP13 owns containers only. WP13 also needs, and the plan does not list: the Sidebar view's busy and unread props (`packages/views/src/Sidebar.tsx`), the home's Ask Juno wiring, Settings › Juno (providers, rules, spend today, Pause) and the edit to `docs/performance.md` for the new budgets.

### M11. The `expected_by` silence rule has no default

- **Section:** §7 T3 jobs.
- **Problem:** "Quiet past `expected_by`" posts a milestone, but nothing sets `expected_by`. If the model sets it, it is usually missing.
- **Change:** Default `expected_by` to 30 minutes after the last step change. The message is the research's: "T3 Code has been quiet for 30 minutes. I'll keep watching, or you can stop it", with the Task card.

## Low

### L1. Resolve's tier reason is wrong

- **Section:** §8 Tier 3 "resolve (it marks read on Slack)".
- **Problem:** Resolve is local; read marks are not mirrored to Slack until a setting turns that on (decision log, 10-13 23:38). The card stays because SPEC §13 designs proposed resolves as cards.
- **Change:** Keep the card. Fix the reason: "a card because SPEC §13 says proposed resolves are cards", with "Resolved 3 · Undo" after, as §9 has.

### L2. Removing a message leaves Juno's quote of it

- **Section:** §3.6 "Remove" from the context menu.
- **Change:** When the next message is Juno's, the confirm dialog offers "Also remove Juno's reply". The "forget X" path already lists all matches.

### L3. T3's questions should say who is asking

- **Section:** §9 `question`.
- **Change:** The card header names the source: "T3 Code asks" with the job's title in the context pill, so the owner knows the answer goes to a session, not to Juno.

### L4. Cards in dark mode

- **Section:** §10 "Cards".
- **Problem:** "The wide soft shadow" is close to invisible on `#252421` over `#1B1916`.
- **Change:** Use the dark theme's card treatment from `docs/design/dark-theme/` (its ring), and check it in the coral mock review, which should also include a 200-message transcript so the mascot's once-per-group rule and the coral rhythm are judged at length, not on three bubbles.

### L5. Interrupted copy

- **Section:** §5 harness turns.
- **Change:** "Juno was interrupted. Your message is kept. [Try again]" (name what failed, what is safe, one action).

### L6. What leaves the machine

- **Section:** §5, §12.
- **Change:** The first-run provider card says, once, that Juno sends its memory of the chat to the chosen provider on every turn. Settings › Juno shows today's spend and the cap.

## What the plan gets right and should not lose

- The four item kinds and nothing else in the chat; cards under the bubble at column width; the status bubble becoming the reply in place.
- "Not in the chat" for tool details, with the Activity page as the one place to look.
- Origin-bound schedules, monitors that speak only on change, self-pausing watches, the proactive label with "Why this?" and "Stop these".
- Five tiers, no standing "always allow" for sends, "typing yes is not a click", the Because line, the model never writing a rule.
- Pins only from the owner's own words; owner-only redaction with "Removed" in the chat; recall answers that cite a day and scroll to it.
- Juno speaks for its delegates; four milestone kinds; one "still on it" per quiet stretch; "Juno is working on your Mac".
- Coral gated by a two-theme mock with a neutral fallback; the mascot only inside the chat and never animated.
