# Juno Agent: experience research (Fable)

Independent research for the Juno Agent brief (`docs/juno-agent/BRIEF.md`), written 2026-10-14. It covers the chat experience, the optmem memory design, pi's current release, the trust model and the visual direction. Architecture is another researcher's job; where this document touches it, it says only what the experience needs.

Every claim is tagged. **Observed** means read in a primary source or seen in the product. **Inferred** means my reading of the evidence, or a design proposal. **Unknown** means I could not confirm it.

Sources are numbered and listed at the end.

## 0. What the repo already decides

Observed, from the docs the brief points at:

- Juno chat is one long single-threaded chat with no "new chat". "This" means the last viewed topic. Replies are short plain text, no markdown or emoji. Proposed messages are cards that send only on **Send** (SPEC §13).
- Nothing is sent without a click, AI never rewrites the user's voice, and a global AI assist switch turns off every AI surface (SPEC §15).
- Undo over confirm for reversible actions, with the toast format "Resolved · title · Undo" (SPEC §17).
- Notifications have three outcomes, Now, Digest and Silent, plus quiet hours and a Today log that explains each decision (SPEC §14). This is the machinery the agent's proactive messages should reuse, not duplicate.
- The friendly layer fixes the voice: calm colleague, no exclamation marks, never blame, never apologise, errors name the thing that failed and what is kept safe, then one action. Progress copy counts real things, never percentages. The seated j is the one character and appears only in illustrations and the Juno surfaces (`friendly-layer.md` §1, §6, §7).
- The current chat inventory (`inventory.md` §12) draws the user in a soft bubble and Juno as plain text beside a 28px mark, with a busy line "Looking through your topics…", three card types, and an input with no attach button.
- `@juno/ai` runs one streamed chat turn with tools; the caller runs the tools and calls again. The repo depends on `@earendil-works/pi-ai` 1.1.0, the model API layer, not the coding agent (`packages/ai/README.md`, `packages/ai/package.json`).
- The empty workspace is becoming a "living home" with the mascot, a greeting, smart items and an Ask Juno field (decision log, 10-14 01:10). The agent's chat and the home share the mascot and the field.

The brief changes two of these on purpose: Juno becomes a portable agent that acts beyond Slack, and the chat takes the iMessage bubble look. Everything else above should hold.

## 1. The experience

### 1.1 What real products do

**iMessage** (Observed, from using the product and Apple's own guide [S1]). The things that make it feel personal are few: bubbles with one colour for me and one for them, consecutive messages grouped with a tail only on the last, times hidden until you drag or hover, centred day separators, a typing bubble with three dots that sits where the reply will land, and a single "Delivered" or "Read" under my last bubble only, never under each one. Tapbacks and Undo send give small, reversible gestures. The lesson is restraint: state lives in one place at the bottom, and everything above it is just the conversation.

**Apple HIG, Generative AI** (Observed [S2]). Apple's page, updated June 2026, says: give specific feedback during generation ("Summarizing key themes from your notes" rather than "Processing…"); ask for confirmation before performing a significant action on someone's behalf and avoid automating destructive or hard-to-undo actions; put Edit, Undo, Retry and Adjust near generated content and acknowledge when a correction takes effect; disclose where AI is used; show people what is sent to a server; and when something goes wrong, "describe what happened in plain language and offer a clear next step". This matches the friendly layer's copy rules almost word for word.

**Linear agents** (Observed [S3], [S4], [S5]). Linear's Agent Interaction Guidelines ask for instant but unobtrusive feedback (a "Thinking" indicator right away; a session is marked unresponsive if the agent says nothing within 10 seconds), clear internal state ("thinking, waiting for input, executing, or finished", visible at a glance with reasoning and tool calls inspectable on demand), always disclosing that it is an agent, and stepping back immediately when asked to disengage. The protocol has five agent activity kinds, `thought`, `action`, `elicitation`, `response` and `error`, and session states `pending`, `active`, `awaitingInput`, `error`, `complete` and `stale`. When a user delegates an issue, the user stays the assignee and the agent is a contributor. Linear renders the UI; the agent only emits semantic events. That split, semantic events in, a fixed UI out, is the right shape for Juno too.

**ChatGPT scheduled tasks** (Observed via OpenAI's help page as reported by 9to5Mac and others [S6], [S7]; the help page itself returned 403). A Scheduled page lists active tasks with their next run and lets you pause, resume, edit or delete. Tasks can be made in conversation. Monitoring tasks check the web and connected apps and "notify users only when there is something worth reporting". Tasks run at most once an hour, and unattended tasks pause after a period of inactivity. This replaced Pulse, the earlier always-on proactive feed. Two lessons: proactive work needs a visible list with pause, and a monitor that only speaks on change beats a feed.

**ChatGPT agent** (Observed via OpenAI's help article as summarised in press [S8]). Safeguards: confirmation for high-impact actions, a "watch mode" that requires supervision on sensitive sites, and a takeover mode where the user enters data themselves. Third-party guidance adds: log confirmed and rejected actions separately from the transcript [S9].

**Claude Code** (Observed [S10]). Typing while Claude works queues the message; queued and sent messages show in grey until Claude starts on them; a queued message is passed to Claude as soon as the current tool calls finish, within the same turn; Esc interrupts and "Claude keeps the work done so far"; a "send now" key moves backgroundable work to the background and delivers the message. Background subagents run by default and Claude is notified when they finish; a focus mode folds completed background notifications into one count [S11]. The lesson: steering is "deliver between tool calls", not "stop and restart", and the grey "not started yet" state is the whole feedback the user needs.

**Claude memory** (Observed [S12]). Memory is a list of topics the user can read, edit and delete; "remember this" saves directly; "forget this" works in chat and applies to the next conversation; incognito chats are never remembered; project memory is separate. **ChatGPT memory** behaves the same way with a "Memory updated" marker (Unknown: could not fetch the help page; from product use).

**Raycast AI** (Observed from the changelog [S13], [S14]). Tool approval prompts "clearly explain the requested action and its impact"; confirmations default to Auto so sessions do not ask on every call; Auto-review rules let the user shape what Auto allows; the agent "stops, asks you, and then continues where it left off"; automations "work in the background and add the result to a chat". The last point is exactly the brief's shape: the chat is the inbox for background work.

**T3 Code** (Observed, from the tools this session runs on). Delegation returns a task id and a child thread; status is polled or waited on; a watched pull request wakes the parent thread when checks finish, someone comments or the branch conflicts, and the instructions say "do not poll". Juno orchestrating T3 Code can lean on this: delegate, get woken, never busy-wait.

**Codex Cloud and Devin** (Inferred from secondary reports [S15]). Cloud tasks continue when the laptop goes offline and can be steered from a phone; messages sent just before a connection drop survive on the server. Relevant because the brief wants the same Juno everywhere.

### 1.2 The main chat stays simple: the rule

Inferred. Everything in the chat is one of four things, and nothing else is ever drawn there:

1. A message from the owner.
2. A message from Juno, in Juno's words, optionally with cards under it.
3. One live status bubble while Juno works. There is at most one, it is always the last thing in the chat, and it updates in place.
4. Day separators and the "Delivered"-style line under the owner's last message.

Tool calls, subagent transcripts, MCP traffic and compaction never appear in the chat. They exist in two other places: a disclosure under a Juno message ("Show details", collapsed by default) and the Activity page (section 4.3). This is Linear's split: the engine emits semantic events; the chat shows the five kinds that matter to a person.

### 1.3 "Working on it" and the cadence of progress

Inferred, built on Linear's timing and Apple's wording:

- **Acknowledge within a second.** The moment the owner sends, the status bubble appears with three dots. If the model's first token has not arrived in about 1.5 seconds, the dots gain a line of text with the first specific thing Juno is doing ("Reading #eng"). Linear's 10 second rule is the outer limit; a desktop chat should feel like 1 second.
- **Status text is specific and counts real things.** "Reading 3 topics", "Asking T3 Code to fix the sidebar flake", "Tests running, 2 of 5 packages". Never "Processing", never percentages (friendly layer §7).
- **Update in place, do not append.** The status bubble changes text at most every 2 seconds, so it does not flicker. Nothing is added to the chat until a milestone.
- **Milestones become messages.** Only four events produce a new Juno message during a task: started something long ("I've handed this to T3 Code. I'll tell you when it's done."), needs a decision (an elicitation card), finished (the result), failed (section 1.8). This is the Linear activity set minus `thought`, which stays behind the disclosure.
- **Long tasks get one "still on it" at most per quiet stretch.** If a task has run for more than 10 minutes with no milestone, Juno says once what is happening and when it expects to know more. Then it is silent until the next milestone. Repeating "still working" every minute is noise, and the status bubble already shows liveness.
- **Leaving the chat does not end the task.** The sidebar's Juno row shows a small duotone sparkle while something runs (the friendly layer already reserves duotone for Juno), and the living home can show the same status line. No pulsing dots (friendly layer §8).

### 1.4 How delegated work reports back

Observed in the gist: a subagent's final reply reaches the master "as one `work` message" and the master "never waits or polls for it" [S16]. Observed in Claude Code: the parent is notified when a background subagent completes [S11]. Observed in T3 Code: a delegated task has an id, and a watched PR wakes the thread.

Inferred design:

- A delegate's report is addressed to Juno, not to the owner. Juno reads it and writes its own short message: what was done, what changed, what is open, and one card with the artefact (a pull request, a Notion page, a Slack topic). The raw report sits under "Show details".
- Delegated work that spans hours behaves like a conversation with a colleague who went away to do it: one message when it starts, one when it needs a decision, one when it is done. If the owner asks "how is the fix going?" in between, Juno answers from the live status rather than making the owner wait.
- Several delegates finishing close together produce one message, not three.
- A report that arrives while the owner is mid-conversation with Juno about something else is delivered between tool calls (the gist's "work" messages do this). Juno finishes the current thought, then mentions it: "Also, the sidebar fix is ready for review."

### 1.5 Proactive messages without noise

Inferred, reusing SPEC §14:

- A proactive message is an ordinary Juno message with a small label above it: "Scheduled · Daily catch-up", "Watching · PR #412". The label is the handle for "Why this?" and "Stop these".
- Whether it also becomes an OS notification goes through the existing gate: rules first, then Now, Digest or Silent, then quiet hours. A scheduled catch-up is Digest by default; "tell me when the deploy finishes" is Now because the owner asked for it. Nothing here needs a new preference.
- Monitors speak only on change (ChatGPT's rule). A watch that finds nothing writes nothing, not even "no change".
- Within one digest window, proactive items are one message with a short list. The same rule as the digest.
- Every schedule is visible on a Scheduled list (in Juno's settings and on request in chat: "what are you watching?"), with next run, pause, edit and delete. A schedule the owner has not touched or answered in a long time pauses itself and says so once (ChatGPT's inactivity pause). That stops a forgotten watch from running forever.
- Proactive messages never carry actions that run without a click. A scheduled "resolve settled topics" produces a Resolve card, not a resolve.

### 1.6 Confirmations and action cards

Observed about json-render [S17]: the model may only use components from a developer-defined catalog with Zod prop schemas; the spec is a flat `{ root, elements }` map; actions are declared in the catalog and bound to callbacks; a stream compiler renders partial specs progressively; state and `visible` conditions live in the spec.

Inferred for Juno:

- Keep the catalog tiny and fixed: **Send message** (context pill, editable text, Send and Dismiss), **Resolve** (list, Resolve and Dismiss), **Topics** (links), **Task** (a delegated job: title, where, status, Open and Stop), **Question** (a short question with 2 to 4 option chips and a free-text fallback), **Schedule** (what, when, Pause and Delete), **Connect** (sign in to an MCP server), **Change** (an edit to an external thing such as a Notion page: a before and after summary, Apply and Dismiss). Every card has a status after action ("Sent 13:45 · Open", "Dismissed", "Done"), so the chat is its own receipt.
- The model never invents a card type. If it needs something the catalog lacks, it asks in words.
- A card shows the consequence, not the mechanism: where the message goes, who will see it, what will change. Raycast's "action and its impact" wording. A "Because" line names the source when the action was triggered by content Juno read ("Because: Maya asked for a decision in #eng"). This matters for prompt injection (section 4.5).
- Typing "yes" is not a click. If the owner types consent for a send, Juno focuses the card's primary button and says "Press Send and it goes." Enter on a focused button is a click. This keeps SPEC §15 true without feeling bureaucratic.
- Cards render under Juno's bubble at the column width, not inside the bubble, with the friendly layer's card radius and soft shadow. In iMessage terms they are the app tiles, not the text.

### 1.7 Steering mid-task and interruptions

Observed in pi: `steer()` queues input after the current assistant turn and its tool calls; `followUp()` queues after pending work; both return `queued` or `handled`; `abort()` stops and waits for idle; as of v1.2.0 a session counts as busy while a run starts, and an abort requested meanwhile aborts the run once it starts [S18], [S19]. Observed in Claude Code: messages queued during tool calls are delivered within the same turn, and Esc keeps the work done [S10].

Inferred design:

- There is no "queue" the owner has to understand. Typing while Juno works sends. The message appears as a normal bubble, in the muted "queued" treatment until Juno has read it (Claude Code's grey). Juno decides whether it changes the current task or waits: "Got it, I'll use the dark variant" in the status bubble, or "I'll do that after this."
- The status bubble has one control, **Stop**, shown on hover or focus and bound to Esc when the input is empty. Stop keeps what was done and Juno says what state things are in: "Stopped. The branch has two commits and nothing was pushed." A delegate that is stopped is cancelled through its own API (T3 Code's cancel), not abandoned.
- No pause button. Pause is a stop followed by "carry on" later; the chat is the resume point.
- An interruption by Juno (a proactive message during a conversation) waits for the owner's turn to end. Juno never speaks over an unanswered question of its own.

### 1.8 What the owner sees when something fails

Observed: the friendly layer's error rule (name the thing that failed and what is kept safe, then one action) and Apple's "describe what happened in plain language and offer a clear next step" [S2]. Observed in pi: MCP failures are reported once after startup; a dropped server shows as disconnected and reconnects on the next call; HTTP errors are retried twice [S20].

Inferred design:

- A failure is one Juno message, in words, with at most one card. "Notion didn't answer, so the page isn't updated. Your text is in the card below. [Try again]". "T3 Code stopped with failing tests. The branch is kept. [Open] [Ask it to fix]".
- Partial work is stated as partial: "Two of three messages are sent; the one to #design is still in the card."
- The technical reason stays behind "Show details". Never a stack trace in the chat.
- A connection that needs sign-in is a **Connect** card, not an error. pi's OAuth flow opens the browser and waits [S20]; Juno says "Sign in to Notion and I'll carry on."
- When Juno itself is unreachable (model provider down), the existing copy applies: "Juno didn't answer. Give it a moment and try again." The owner's message stays in the chat, marked not delivered, and resends on click, like iMessage's red "Not delivered".
- Silence is also a failure. If a delegated task has sent nothing for longer than its expected time, Juno says so rather than letting the status bubble spin: "T3 Code has been quiet for 20 minutes. I'll keep watching, or you can stop it."

## 2. The optmem gist, plainly

Observed, from the gist text [S16]. Its current title is "UniiChat: one chat that never ends".

**The idea.** The chat is the memory. There is one chat, it never ends, and every message is logged word for word, forever, in append-only daily JSONL files. Each message has a kind: `user`, `unii` (the agent), `tool`, `echo` (tool results), `work` (a subagent report) or `note` (memories imported from before the chat). Thoughts are shown but never logged.

**The tree.** In the background, a cheap model compresses each message into one line of at most 512 bytes. Two adjacent lines merge into one line, two of those merge again, and so on, forming a binary tree. A node is named by its first message and how many it covers (`40+8`). Each node is built once and never rebuilt.

**The view.** Every call to the model gets the whole chat as a list of these lines, oldest first, recent lines fine and old lines coarse, 64 to 128 KB in all, then the new message. Nothing carries over between turns; the view is the only continuity. Which pairs merge follows the author's rollback-netcode "push" from 2022, which is a binary counter: new entries change often, old ones almost never. The order is set by one number, how long ago a pair ended measured in its own line size. Merges are held back and done in a batch when the view passes 128 KB, down to 64 KB, so the prompt cache keeps about 98.6% of the prefix on turns and 96.2% on compactions in a 3,000-message replay.

**Zoom.** When a line is too vague, the model calls `zoom(id, n)` to open it into the two lines it was made from, down to the message itself. `date(id)` gives a message's time. The prompt tells the model to zoom "until you have it whole, before any other source, and before you act, guess or ask", and to say in its reply what it learned from tool output, because summaries keep little of it.

**Compactions.** A compaction is a call with the same system prompt and tools as a turn, so it shares the cache, a smaller view for context, and a task: compress one message or merge two lines, within a 512-byte ruler. Over-long lines are sent back with the cut shown, up to five tries. Up to 8 run at once, from queues, never by scanning the tree. The compaction prompt ranks what to keep: the user's words first ("orders, decisions, corrections, questions and reasons", close to verbatim), then anything with lasting effect and what failed, then findings and replies, then tool steps. "Name a minor item in a word or two rather than drop it: an absent item can never be found." "Never make anything look further along than it was." The messages are data: the compactor must never obey them.

**Subagents.** Optional. A subagent is a fresh call whose first message is the view, then its task. Its steps stay in its own log; its final reply comes back as one `work` message. The master never waits for it.

**Rules the author learned the hard way.** One process owns a chat and holds a lock. Never edit or delete a line. Never rebuild the view from the log (the rebuilt view differs and every cache entry dies); save it and load it. No dates or state in the system prompt. A turn waits until every message before it is summarized (seconds). Tool output is clipped to 30,000 characters.

### 2.1 What it implies for the experience of an infinite chat

Inferred unless marked.

**The scrollback is the log; the model's memory is the summaries.** The owner scrolls through the real messages, forever, because the log is complete. The model never sees them whole unless it zooms. Two views of one truth. This is a strength: there is no separate "memory" the owner has to audit, because the memory is readable English about the chat they can see.

**Recall is a visible act.** When the owner asks "what did we decide about the sidebar in March?", Juno zooms a few times. That is a tool loop of a few seconds. The status bubble should say "Looking back to March" rather than three dots, and the answer should cite the day ("On 12 March you said…"), which `date(id)` makes cheap. Clicking the citation scrolls the chat to that message. This is the one place the owner should feel the memory working.

**Precision fades with age by design.** A line that stands for 1,024 messages is 512 bytes. Names and numbers survive ("copy names, numbers, ids, paths and errors exactly") but detail does not, and the gist says an omitted item "is lost for good" from the summary, though zoom can still reach the raw message if some trace of it survives in the line. Observed: the gist's own comment thread raises recall with many interleaved topics as an open question. So the honest promise to the owner is "Juno can find anything we said, and remembers the important things without looking", not "Juno remembers everything".

**"Remember this" is just a message, and that is enough for most things.** The compaction prompt puts the user's words first and keeps corrections close to verbatim, so saying "remember that Maya prefers Wednesdays" survives up the tree. Juno should reply "Noted" and nothing more, like Claude's "remember this" [S12]. Two additions are worth making:

- A **pinned facts** list for the handful of things that must never fade: name, role, people, standing preferences, quiet hours. The gist's `note` kind is the import path for memories from before the chat; a pinned fact is a `note` the owner can see and edit on a "What Juno remembers" page. It is tiny (a few KB) and sits after the system prompt and before the view, so it is in every call and cached. Unknown: whether the author would object; it slightly breaks "the chat is the memory", but it mirrors what every shipping assistant offers.
- A chat-side marker. When Juno writes a pinned fact, the chat shows a small "Remembered" line under the message, the way ChatGPT shows "Memory updated". When it only relies on the log, it shows nothing.

**Forgetting is the hard part.** The log is append-only and the view must never be rebuilt. "Forget that" therefore appends a correction, and the prompt says "its latest word on a thing is the truth", so Juno stops acting on it. But the words are still in the log and in old summaries. For privacy this is not enough: a pasted secret or a message about a person must be removable. Proposal, as a design to verify formally: a **redaction** that replaces one message's text in the log with a tombstone and marks the O(log N) nodes above it dirty, rebuilding only those lines and accepting one cache rewrite for the affected suffix. The chat shows the message as "Removed". The gist forbids this in general; doing it rarely and explicitly, with a spec in Quint for the invariants (every node above a redacted message is rebuilt before the next turn; the view is never reloaded from the log), is the compromise. This is a product requirement, not a nicety.

**Off the record.** Claude's incognito and ChatGPT's temporary chat exist for a reason. In the gist's terms, an off-the-record exchange is simply not logged: Juno answers from the view, the exchange is shown in the chat with a distinct label and vanishes when the window closes. Simple, and worth having before any sync.

**Transparency about what Juno remembers.** Three surfaces, all reading from data that already exists:

1. "What Juno remembers": the pinned facts, editable.
2. "Memory of this chat": the current view, rendered as a timeline of summary lines by day. The owner can read what Juno will see on the next turn, zoom a line (the same tool), and learn that older months are coarser. Nothing to maintain; it is the view.
3. In chat: "What do you remember about X?" answers from the view and says where it looked.

**Latency the owner can feel.** A turn waits until the messages before it are summarized ("seconds"). After a long tool-heavy turn, the next message may wait a few seconds before the model starts. The status bubble's dots cover this, but it should be measured, and a per-turn budget set in `docs/performance.md` terms. Unknown: real numbers for Haiku at the gist's settings on OpenRouter.

**Several devices, one chat.** The gist is explicit: one process owns a chat and holds a lock. The brief wants the same assistant synced everywhere. That is the architecture researcher's problem, but the experience consequence is a state the chat must be able to show: "Juno is working on your Mac" when another device holds the chat, with the log read-only there until it is handed over. Hiding this would be worse than showing it.

## 3. pi's latest version

Observed, from the earendil-works/pi release notes and docs [S18], [S19], [S20], [S21], [S22], [S23]. The coding agent is at v1.2.0 (12 October); the repo moved from badlogic/pi-mono and the npm scope is now `@earendil-works`. Juno currently uses `pi-ai` 1.1.0, the model API package, not the agent.

### 3.1 Durability

Observed:

- Sessions are saved by default as JSONL under `~/.pi/agent/sessions/`, grouped by working directory, with `--session-dir`, `PI_CODING_AGENT_SESSION_DIR` or the `sessionDir` setting to move them, and `--no-session` for ephemeral runs. The file is created when the first user message is sent, so a session is not lost if pi exits before the first reply (v0.99.0).
- The format (version 3) is a tree: every entry has `id`, `parentId` and `timestamp`; types are `message`, `model_change`, `thinking_level_change`, `usage`, `compaction` (with `firstKeptEntryId`), `context_edit` (an append-only change to an earlier entry's contribution to context, raw history unchanged), `branch_summary`, `custom`, `custom_message`, `label` and `session_info`. Resume walks from the leaf to the root, applies the latest compaction and context edits, and converts entries to messages.
- In the SDK, `createAgentSession()` returns a session; `SessionManager` holds the entry tree and the active leaf; `SessionManager.inMemory()` avoids files; `fork()`, `newSession()`, `switchSession()` and `importFromJsonl()` exist; `dispose()` aborts active work.
- Compaction (`compaction.enabled`, `reserveTokens` default 16384, `keepRecentTokens` default 20000) summarizes into structured Markdown (Goal, Constraints, Progress, Key Decisions, Next Steps, Critical Context) and keeps raw history.

Inferred, what this means for the product:

- pi's durability is "nothing you typed is lost and the session resumes where it was". That is exactly the feeling the chat needs after a crash or a laptop sleep: the owner reopens Juno and the status bubble is either gone (the run finished and its result is in the chat) or back (the run resumed). Good.
- pi's compaction and the gist's tree are two memory designs. Running both would confuse the model (two summaries of the same history) and the cache. If the agent is built on the pi SDK, compaction should be off and the view supplied through pi's own entry types, likely `custom_message` for the view and `context_edit` to drop raw messages from context. If it is built on `pi-ai` directly, as `@juno/ai` is today, the loop is Juno's and the question does not arise. Either way the owner never sees compaction. Unknown: whether `custom_message` entries can be made to sit at the right place for prompt caching, which the gist depends on.
- Unknown: the brief says pi has "durability" built in. I found the session tree and the "busy while starting" fix, and a separate `chord` package in the monorepo described in search results as replicated state, but could not confirm what it is or that the agent uses it [S24]. Worth a direct look by the architecture researcher.

### 3.2 MCP

Observed:

- Built in since v0.99.0: servers over stdio or streamable HTTP, with OAuth, from `~/.pi/agent/mcp.json` or `.pi/mcp.json`, managed with `/mcp` and `pi mcp add|remove|list|login|logout`. SDK sessions do not load it by default; add `createMcpExtension()` and call `session.bindExtensions()`.
- Four exposure modes: `codemode` (default; tools are callable from scripts the model writes, not declared to it), `deferred` (loaded by tool search), `direct` (declared like a built-in), `hidden`. Per-tool overrides with `toolExposure`.
- The first prompt waits up to 10 seconds only for servers with `direct` tools; others are awaited when needed. v1.2.0 added `reachesTools` so the MCP extension waits for just the servers a call needs. Failures are reported once; a dropped server reconnects on the next call; HTTP errors retry twice; results over 20 KB are truncated to a temp file; tools are named `mcp__<server>__<tool>`.
- OAuth: when a server rejects an unauthenticated connection, `/mcp` shows that sign-in is needed; `pi mcp login` opens the authorization page and waits; tokens live in `~/.pi/agent/mcp-auth.json` and refresh automatically. v1.0 and v1.1 fixed a run of OAuth edge cases (wrong `iss`, empty scope, step-up scope loops, uncancellable sign-ins).
- Littlebird's MCP is a remote server at `https://mcp.littlebird.ai/mcp` with OAuth, for Power and Pro plans [S25].

Inferred, what feels good or bad:

- Good: `codemode` keeps dozens of MCP tools out of the prompt, so adding Notion and Littlebird does not slow every turn or crowd the model. Good: waiting only for the servers a call needs means a slow Notion never delays "what did I miss in #eng?".
- Good: the OAuth flow is the right shape for a **Connect** card. Bad if left as is: the sign-in URL and "paste the redirected URL" wording are terminal-shaped. Juno must wrap it: one card, one button, the browser opens, the card turns to "Connected".
- Bad: 20 KB truncation and the "once" error report are tuned for a terminal that shows tool output. In a chat that hides tools, Juno has to say in words that a result was cut or a server is down, or the owner will never know.
- Unknown: whether T3 Code's MCP exposes the task and thread tools to a non-T3 client in the same shape this session sees. If yes, "ask Juno to fix something in Juno" is `delegate_task` plus `task_status`, with the thread link in a **Task** card.

### 3.3 Subagents

Observed: pi's README says it "skips features like sub-agents and plan mode" and suggests building or installing them as extensions. Extensions have `ctx.executeTool()` for nested calls, which emit events with `parentToolCallId` and record bounded `nestedCalls` on the parent's result. Virtual models let an extension route each request to a different physical model [S19], [S21].

Inferred: this is a good fit, not a gap. The gist's subagent is a fresh call with the view and a task, reporting back as one `work` message. Nested tool events give the status bubble its text ("T3 Code is running tests") without putting the subagent's transcript in the chat. The product rule from section 1.4 applies: a delegate talks to Juno, Juno talks to the owner.

### 3.4 Steering

Observed: `prompt()` rejects when a session is already streaming unless told to steer or follow up; `steer()` queues after the current assistant turn and its tool calls; `followUp()` queues after pending work; both return `queued` or `handled`. v1.2.0: `pi.sendMessage()` queues into a starting run instead of starting a second one, `sendUserMessage()` requires `deliverAs`, and pending `deliverAs: "nextTurn"` messages are delivered with the custom-message run. `agent_settled` means pi will not continue on its own; `agent_end` can be followed by recovery or queued work [S18], [S19].

Inferred, what feels good or bad:

- Good: steer versus follow-up is the right primitive, and `queued` versus `handled` tells the UI whether to show the grey "not started" state.
- Good: `agent_settled` is the event that should clear the status bubble, not `agent_end`. Clearing on `agent_end` would make the bubble flicker during retries and queued work.
- Bad if exposed: two queue modes are a developer's distinction. The owner gets one behaviour: typing sends, Juno sorts out whether it steers or waits (section 1.7).
- Good: the "busy while starting" change closes a race where a fast second message started a second run. Before it, a chat could have had two status bubbles.

## 4. Trust and safety

Observed inputs: SPEC §15 (no send without a click; global switch), SPEC §17 (undo over confirm), Apple's HIG (confirm significant actions on someone's behalf; never automate destructive or hard-to-undo actions) [S2], Raycast's per-tool rules and impact wording [S13], ChatGPT agent's confirmations, watch mode and takeover [S8], the recommendation to log decisions separately from the transcript [S9], and the gist's compaction rule that messages are data and must never be obeyed [S16].

The rest is Inferred.

### 4.1 Tiers of action

| Tier | Examples | Behaviour |
| --- | --- | --- |
| Read | Read topics, channels, Notion pages, Littlebird data, PR status | No confirmation. Listed in Activity. |
| Reversible, local, only the owner sees it | Resolve, pin, subscribe, ignore, rename a topic, set a schedule | Do it, then an undo line in the chat and ⌘Z, as the toast format does. |
| Outbound or visible to others | Send a Slack message, comment on a PR, edit a shared Notion page, send a notification on the owner's behalf to someone else | A card, every time. No "always allow" for sends. This is SPEC §15 and it should not bend for the agent. |
| Spends money or starts long work | Start a T3 Code session, run a benchmark, a model call above the daily budget | One card at the start showing the brief and the scope; then free to run. Merging or pushing is Tier 3. |
| Destructive or irreversible | Delete, purchase, force push, send to a channel the owner never posts in | Not offered in v1. The catalog has no card for it. |

Raycast's Auto-review rules become a small settings list: per connection and per tool, "Ask", "Ask once per task" or "Auto", with defaults from the table. The owner can tighten; only the first two tiers can be loosened.

### 4.2 Undo

- Every reversible action in chat gets the same undo as the rest of the app, with the same words: "Resolved · Postgres 16 migration plan · Undo".
- Sends have no undo (ADR 0010 decided that), so the card is the only gate.
- Delegated work is undone through its own system: a branch is deleted or a PR closed, by a card, after Juno says what undoing means.

### 4.3 Audit trail

An **Activity** page beside Notifications' Today log, with one row per action: time, what, where, who asked (the owner, a schedule, or Juno on its own), the decision (allowed by rule, confirmed, dismissed, undone, failed) and a link to the chat message. Proactive runs that did nothing still appear here, so "did my watch run?" has an answer without a message in the chat. The log is separate from the chat transcript (as agentpatterns recommends) and is what the owner reads when something looks wrong. It is also the honest record for formal checking: every Tier 2 action in Activity must have a confirmed card in the chat.

### 4.4 Quiet hours and the off switch

- Quiet hours are the ones in Notifications. During them Juno still writes to the chat, never notifies except for rules set to Now, and never performs a Tier 2 action on a schedule; it holds the card until the morning.
- The **global AI assist switch** turns the agent off with everything else: running tasks are stopped with their state written to the chat, schedules show as paused, connections stay signed in. Turning it back on resumes schedules and says so.
- A lighter **Pause Juno** in the chat header stops running work and schedules without touching the rest of the app's AI. Esc stops the current task only.
- A per-connection switch (Notion, Littlebird, T3 Code) disconnects without signing out.

### 4.5 Untrusted content

Slack messages, Notion pages, PR comments and tool results are other people's words. Two rules, both from the gist and ChatGPT agent's monitoring:

- The agent treats them as data. A request found in content never becomes an action without the owner; "Maya says to post the plan in #all" produces a card with a "Because" line, never a post, even if the owner set that tool to Auto.
- The compactor never obeys them either, which the gist's prompt already states.

### 4.6 Secrets and privacy

- Tokens live in the keychain, never in the log. The log clips tool output, and a pasted secret is the first use of redaction (section 2.1).
- The owner can see what leaves the machine: the model provider, the connections, and in the Connect card what scope was granted. Apple's "show them what's shared".
- The agent identifies itself. Anything Juno sends on the owner's behalf is written by the owner in the card or clearly marked as from Juno; it never pretends to be the owner in a channel (Linear's disclosure rule, SPEC's "AI manages, you write").

## 5. Visual design direction

Observed inputs: `tokens.md` (Figtree, Coral `--hl` #CC4628 light and #FF8A73 dark, `--hl-fg`, paper #FCFBF7 and the warm near-black dark palette, `--radius-bubble` 16 with a 4px tail corner, `--radius-palette` 14 for the user bubble, `--radius-card` 20, `--radius-tag` and `--radius-pill` 999), `friendly-layer.md` (motion tokens, the `juno` illustration at 40px and the 28px avatar mark without the warm layer, duotone for Juno surfaces, no character in chrome), and `inventory.md` §6.11 and §12 (the bubble style for Slack messages and the current Juno chat).

The rest is Inferred. Every value below is a token already in `tokens.md`; nothing new is needed except a status bubble variant.

**Bubbles.** Both sides in bubbles, as the brief asks, and with the same rules as the Slack bubble style so the two feel like one family:

- Owner: `--hl` fill, `--hl-fg` text, `--radius-bubble` 16 with the 4px tail on the bottom-right of the last bubble in a group, max-width 76%, 14px at line-height 1.55, padding 8 12. Coral on paper reads warm, not loud, because there is only ever one coral bubble group at a time next to Juno's grey ones. Ink accent users get near-black bubbles, which is iMessage's dark-mode look.
- Juno: `--surface-hover` fill, `--foreground-default` text, tail bottom-left, same sizes. Plain text, line breaks allowed, simple "- " lists allowed and rendered as plain lines; no headings, bold or code in bubbles. Links are never raw URLs; they are a Topics card or a word underlined in `--hl-text`.
- Grouping: consecutive messages from the same side within two minutes form a group; only the last has the tail; the 28px Juno mark shows beside the last bubble of a Juno group (the row reserves the space otherwise, as §6.11 does with avatars).

**Typing and working.** One status bubble, Juno's colour and shape, holding three 6px dots in `--foreground-muted`. The dots rise and fall in sequence over `--duration-pop` on `--ease-out`, looping, and are static under reduced motion. When a specific status is known, the dots stay and a 13px muted line follows them: "Reading #eng". A **Stop** text button in `--hl-text` appears at the right of the bubble on hover or keyboard focus. When Juno starts to answer, the status bubble becomes the first reply bubble in place (no new element, no layout jump; the bubble is laid out at the status line's height and grows with the text, which is allowed because the text streams).

**Read and queued states.** Under the owner's last bubble only, an 11px `--foreground-muted` line, right-aligned, tabular figures: nothing in the normal case (the status bubble is the acknowledgement); "Queued" while Juno is busy and has not read it, with the bubble at 70% opacity; "Not delivered · Try again" in `--destructive`-tinted text when the provider failed. No "Read", because Juno reads everything, and no checkmarks.

**Cards.** Under Juno's last bubble, full column width up to 560px, `--radius-card` 20, `--surface-default` fill with the friendly layer's wide soft shadow instead of a ring, padding 12, 13.5px text. Header 12px muted with the context pill where there is a target. Buttons are the existing primitives: primary pill in `--hl`, secondary `--secondary-default`, Dismiss ghost. The status after action replaces the footer ("Sent 13:45 · Open"). Cards do not animate in beyond the standard `--duration-appear` fade; they are laid out at full height (performance rule 3.3).

**Proactive label.** Above a proactive Juno group, an 11px uppercase label in `--foreground-muted` with 0.06em tracking, the same role as the "3 NEW" divider: "SCHEDULED · DAILY CATCH-UP". Hover shows "Why this?" and "Stop these" as text buttons.

**Timestamps and day separators.** Times are hidden. Hovering a bubble shows its time in 11px muted at the outer edge, like §6.11's time inside own bubbles. Day separators are centred, 11.5px, `--foreground-muted`, with the relative-time words from SPEC §17: "Today", "Yesterday", then "Mon 6 Oct", and the year only when it is not this year. A separator also marks a gap longer than an hour within a day, with the time ("14:10"), which is how iMessage keeps a long single thread readable.

**Scrolling and the bottom.** New messages do not auto-scroll if the owner has scrolled up; a pill "New message" in `--surface-raised` with the soft shadow sits at the bottom, 999 radius, and jumps on click. The chat opens at the bottom, at the last unread Juno message if any, with the same "new" divider style as topics.

**Empty state.** Keep "What do you need?" in Instrument Serif at 40px with the `juno` illustration above it (friendly layer §6) and the four suggestion chips. The chips become pills (`--radius-tag`).

**The mascot.** The seated j is Juno's avatar: the 28px mark beside Juno's groups, the 40px illustration in the empty state, and on the living home. It does not react, nod or animate; the friendly layer allows motion only on things the owner does. In the sidebar's Juno row and the tab, the icon stays the duotone sparkle, so the character is met only inside the chat (friendly layer §8: no character in chrome). Dark mode: the mark in `--foreground-subtle` on `--surface-hover`, no warm layer.

**Dark mode.** Owner bubbles `#FF8A73` with `#2A0D06` text (7.9:1); Juno bubbles `--surface-hover` #2D2B28 on the #1B1916 page; cards on `--surface-default` #252421. Theme switches suppress transitions as elsewhere.

**Motion summary.** Dots loop; status text swaps with a 150ms cross-fade; new bubbles fade in over `--duration-appear` with no slide; the undo line and the "Remembered" line appear without animation. Nothing else moves.

## 6. Recommended UX spec outline

A section list for the Juno Agent chapter of SPEC.md, in the order a reader needs it.

1. **What Juno Agent is.** One infinite chat with an assistant that acts for the owner through connections. Portable: the same chat on every surface.
2. **The chat.** Four kinds of thing on screen (owner, Juno, one status bubble, separators). Bubbles, grouping, times, separators, the empty state, scroll behaviour, the mascot.
3. **Working.** Acknowledge within a second; specific status text; update in place; milestones as messages; one "still on it" per quiet stretch; Stop; what stopping keeps.
4. **Cards.** The fixed catalog (Send message, Resolve, Topics, Task, Question, Schedule, Connect, Change), the status after action, the "Because" line, click-only consent for sends, keyboard reach.
5. **Delegated work.** Juno speaks for its delegates; one message per milestone; "Show details"; batching of simultaneous reports; asking "how is it going".
6. **Proactive.** The Scheduled list; the label; monitors speak only on change; routing through Now, Digest, Silent and quiet hours; self-pausing schedules; never an action without a click.
7. **Steering and interruptions.** Typing sends; the queued look; Juno's acknowledgement; Stop and Esc; Juno never speaks over its own open question.
8. **Failures.** The one-message rule; what is kept safe; Connect cards for sign-in; "Not delivered"; silence as a failure.
9. **Memory.** The log and the view, in owner's words; recall with citations; "remember this" and pinned facts; "forget" as correction and as redaction; off the record; the three transparency surfaces; the one-device-at-a-time state.
10. **Trust.** The action tiers; undo; the Activity page; quiet hours; the global switch, Pause Juno and per-connection switches; untrusted content; secrets.
11. **Settings.** Providers and models; connections; per-tool rules; schedules; memory pages.
12. **Writing.** The friendly layer's voice, plus: Juno says "I" only in the chat; status lines are present tense and name real things; cards use verb-first buttons.
13. **Performance budgets.** First dots under 100ms; first status text or token under 1.5s; status update rate; the post-turn summarization wait; the memory page render.
14. **Not in v1.** Destructive actions, money, mobile, multi-owner chats, watch mode.

## 7. Risks

- **Two memories.** If the agent runs on the pi SDK with compaction on, pi's summary and the gist's tree will disagree and the cache will thrash. Decide one, early.
- **Forgetting is unsolved in the gist.** Append-only plus "never rebuild the view" means true deletion needs a redaction design the author did not write. Without it, the privacy story fails on the first pasted secret. Spec it in Quint before building sync.
- **One writer, many devices.** The gist requires a single process holding a lock. "Synced everywhere" either means one always-on home for the chat or a handover protocol. The chat must be able to show "busy elsewhere" either way.
- **Noise is one setting away.** The agent can schedule itself. Without the self-pause, the change-only rule and the digest routing, the chat becomes a feed, which is what ChatGPT just removed.
- **Consent fatigue versus SPEC §15.** Every send needs a click. If Juno proposes many sends, the owner will stop reading cards. Keep proposals rare and merged (one card with several messages is better than five cards), and never make a card the way to say "no".
- **Prompt injection through Slack.** The agent reads other people's messages all day. The "Because" line and the data-not-orders rule are the whole defence in the UI; they need tests with hostile fixtures in the fake Slack server.
- **Tool output hidden means errors hidden.** pi reports MCP failures once and truncates results. If Juno does not translate those into words, the owner sees confident answers built on cut data.
- **Latency of the summarize-then-turn wait.** A few seconds after every heavy turn is fine once and tiring always. Measure before committing to the gist's "wait until summarized" rule, or pre-start the compactions as the gist suggests.
- **Coral bubbles.** The warmest colour in the app, on the surface the owner looks at most. Mock it in both themes next to a Slack DM in bubble style before deciding; the fallback is `--secondary-default` for the owner's bubbles, as the current inventory has.
- **The mascot's charm wears.** A character beside every reply can turn twee. Showing it once per group and never animating it is the guard; test it in a long transcript, not a mock with three messages.
- **pi moves fast.** Thirteen releases in two weeks, two with breaking changes to message delivery. Pin the version and wrap steer, follow-up and settle in Juno's own types so release churn stays out of the UI.

## Sources

- [S1] Apple, iPad User Guide, "iMessage and SMS/MMS" and Messages features: https://support.apple.com/bn-in/guide/ipad/aside/ipad588594f8/16.0/ipados/16.0
- [S2] Apple Human Interface Guidelines, "Generative AI" (changed June 8, 2026): https://developer.apple.com/design/human-interface-guidelines/generative-ai
- [S3] Linear, Agent Interaction Guidelines: https://linear.app/developers/aig
- [S4] Linear, Developing the agent interaction (activity types, session states, 10 second rule): https://linear.app/developers/agent-interaction
- [S5] Linear changelog, 2025-07-30, agent interaction guidelines and SDK: https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk
- [S6] 9to5Mac, "OpenAI launches scheduled tasks in ChatGPT", 2026-06-17: https://9to5mac.com/2026/06/17/openai-launches-scheduled-tasks-in-chatgpt-details-here/
- [S7] OpenAI help, Scheduled tasks (403 on fetch; cited through [S6]): https://help.openai.com/en/articles/10291617
- [S8] OpenAI help, ChatGPT agent (safeguards, watch mode), as reported: https://help.openai.com/en/articles/11752874-chatgpt-agent and https://sdtimes.com/ai/chatgpt-now-has-an-agent-mode/
- [S9] agentpatterns.ai, Human-in-the-loop confirmation gates: https://agentpatterns.ai/security/human-in-the-loop-confirmation-gates/
- [S10] Claude Code docs, Interactive mode (queue messages while Claude works, Esc, send now): https://code.claude.com/docs/en/interactive-mode
- [S11] Claude Code release v2.1.198 (background subagents by default, focus mode folding): https://github.com/anthropics/claude-code/releases/tag/v2.1.198
- [S12] Anthropic help, Managing memory in Claude: https://support.claude.com/en/articles/11817273
- [S13] Raycast changelog v2.3 (tool approval wording, Auto mode, auto-review rules, stop and ask): https://www.raycast.com/changelog/macos/2-3
- [S14] Raycast changelog v1.98 (MCP, Confirm Always): https://www.raycast.com/changelog/1-98-0
- [S15] Codex Cloud and Devin, secondary reports: https://codex.danielvaughan.com/2026/10/08/openai-devday-2026-recap-codex-cloud-agents-view-gpt61-sol-code-review-security-cloud/ and https://releases.sh/collections/coding-agents/digest/2026-09-28.md
- [S16] Victor Taelin, "UniiChat: one chat that never ends" (the optmem gist): https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449
- [S17] Vercel Labs, json-render README: https://github.com/vercel-labs/json-render
- [S18] earendil-works/pi releases (v0.99.0 to v1.2.0): https://github.com/earendil-works/pi/releases
- [S19] pi docs, SDK: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- [S20] pi docs, MCP: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md
- [S21] pi, coding-agent README: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md
- [S22] pi docs, Sessions and Session format: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md and docs/session-format.md
- [S23] pi docs, Compaction: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md
- [S24] Search result mentioning `@earendil-works/chord` replicated state in the pi monorepo (unverified): https://github.com/badlogic/pi-mono
- [S25] Littlebird docs, MCP: https://docs.littlebird.ai/docs/mcp/
- Repo: `docs/juno-agent/BRIEF.md`, `docs/design/handoff/SPEC.md` §12 to §17, `docs/design/friendly-layer.md`, `docs/design/tokens.md`, `docs/design/inventory.md` §6.11 and §12, `docs/decision-log.md`, `docs/architecture.md`, `packages/ai/README.md`.
