# WP7 review: chat contract, SPEC Juno Agent chapter, inventory §12

Opus, 2026-10-14, on commits 232ed5e, dc256a7, ecc4ae8, c5c1949. Verdict: M1 is not done until the two blockers are fixed; both would force breaking union changes once WP12 and WP14 build on the types.

## Blockers

**B1. Run endings cannot represent the failures the runtime produces** (`items.ts:84-89` `Ending`, `copy.ts:25-28`).
- No `failed` ending. pi-ai runs with `maxRetries: 0` (plan §6.3), so provider errors are common (OpenRouter 5xx, rejected key, Codex signed out, rate limit). SPEC says "Silence is a failure: if Juno cannot answer, a line says so", and the contract cannot say that line. Friendly-layer §7 has the copy: "Juno didn't answer. Give it a moment and try again."
- The budget block (plan §5.4) shows the wrong line; the only blocked copy is "Juno can't fit this in one request…". Hitting the cap mid-run or inside a subagent has no state.
- `stopped` has no fixed copy ("Juno writes that itself", `items.ts:80`); an aborted run cannot write anything.
- `interrupted: { retry: OpId }` is required, but wake and report runs have no owner op.
- An interrupted run may have no Juno message to attach the line to (crash before the first token, plan §3 step 4).

Fix: `complete | stopped | interrupted { retry?: OpId } | blocked { reason: 'tooLarge' | 'budget' } | failed { reason: 'provider' | 'keyRejected' | 'codexSignedOut' | 'offline' }`; fixed copy for every variant in `chatCopy.ending` (for example "Stopped. Nothing after this was sent."); allow an empty Juno `body`, or move interrupted and failed endings onto the owner item's `Delivery`; add rows to SPEC §13.7.

**B2. An owner bubble requires an archive id that does not exist yet** (`items.ts:56-63`). Archive messages are projected from pi commits after submit (plan §3). A message that is sending, queued as a steer, waiting behind Pause, refused as too long, or interrupted has an inbox `op_id` only. A container-invented id would change the virtual-list key on commit and remount the row. Fix: key owner items by `opId`, make `id` optional (or a pending/archived union), and document `opId` as the row key.

## Should fix

1. **Offline contradicts the inbox model.** "Not delivered" means the local inbox write failed (plan §3, `items.ts:44`), but SPEC §13.7 and plan §13.2 say an offline send ends as Not delivered; the inbox is local and succeeds offline. Offline sends are accepted and wait ("Queued" or "Waiting for network"), then run once online. Update SPEC, `page.ts:15-16`, plan §13.2.
2. **Banners are not exclusive** (paused+offline, recovery+offline, aiOff+paused). Write a precedence (otherDevice > recovery > aiOff > paused > offline) into SPEC §13.7 and the docstring; add `chip` and `line` strings per banner to `chatCopy` (inventory's "You're offline", "Juno restored from backup · Review" are missing).
3. **Remove as a chat card fails when it is needed most** (AI off, paused, offline, over budget). Remove from the context menu opens a local sheet that works in every state; keep `RemoveCard` only for "forget …" requests Juno proposes. Add "Copies already sent to the model provider cannot be recalled" to the sheet and card copy.
4. **Recovery, transfer and safe stop have no model and little SPEC.** `Banner.recovery` → Review has no target (`place.ts:44`); quarantined `restored` intents have no `CardStatus`; no button to leave recovery (plan §14.3); no transfer flow (§14.2); no forced-recovery attestation ("Juno cannot check this"); Settings has no ownership state, recovery-phrase export or restore (`pages.ts:145-164`); "Juno needs to update its records" (plan §3 step 6) has no state. Add a `restored` card status (or `open` with `mayHaveHappened`), a `review` page target, an `ownership` block on `JunoSettingsPage`, an `updateNeeded` banner, and a short SPEC subsection on Move, Restore and Activate.
5. **Task card has two overlapping machines** (`cards.ts:132-145`: `status` and `phase` both include done/failed). Either `status` covers only the Start click of a proposed task and `phase` the rest (documented), or split into `proposedTask` and `task`. Add `unknown` to `JobPhase` (plan §6.5). `ScheduleCard.state` overlaps `status` the same way; inventory's "Deleted" after-line has no state.
6. **Send card with mixed outcomes is undefined** (`cards.ts:75-82`). Rows get `pending | sending | sent | notSent | unknown`; the card stays `open` while any row is unresolved, or its status is derived from the rows.
7. **Status bubble after text is undefined.** State the rule when Juno streams text and then calls tools: the status bubble reappears below the streaming bubble, or the streaming bubble shows the status inline. Fix `StatusItem` "always the last item" and SPEC §13.2.
8. **The clean-run rule reads broader than the owner's decision.** SPEC §13.9 says "No click while the conversation is only you and Juno"; §13.4 says steering needs no click for sessions "you started in this chat", but T3 status reads taint the run (plan §10). Replace with "while Juno hasn't read Slack, a connection or a session report in this reply" and align §13.4 with §13.9. (The orchestrator is raising the narrowing with the owner; write the precise rule now.)
9. **Owner decisions missing.** The "Allow T3 over the local network" switch (off by default) and an editable T3 URL are in neither SPEC §13.10 nor `ConnectionRow`/`JunoSettingsPage`. Neither document says T3 sessions run with full access in a new worktree. Plan §1 and §18 still list both as open; update the plan too. Note from the spikes: the network switch only helps if T3 serves HTTPS.
10. **What Pause does to running work is undefined.** Plan §6.4-6.5: Pause asks jobs to cancel and revokes grants. SPEC must say whether Pause stops a running T3 session and the current run, and that steering after Resume needs a card.
11. **The hold behind an open question is unbounded.** Hold schedules only, never job milestones, and bound it (until the question expires or 24 hours).
12. **"Stop these" can kill a T3 session from an 11px text button**, against plan B5 (jobs stop only from their Task card). For jobs it mutes milestone messages ("Mute updates"); for schedules "Pause schedule".
13. **Chat page cannot window from the middle.** Add `moreBelow` to `ChatPage` now.
14. **`chatCopy` is missing strings views must print:** stopped and failed endings; offline and recovery chips; "Removal pending…" (also add to SPEC §13.7, plan §13.2 lists it); "This changed. Check it and save again." (plan §4.4); "being updated"; the "New message" pill; Task after-lines ("Stopped", "Done · Open PR"); Schedule "Deleted" and "Kept"; "Sign in" for `lostSight`; the secret-blocked line (fixed copy, never model-written); Activity outcomes as a literal union instead of free text (`pages.ts:85`).
15. **Empty-state suggestion names a fixture person** (`copy.ts:13`, "Tell Maya…"). Use generic copy ("Draft a reply in this topic") or derive suggestions in the container.
16. **`OpenTarget.url` accepts any string** (`place.ts:43`). Restrict to `https:` plus `http:` on loopback in the schema, so a spoofed link cannot open `file:` or a custom scheme.
17. **Remember this has no rule for long messages.** Pins are at most 280 bytes (plan §4.4) and the context-menu path is an owner action, not the `remember` tool. Define the long-message case (works on a selection, or disabled) and add the owner-action path to plan §4.4.

## Nits

- `Deliver` includes `silent` (`cards.ts:165`); plan §11.1 has `now | digest`. Update the plan.
- Plan §5.4 calls the budget prompt a `question` card; §12 and the contract say `budget`. Fix the plan.
- Inventory puts "Failed · Copy details" on the Task card; use "Failed · Show in Activity".
- `QuestionCard` `source: 't3'` with optional `job` allows a T3 question with no job; make it a union. Add a "You replied" after-line.
- Provider disclosure is defined twice (`ProviderCard.disclosure` and `chatCopy`); keep the fixed copy.
- `openRouterKey` needs a `rejected` state (`pages.ts:156`).
- Brand `ProposedMessage.id` and `QuestionOption.id`.
- Sidebar sparkle: SPEC §13.4 says while a job runs, `ChatSummary.busy` also covers runs. Pick one.
- Inventory's header menu includes Settings › Juno; SPEC §13.10 lists five pages. Align.
- SPEC §13.1 and §16 state "accent fill" as decided; mark the bubble colour pending (owner choosing between A–D).
- "Not now" is not verb-first; use "Skip". "Pick how Juno thinks" is close to a metaphor; use "Choose a model provider".
- Define: when a Juno message counts as read; how long Undo stays on "Remembered"; what "Ask again" on an expired card does; which origin a group gets when two jobs' reports combine; whether the composer works in recovery.
