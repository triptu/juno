# 0006. One AI provider interface, two model tiers, deterministic checks first, a fake for tests

Status: proposed, 2026-10-12

## Context

The spec splits AI into fast structured decisions that may run on every message and every send, and generation used sparingly. It also requires a global off switch, confirmation before anything is sent, and tests that do not depend on a live model. The chosen client is `@earendil-works/pi-ai` with the OpenRouter provider; it has no separate structured-output API, only tool calls validated with `validateToolCall`.

## Decision

`@juno/ai` defines `AiProvider` with `decide(task, input)`, `generate(task, input)` and `chat(context, tools)`, and a task table where each task names its tier (`decision` or `generation`), its prompt and its output schema. Decisions are implemented as a forced tool call whose parameters are the output schema, validated, retried once, and otherwise reported as "no decision" so the UI stays quiet. Model slugs per tier are preferences with defaults, not constants in logic.

Checks that do not need a model are not sent to one: the clarity check (typo table, doubled words, lowercase "i", missing "?", long sentences), the audience check (keyword list) and the first pass of ⌘K command routing (a grammar) live in `@juno/domain` as pure functions with tests. The model is used for route check, grouping, settled, notification gate, titles, catch-up, For you and chat.

`@juno/assistant` owns policy: caching in `ai_cache` keyed by task and input hash, timeouts, concurrency 2, a daily cost budget, and the `aiAssist` switch, which replaces the assistant layer with a no-op layer. `FakeAiProvider` is deterministic (word rules plus a fixture of canned chat replies) and is selected with `JUNO_AI=fake`; every e2e run uses it.

## Consequences

- AI cost is bounded and visible; a budget exhaustion degrades to fallbacks, never to errors in the UI.
- Tests are deterministic and offline. Prompt quality is checked separately with a manual script against OpenRouter.
- Swapping pi-ai for `@effect/ai-openrouter` or another client touches only `PiAiProvider`.
- Juno chat tools produce cards; the only outbound action is the user clicking Send on a card, which runs the normal `message.send` command.
- Keeping deterministic checks in `domain` means the composer's send checks work with AI off, which the spec implies but does not state.
