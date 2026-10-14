# Juno Agent: M1 review

Opus, 2026-10-14. This reviews milestone M1 (Contracts) of `plan-v3.md` against its done-when in §17: "Specs pass with every broken pair failing. Pure memory is done. The chat contract and SPEC chapter are reviewed."

**Verdict: M1 is done.** All three conditions hold. Two limits (G7, G13) are stated and wait for the owner, and neither blocks M2. Four small contract gaps were closed in this review. Two follow-ups should land early in M2 (see "Before M2 builds on it").

## What M1 delivered

| WP | Model | Delivered |
| --- | --- | --- |
| WP0 Spikes | Opus | `spikes.md` and `spikes/`: S1 (pi-durable under FULL), S2 (cache marks), S3 (Codex), S5 and S6 (SQLite lock, write rates, backup capture), S7 (token bound), S8 (T3 MCP discovery and OAuth), and the model catalogue. Six findings changed the plan |
| WP1 Scaffold | Opus | The six `agent*` packages with their dependency rules in `check-deps`, pinned pi 1.2.0 and Codex SDK, ADR 0012 (the agent in its own utility process), architecture §10 |
| WP2 Memory spec | Astra | `specs/agent-memory.qnt` with 28 broken and corrected pairs, random traces and bounded Apalache checks. Gaps G1 to G4 decided and modelled |
| WP3 Actions spec | Astra | `specs/agent-actions.qnt` with 43 pairs. Gaps G5 and G6 decided and modelled |
| WP4 Recovery spec | Astra | `specs/agent-recovery.qnt` with 28 pairs. Gaps G7 to G13 decided; G7 and G13 kept as documented counterexamples |
| WP5 agent-memory | Astra | Pure memory rules: tree, due order, merges, raw-context taint, compaction tasks, request partition and budget, pins. Property tests against the public API |
| WP6 Cards, RPC, host port | Astra | `agent-cards` (payloads, JCS digests, child actions, evidence, card and job machines, projection) and `agent-contract` `rpc/` and `host/` (renderer RPC groups, protocol-2 host contract) |
| WP7 Chat contract and SPEC | Fable | `agent-contract/src/chat` (items, delivery and ending machines, cards, page and banner, header pages, `chatCopy`), SPEC §13 and cross-edits, inventory §12, the bubble mock. Reviewed by Opus (`review/opus-wp7.md`) and reworked |

Plan v3 §0 records every decision: the two v2 reviews (R, B, H, M, L), the WP7 review (W1 to W8), the spec gaps (G1 to G13), the WP5 finding (P1) and the WP6 differences (W9 to W13).

## What is verified, and how

| Claim | Check | State |
| --- | --- | --- |
| Every broken pair fails and every corrected case passes | `pnpm specs:check` (root, heavy lock) | Passed on main after G5 to G13 in 595 s: 28 memory pairs, 71 action and recovery pairs, 19 bounded checks, six temporal formulas typechecked with finite drains. Not rerun here: no spec changed in this review |
| Pure memory meets §4 and §5 | `pnpm --filter @juno/agent-memory test` | Six safety properties, due order against rollback push for t = 0 to 20,000, three compaction examples. Unchanged in this review |
| Card identities, digests, retries, projection and RPC codecs | `pnpm test:agent-contracts` | 28 tests pass after this review's changes |
| Package graph | `pnpm lint` (includes `check-deps`) | Passes |
| Types | `pnpm typecheck` | Passes |

Not verified by M1, by design: anything with I/O. The specs are bounded and sampled, not exhaustive proofs, and the liveness formulas are typechecked only (`specs/README.md`).

## Cross-check of plan, SPEC, contracts and specs

This review compared card kinds, state machines, copy and property names across plan §6, §8, §12, §13 and §15, SPEC §13 and §19, `agent-contract/src/{chat,rpc}`, `agent-cards` and the three Quint models.

**Agrees:** the 13 card kinds plus `unknown` in every source; `JobPhase`; `Delivery` and `Ending` against the copy and the SPEC; banner precedence; the RPC groups against `AgentRpcs`; every G1 to G13 property name exists in its spec.

**Fixed in this review:**

- The five WP6 differences (W9 to W13; below).
- Steering a session from a tainted run had no card kind. `t3_send` there is a `change` card; `t3_stop` is the Task card's Stop (W10).
- The `proposedSchedule` card and payload had no `prompt`, though G6 requires the card to show it word for word. Added to the payload, the card, the projection and the inventory.
- Expired cards had no Ask again command. Added `agent.cards.askAgain`; the agent writes the quoting message. The decline buttons (Skip, Keep on Remove, Wait until tomorrow) are documented as `dismiss`.
- Plan §15: "Astra's 22" listed 21 names; `scheduleFromCleanOwnerRun` was listed as added though the spec replaced it; `capHard` was listed twice; ten checked properties were missing from the plan.
- Plan §12 and §13.2: the budget button, the question's "You replied", the task phases, the Too long state, and the removal-pending line now match the SPEC and `chatCopy`.
- Plan §10.2 still said T3 needs no auth, and §10.1's `noSecrets` rule blocked T3's own token. Both follow spikes finding 1 now. §7.1 gained the model exclusions from finding 5. §11.1's schedule shape is `at | every | wallClock`, as the RPC has it.
- Inventory: AI off shows a chip and the line. The task can't-tell line ends the same way as the send line.
- `docs/development.md` lists `pnpm specs:check`, `pnpm test:agent-contracts` and the memory tests.

### The WP6 differences

| # | Difference | Resolution |
| --- | --- | --- |
| W10 | §6.4 used stale proposal names | Already fixed by the G6 edit; this review added the missing steering card kind |
| W9 | Quint warns on every non-deduplicated retry; the plan only on `unknown` | The plan now requires a warned click for every repeat. `CardStatus` `failed` and `unknown` carry `mayDuplicate`, the copy is `chatCopy.card.mayDuplicate` ("If the first try went through, this does it again."), and `transitionCard` refuses an unwarned retry of such a status. Deduplicated kinds retry with a plain click |
| W12 | The chat summarizes per-attempt uncertainty and both cancellation states | Intended. The plan writes down the projection: a row is sending while any attempt is unsettled, sent once any attempt has a receipt. Activity shows every attempt |
| W11 | "Stopped. Nothing after this was sent." overpromises | Now "Stopped. Juno won't start anything new for this reply." Work handed off before Stop may still land, and its card shows the result |
| W13 | The chat contract has no approval identities or edit revisions | Intended. `CardBinding` in RPC metadata carries them |

## Known limits

- **G7, a restore while the old Mac runs.** Without a central authority, an old Mac that is still on can act after a forced restore elsewhere, until it sees the new owner's backup in a shared folder. `staleOwnerCannotAuthorize` is a documented counterexample. The restore sheet says both Macs can act. Owner question 4.
- **G13, removed messages and an old backup.** A new Mac with no trusted deletion record can restore a backup that predates a removal. `staleFolderCannotRestoreRemoved` is a documented counterexample. The Review page says so. Owner question 5: whether "Rotate recovery phrase after removals" is on by default.
- **Bounded checking.** The specs check small instances. The implementation still needs its own crash harness (WP10) and e2e flows (WP22).
- **S8 is half done.** The live T3 tool list needs one owner sign-in. The fakes use the tool names this session sees.

## Before M2 builds on it

1. **One source for the card view shapes** (Astra, small, before WP13 projects cards). `agent-cards/src/presentation.ts` copies `chat/cards.ts` and `place.ts` so the pure package has no workspace dependency. Only the `projectCard` type assignment catches drift, and the `mayDuplicate` change had to be made twice. Add a test in `agent-contract` that the two `Card` schemas encode identically, and have `sendMessageStatus` take its strings from one place.
2. **After-line templates in `chatCopy`** (Fable, in WP12). "Resolved {n}", "Removed {n} messages", "Using {model}", "Open PR {n}", "Sent {n}", "Sent {n} of {m}" are fixed copy with a number in them, but `chatCopy` holds no template for them yet. WP12 adds them before the views print them; item 1's test then checks `agent-cards` against them.
3. **Protocol 2 for the host.** `AgentHostFullRpcs` exists, but the served group is still protocol 1. WP13 switches both together when it supplies handlers.

## M2 launch plan

M2's done-when: the chat runs in the app on OpenRouter with the model picker; Slack reads only; external writes disabled.

**Order.** WP10 finishes and merges first, because WP8's tests need its fakes and crash harness. Then three groups:

| Group | WP | Model | Owns (disjoint) | Starts when |
| --- | --- | --- | --- | --- |
| 0 | WP10 Fakes (finishing) | Opus | `packages/agent-testing/**` | in progress |
| 0 | Card shape check (item 1) | Astra | `packages/agent-cards/src/presentation.ts`, `packages/agent-contract/test/**` | now |
| A | WP8 Durable core | Opus | `packages/agent/src/{runtime,store,inbox,projection,recovery}/**` | WP10 merged |
| A | WP12 Views | Fable | `packages/views/src/{juno-chat,juno-pages}/**`, Sidebar busy and unread props, gallery registry, status bubble tokens, `chatCopy` templates (item 2) | now |
| A | WP13a Host side | Opus | `packages/agent-juno/**`, `packages/engine/src/agent-host/**`, outbox single-attempt mode, `apps/desktop/src/{agent,main/agent}/**` | now |
| B | WP9 Providers and guard | Astra | `packages/agent/src/providers/{guard,openrouter,catalog,compaction,index}.ts`, `packages/agent/src/spend/**` | WP8's store schema and migrations merged |
| C | WP11 Turns | Opus | `packages/agent/src/{request,compactor,router,jobs,memory-tools,pins}/**` | WP8 and WP9 merged |
| C | WP13b Wire-up | Opus | `packages/state/src/agent/**`, removing `chat` from `packages/ai/src/**`, protocol 2 switch | WP11's run loop merged |
| D | WP14 Containers | Fable | `apps/desktop/src/renderer/containers/juno/**`, home Ask Juno, Settings › Juno container, `docs/performance.md` budgets | WP12 and WP13b merged |
| D | WP22 flows 1, 2, 9, 12, 13, 15 | Opus | `apps/desktop/e2e/juno-agent/**`, `apps/desktop/e2e/driver/juno.ts` | Driver and flow 15 (gallery) after WP12; app flows after WP14 |
| from C | WP23 Evals | Opus | `packages/agent/eval/**` | WP11 merged |

**Why WP13 splits.** The plan has WP13 wait for WP11. Its host half (serving the protocol-2 reads, presence and single-attempt dispatch, and launching the utility process) depends only on the WP6 contracts and touches no file WP8, WP9 or WP11 owns, so it can start now. Only the renderer state and the switch from the old `ai` chat need the run loop.

**Why WP9 waits for WP8's store.** The spend reservations and the catalogue cache live in `agent.sqlite`, which WP8 owns. WP8 should merge the store schema and migrations as its first checkpoint, so WP9 starts days earlier than "WP8 done".

**Models.** Astra for WP9 and the shape check: well-defined code and arithmetic (token bounds, reservations, the catalogue filter) with no UI. Fable for WP12 and WP14: views, tokens and containers. Opus for WP8, WP10, WP11, WP13, WP22 and WP23: durability, crash safety, the run loop and the integration, where a mistake loses data or authority.

Each UI package ends with the design and performance reviews (§17). Run heavy jobs one at a time through the root scripts; groups A and C each hold three concurrent agents.

## Open owner questions

Plan §18 and SPEC §19 list the same five: the owner bubble colour, Juno's "I" voice, the clean-run narrowing, and the G7 and G13 limits. None blocks M2: WP12 builds option B behind one token, and the voice is copy.
