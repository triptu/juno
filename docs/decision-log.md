# Decision log

A short, dated record of product and engineering decisions, newest first. Big structural decisions also get an ADR in `docs/decisions/`. Times are local (IST). A `~` means the time was reconstructed from nearby commits.

Format: `- MM-DD HH:MM · who · decision. Why, if not obvious.`

- 10-13 17:56 · Tushar · Formal specs in Quint for the concurrent sync protocols: follow/unfollow and read state first (after the M3 sync fixes), then merge ordering and the outbox before M6. Model checker in CI; specs generate event orderings for the convergence test; changing sync behaviour means updating the spec.
- 10-13 17:52 · Tushar · Topic tiles get AI-generated art about each topic's content (not random generative marks). Explore approaches before building. Channel marks stay for Main rows and as the fallback.
- 10-13 17:52 · Tushar · OpenRouter key added. First live eval: generation is good; decisions on Claude Haiku via OpenRouter take about 1.5 s and mostly hit the timeout, so the decision tier needs tuning.
- 10-13 16:51 · Orchestrator · Sidebar rule implemented: followed threads, unread-mention threads Slack has said nothing about, and Main for channels with any activity in the window. An explicit unfollow hides the thread. Subscribe and unsubscribe mirror through an outbox seam and revert on failure. Real workspace: 452 rows (303 threads, 149 Main).
- 10-13 16:00 · Orchestrator · `@juno/ai` exists: `AiProvider` with `decide`, `generate` and streaming `chat`; a task table where tier (model, timeout) and shape (structured with a TypeBox schema, or text) are separate; nothing fails, a missing key or a bad answer is a `NoDecision` value. Defaults `anthropic/claude-haiku-5.5` for decisions and `anthropic/claude-sonnet-5.5` for generation, from OpenRouter's list that day. `pnpm ai:eval` judges prompt quality by eye, with the fake or live.
- 10-13 15:52 · Tushar · The sidebar scrollbar is hidden unless the pointer is over the list, with no layout shift. Built as a reusable scroll-area option so other areas can follow.
- 10-13 15:22 · Tushar · New subagents run on the second Claude instance (claudeAgent_2airclaude) via delegate_task; the orchestrator stays here. The two agents stopped by this instance's Fable limit continue there from their worktrees.
- 10-13 12:52 · Tushar · Sidebar shows followed threads (Slack "Get notified about new replies") and threads with unread mentions, plus Main for channels with recent activity of any kind. Other threads are reached through Main's thread links, All topics and ⌘K. Subscribe and unsubscribe work on any thread and mirror to Slack. Replaces the "every active thread" rule (910 rows on the real workspace).
- 10-13 12:52 · Tushar · Confirmed: unfollowed threads start as read at first sign-in.
- 10-13 11:18 · Orchestrator · Dark theme: warm-neutral near-black with three surface layers (sidebar, page, cards, popovers). Accent themes: Coral default plus 7 others, all meeting 4.5:1. "System" theme deferred because main must resolve it before first paint.
- 10-13 11:30 · Orchestrator · The socket connects without `start_args` (with it, real Slack never sends hello). Membership and read state come from `client.counts`, not `client.userBoot` (observed live).
- 10-13 11:30 · Orchestrator · Add a read-only live sync dry run that prints only aggregate numbers, to validate sync against the real workspace before the sidebar UI.
- 10-13 10:50 · Tushar · The gallery follows the state-machine pattern; break passes run at each UI milestone and before shipping; layout shift must never happen (automated guard in tests).
- 10-13 10:44 · Tushar · Sidebar row Resolve is an icon-only check button at the right of the meta line, in a reserved slot. The time stays. No layout shift on hover.
- 10-13 10:40 · Tushar · Unread counts stay soft grey; coral counts felt loud.
- 10-13 10:35 · Tushar · Look: Figtree UI font, Coral accent, rounder shapes (options C1 + D1). Accent colour becomes a user preference. The dark theme needs a redesign; light is good.
- 10-13 10:35 · Tushar · Live Slack: read-only, plus writes to the self-DM or a new private channel with only Tushar in it.
- 10-13 10:30 · Orchestrator · Store the imported dev session in a Juno-owned keychain item so the live smoke does not ask for "Slack Safe Storage" every run.
- 10-13 09:40 · Tushar · People show their Slack profile photos. Channels get a client-only icon and colour, auto-assigned and changeable.
- 10-13 ~09:35 · Tushar · Logo: laptop-two (a seated j at an open laptop, which is also a message with two replies).
- 10-13 ~04:20 · Tushar · Friendly layer on top of the calm design; Phosphor icons instead of Lucide.
- 10-13 ~01:00 · Tushar · Tushar owns the product and spec. The handoff's placeholder name is removed everywhere.
- 10-13 ~00:50 · Tushar · Run a better-interface design review at each UI milestone.
- 10-13 00:12 · Orchestrator · Slack wire shapes live in one package, `@juno/slack-schema`, with one branded `Ts` (from the M1 code review).
- 10-12 23:16 · Orchestrator · The renderer and engine talk over `effect/rpc` on a MessagePort (spike result, ADR 0009).
- 10-12 23:16 · Orchestrator · Lists use in-flow rows with `content-visibility: auto`. `@tanstack/react-virtual` is the only allowed virtualization library.
- 10-12 ~19:30 · Tushar · E2E tests use a typed, plain-language driver in Playwright, not Maestro or Gherkin.
- 10-12 ~19:20 · Tushar · Performance is a first-class feature: rows activate on mouse down, there are budgets and regression tests, and a performance reviewer looks at each milestone.
- 10-12 19:04 · Orchestrator · Engine in an Electron utility process; Electron `net` for Slack calls; two SQLite databases per workspace (disposable cache and durable user data); field-level merge rules.
- 10-12 19:04 · Orchestrator · Keep many small packages, even though a reviewer suggested merging five into the engine. Tushar asked for a package per smaller thing.
- 10-12 ~19:00 · Orchestrator · Not Enterprise Grid (checked the local Slack config), so Grid support can wait.
- 10-12 ~18:55 · Tushar · Sidebar shows every thread with recent activity plus each channel's Main. Resolve is local and marks read. No undo for sends; edit and delete own messages instead. Full file upload in v1.
- 10-12 ~18:30 · Tushar · Ship the default design only (tweaks later). Pinned and resolved topics stay in Pinned with a check. New DMs can go to anyone.
- 10-12 ~18:15 · Orchestrator · Effect 4 with `@effect/atom-react`; `@earendil-works/pi-ai` with OpenRouter; pnpm workspaces; electron-vite; Playwright.
- 10-12 ~17:50 · Tushar · Sign in two ways: Juno's own Slack sign-in window, and import from the installed Slack app.
- 10-12 ~17:50 · Tushar · Free fonts only, bundled locally (no licensed Söhne or Meraki).
- 10-12 ~17:45 · Tushar · Build Juno on Electron, React, TypeScript, StyleX, Effect and pi-ai with OpenRouter, as a monorepo, by reverse engineering Slack's own client.
