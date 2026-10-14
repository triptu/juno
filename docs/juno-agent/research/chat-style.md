# Juno Agent: how the chat talks and feels

> **Superseded in part (owner, 10-14).** The owner's decisions after reading this proposal replace its limits and its fixed reaction set: no length, count or splitting limits on bubbles and no post-check that splits or strips them (the model decides); any emoji as a reaction, both ways, instead of the six Tapbacks; the owner's thumbs up is only recorded and any other reaction goes to Juno, which may ignore it; Juno may use any emoji; no 350 ms spacing; and bubbles are marked with `<say>` blocks rather than blank lines and `⟦ ⟧` directives. The rest (whole bubbles with dots between, replies both ways, a reply or reaction is never a click) is in SPEC §13 and plan v3 O5 to O7. Read this file as background.

A proposal, not a decision. It covers how Juno shapes its replies (short bubbles), reactions both ways, and replies to a specific message. It builds on the owner's decisions of 10-14 (`docs/decision-log.md`): the chat works like iMessage, there is no Stop, the core has two inputs (queue a message, listen to events), the owner bubble is option B, Juno says "I", and action cards take one click.

Sources: OpenInstinct at commit `0c2a7c6` (read only, not run), SPEC §13 and §17, plan v3 §4, §5, §8 and §13, `packages/agent-contract/src/chat/`, `packages/agent/README.md` (Turns), `packages/agent/src/request/prompt.ts`, and `docs/design/juno-chat/`.

## 1. What OpenInstinct does

OpenInstinct is a personal assistant that lives in an iMessage thread (through Linq) and in a web chat. Its whole conversation style is in a few files.

### 1.1 Message style rules

`agent/instructions/content/message-style.md` and `agent/instructions/content/role/interactive.md` hold the rules. The ones that matter here:

- Length: "Lead with the answer or recommendation. Keep most messages to one to four compact lines" and "Two or three sentences is a normal conversational reply. Use more when the user needs a comparison, a consequential decision payload, or a clear account of completed work."
- Splitting: "Give genuinely separate conversational acts separate calls, such as a result followed by an approval question, but do not fragment one thought or send play-by-play narration."
- Acknowledging work: "Keep a work acknowledgement to one short sentence. ... Do not restate the full request, narrate the search methodology, announce that you will optimize, or add decorative copy."
- No false progress: "Never say or imply that work is underway, or promise that you will do it next, unless you actually call the relevant tool or start the worker in that model step."
- No filler: "End with the exact next action or decision when useful, never a generic offer to help with something else."
- Plain text: no Markdown; "write a bullet as a line starting with `•` when a list truly helps", URLs bare on their own line.
- Tone: "a sharp, capable friend ... lightly funny when it fits", "casual lowercase", emoji "rarely unless the user uses them first".
- Background work: "Keep intermediate background-task wakes silent unless the user must act." The result comes as one message, plus "a separate follow-up message when the user has a distinct choice or approval to make".

### 1.2 Delivery is a tool, not the model's text

`agent/tools/messaging.ts` defines `send_message`: "Send exactly one user-visible message to the current conversation." The model's ordinary text is internal and never shown ("Ordinary assistant text is internal and is never user-visible"). One bubble is one tool call. Its schema (`shared/chat/message-delivery.ts`) caps text at 20,000 characters, so length is not enforced by the schema; it is left to the prompt and the evals.

To end a turn after delivering, the prompt tells the model to "emit only `DELIVERY_COMPLETE`". This is a workaround for a runtime that wants final text after the last tool call, and it costs one more model request per turn.

Pacing and typing are not designed by OpenInstinct: "Eve and Linq own read receipts, typing indicators, delivery state". The one idea there is that the short phrase the model writes before a tool call becomes the live typing status, not a message.

### 1.3 Reactions

`shared/chat/reaction.ts` is a closed set of six, the iMessage Tapbacks:

```ts
z.enum(["thumbs_up", "thumbs_down", "heart", "laugh", "exclamation", "question"])
```

`react_to_message` (in `messaging.ts`) adds or removes one on the user's current message: "Use this instead of send_message when a reaction fully communicates a lightweight acknowledgement and words would add nothing." The rule in `interactive.md`: on every user turn, send a message, "or use `react_to_message` alone when a lightweight reaction fully answers the user". In the web chat a reaction renders as a compact line (`message-events.ts`, `reactionTextFor`).

The other direction is missing: I found no code that reads the user's Tapbacks on the assistant's messages (`agent/channels/linq.ts` only sends them).

### 1.4 Replies

`send_message` takes `replyTo`: the current user message, a background task, or an automation (`shared/chat/message-delivery.ts`). `agent/lib/reply-targets.ts` remembers which user message started each background task, so a result that arrives after the conversation moved on is threaded under the request that caused it. If the target is gone, it falls back to a plain message.

### 1.5 Evals

`evals/agent/conversation.eval.ts` is the useful part. It pairs a deterministic check with a model judge:

- A summary of research must name the best option, be at most 400 characters and 4 lines, and contain no URL; a judge then checks that it "reads like a brief natural text message".
- "perfect, thanks!" must produce one `react_to_message` (heart or thumbs up) and no `send_message`.
- "thanks! what is 9 multiplied by 8?" must produce words and no reaction.
- A recommendation must commit to one option (judge).
- Replies: a delayed task result replies to its task; an announcement replies to nothing.

### 1.6 Worth copying, and not

Copy:

1. **A reaction as the whole answer** when words would add nothing, with the paired eval (thanks → reaction; thanks plus a question → words).
2. **A closed set of six reactions.** The model cannot invent one, and each has a fixed meaning.
3. **"Separate acts, separate messages; never fragment one thought."** This is the right splitting rule, better than a character count alone.
4. **The prompt rules** on leading with the answer, one-sentence work acknowledgements, no false progress, and no generic offers.
5. **Evals that measure length with code** and judge tone with a model.
6. **`•` lines** as the only list form in plain text.

Do not copy:

1. **Delivery through a tool with hidden model text.** Each turn costs an extra request, and the `DELIVERY_COMPLETE` workaround shows the strain. Juno already streams text through pi and must also work with the Codex harness. Juno splits text it already has (§2.1).
2. **Humour, lowercase and emoji in the text.** SPEC §13.11 says Juno never jokes or exclaims, and §17 forbids emoji in chrome. Juno's voice stays plain.
3. **Reply-to-current on every message.** In a two-person chat, a quote on every bubble is noise. Juno quotes only when it would otherwise be unclear (§2.4).
4. **Model-written typing status.** Juno's status lines come from the tools and count real things (SPEC §13.2). That is more honest than a phrase the model writes.

## 2. Proposal for Juno

### 2.1 Message shape

**A reply is a few short bubbles.** One idea per bubble, as a person texts.

- **Splitting.** The model separates bubbles with a blank line. Each bubble is one act: the answer, a reason, a question, a heads-up. Don't split a sentence or one thought across bubbles.
- **Length.** A bubble aims for one or two sentences, at most 280 characters. Most replies are one to three bubbles. More than four means the content belongs in a card or should be offered ("I found 9 more. Want them?").
- **Lead with the answer.** The first bubble is the answer or the result. No preamble ("Sure", "Great question", "Let me look"), and no recap of the question.
- **Cards replace text.** When a card shows the content (a draft in a Send message card, a Task, a Schedule), the bubble above it is one short line ("Here's a reply for #eng.") and never repeats what the card shows.
- **Lists.** Up to five `•` lines in one bubble, one line each. Topics go in a Topics card, never as a list of names. Longer lists are a card or an offer.
- **Links to Slack.** Juno never writes a URL or a raw id. It points at a Slack message or topic it read with a short handle the builder gave it (§3.3). The view renders the handle as a link on the cited words; a click opens the topic at the message. An unknown handle renders as plain text. Recall citations to the chat ("On 12 Mar you said …") stay as they are.
- **No closers.** No "Let me know if you need anything else". End with the next action only when there is one ("Want me to send it?").

**Pacing.** A bubble appears whole, as in iMessage, not word by word:

- The status bubble (typing dots) shows until a bubble is complete, then that bubble replaces it in place, and the dots come back below while Juno writes the next one.
- A bubble is complete at the blank line that ends it, or at the end of the run.
- Bubbles that are ready at once are spaced 350 ms apart, so three bubbles read as three texts and not one block. No other delay: Juno never waits on purpose to look like it is typing.
- Status text ("Reading 3 topics") works as today, between bubbles.
- Under reduced motion the bubbles appear with no movement, at the same times.

This changes SPEC §13.2's "one reply is one bubble however many steps it took" and the 1.5 s first-token budget (§13.12). The new budget would be the first bubble, not the first token (open question 2).

**How it is enforced.** Four layers, from cheapest to strictest:

1. **Prompt.** `JUNO_INSTRUCTIONS` gains a short style block (§2.6). It replaces "Be brief and specific."
2. **Markup the model writes, parsed by Juno.** No JSON mode: text keeps streaming and works the same on every provider and on Codex. The model writes plain text with blank lines between bubbles and three small directives in `⟦ ⟧` brackets (§3.3). The projector parses them; the renderer never sees raw markup.
3. **A post-check in the projector**, deterministic, on every bubble:
   - Over 400 characters: split at the last sentence end before 280, else at a word.
   - Markdown marks (`**`, `#` at line start, backticks, `[text](url)`): stripped.
   - Emoji in text: stripped (emoji live only in reactions).
   - A directive that does not parse, or names an unknown handle: dropped, the words kept.
   Each fix is counted per run in Activity's details (`style.split`, `style.stripped`, `style.directiveDropped`), so drift shows up.
4. **An eval**, `chat-style`, in the agent's eval set (§2.7).

### 2.2 Reactions

**One set, the six iMessage Tapbacks: 👍 👎 ❤️ 😂 ‼️ ❓.** A fixed set keeps the meaning clear to Juno, keeps the picker one row, and matches what the owner knows from Messages.

**Reactions are content, not chrome.** SPEC §17's "no emoji in chrome" covers the app's own labels, buttons and lines. A reaction is something one person in the conversation says to the other, like the text of a message, so it shows as the emoji. The app's own UI around it (the picker button, the menu item "React") stays text and icons with no emoji. SPEC §13.1's "Juno writes ... no emoji" still holds for Juno's text; Juno's reactions are separate from its text.

**The owner reacts to a Juno bubble.**

- How: hover a bubble and click the reaction button at its edge, or right-click › React, or ⌘T on the focused bubble (as in Messages). The picker shows the six in a row. One reaction per person per bubble; picking another replaces it, picking the same one removes it.
- Cards take no reactions. A card's buttons are its answer, and a 👍 next to a Send button would look like approval.
- **A reaction is never a click.** 👍 under "Want me to send it?" does not send; the card's Send does. This is the same rule as "typing yes is not a click" (SPEC §13.3).
- **A reaction does not start a run,** except ❓. It enters the inbox as a durable op (so it survives a crash and syncs to the backup like a message) and Juno sees it at its next turn. Starting a run for a 👍 would cost money and invite a reply to a reply.
- **❓ starts a run.** It asks "I don't follow". Juno answers that bubble in other words, replying to it (§2.4). This is the one reaction that needs an answer, the way a person would answer it.
- What each means to Juno, written into the prompt:

| Reaction | Means | Juno does |
| --- | --- | --- |
| 👍 | Seen, agreed, fine | Nothing now. Treats the point as settled |
| 👎 | Wrong or not useful | Nothing now. At the next turn it does not build on that bubble, and if it is still relevant, it corrects it briefly |
| ❤️ | Thanks, liked it | Nothing |
| 😂 | Funny | Nothing |
| ‼️ | This is important | Nothing now. The compactor keeps the point in the summary (§3.4) |
| ❓ | I don't follow | Starts a run: re-explains that bubble, as a reply to it |

- **Memory.** Reactions never make pins: pins come only from the owner's own words (plan v3 §4.4). Reactions are short records the compactor reads with the messages around them, so a summary can say "the owner marked the Friday deadline as important" or "the owner disagreed with the estimate".
- **Removing** a reaction is recorded too. Juno sees the latest state at its next turn.

**Juno reacts to the owner's message.** Juno uses only 👍. A ❤️ from an assistant reads as performed warmth; 😂 is a joke, and Juno does not joke (SPEC §13.11); 👎, ‼️ and ❓ need words to be useful.

- **Instead of a reply** when the message needs no answer: "thanks", "ok", "got it", "done", "perfect". The run ends with only the 👍 on the owner's bubble. No "You're welcome", no "Anything else?".
- **Words, not a reaction,** whenever there is anything to say: a question, a correction, new information, or a request. "thanks, and can you also check #ops?" gets words.
- **As the acknowledgement of a steer.** When the owner sends "also check #ops" while Juno is working, Juno reacts 👍 when the message joins the run, and its reply then reflects it. This replaces "Juno acknowledges it in its reply" (SPEC §13.5) with something lighter. Only one 👍 per owner message, and never 👍 and the same acknowledgement in words.
- A reaction-only run shows the dots like any run, then the dots go and the 👍 lands on the owner's bubble. The run costs one model request, as today.

### 2.3 What feels human, and what to skip

Keep or add:

- Whole bubbles with short gaps, and the dots between them (§2.1).
- Bubble grouping and the tail as today (2 minutes, same origin), applied per bubble.
- Reactions both ways and replies (§2.2, §2.4).
- Juno's silence on "thanks" (a 👍, not a message).

Skip:

- **Read receipts** ("Read 9:41"). Juno reads at once, so a receipt says nothing; and showing which of Juno's messages the owner read would make the owner feel watched. The "New" divider already covers unread.
- **"Delivered" under every bubble.** The owner's bubble already has its delivery line only when something is not normal (Queued, Waiting, Not delivered). Adding "Delivered" to the normal case is noise.
- **Editing a sent message.** The model has already read the original; an edit would change history under it. The owner sends a correction instead, which is how the chat already steers.
- **Unsend.** Remove already exists and does more (it redacts memory). A second, weaker "unsend" would confuse the two.
- **Typing awareness** (Juno seeing that the owner is typing). It adds a signal to the run loop for no gain.
- **Juno replying with stickers, GIFs, or emoji in text.** Against SPEC §13.11 and §17.

### 2.4 Replies

**The owner replies to a Juno bubble or a card.**

- How: hover › Reply, or right-click › Reply. The composer shows the quoted item above the field, with a close button; Esc clears it.
- The sent bubble shows a one-line quote above it: the first line of the bubble ("Juno: The deploy is green on staging…") or the card's title ("Send message card · #eng"). A click scrolls to the original and flashes it.
- The model gets the referenced item in full (§3.3), even when it is old enough to have been summarized, so "this one" is never a guess.
- **A reply to a card is not a click.** "send it" as a reply to a Send message card does not send. Juno answers in words, and if the card is gone or expired, it offers a fresh card. A reply to an expired card works like Ask again.
- Reply to a removed message: the quote reads "Removed" and the model is told the item was removed.

**Juno replies to one specific owner message.** Only when the reply would otherwise be unclear:

- Two or more owner messages arrived since Juno's last bubble, and this bubble answers one that is not the latest.
- Or it answers an older message the conversation has moved past (a job that finishes hours later can quote the request that started it, as OpenInstinct does).

In the common case, one question and its answer, there is no quote. The quote on Juno's bubble looks the same as the owner's.

**Replies and steering.** A reply sent while Juno is working is a steer like any message: it joins the run at the next step, carrying its reference. Juno can answer it in the same run, quoting it if other messages are waiting too. A reply to a bubble from the current run works the same; the bubble is already in the run's context, so the builder only labels it.

### 2.5 Steering, with the new pieces

- A message sent mid-run: "Queued" after 500 ms as today; Juno 👍s it when it joins the run (§2.2); the reply covers it, quoting it if needed (§2.4).
- Several messages sent quickly: they join together. Juno answers them in order, one or two bubbles each, quoting each answer that is not about the latest message.
- A ❓ mid-run is a steer too.

### 2.6 The prompt block

Replaces "Write plain text: no markdown and no emoji. Be brief and specific." in `packages/agent/src/request/prompt.ts`. Draft:

```
You write like a person texting: short bubbles, plain words, no markdown, no emoji.
Put a blank line between bubbles. Each bubble is one idea, one or two sentences, under 280 characters.
Most replies are one to three bubbles. If you have more, use a card or offer the rest.
Lead with the answer. No preamble, no recap of the question, no closing offer.
When a card shows something, say one short line about it and do not repeat it.
Say that work is underway only after you have started it.
Lists: up to five lines starting with "• ". Never write a URL or an id; cite with ⟦h3|words⟧.
If a message needs no answer (thanks, ok, done), react instead: ⟦react n3 👍⟧ and nothing else.
When a message joins while you work, react ⟦react nN 👍⟧ once, then carry on.
If you answer a message that is not the latest one, start that bubble with ⟦re nN⟧.
Owner reactions: 👍 agreed, 👎 wrong, ❤️ thanks, 😂 funny, ‼️ important, ❓ explain this again.
```

The wording is a starting point; the eval decides.

### 2.7 The eval

A `chat-style` suite next to the recall eval, in the same form as OpenInstinct's: scripted conversations through the real builder and projector against the chosen chat model, with code checks first and a judge second.

Code checks, on the parsed bubbles:

- Every bubble at most 280 characters before the post-check; the post-check fired on fewer than 5% of bubbles across the suite.
- No markdown, emoji, URL or raw id in text; no directive dropped.
- No banned opener or closer (a short list: "Sure", "Great question", "Certainly", "Let me know if", "Anything else", "Happy to help").
- Cases:
  - "thanks" after an answer → one 👍 reaction, no bubble.
  - "thanks, and what's on #ops?" → bubbles, no reaction.
  - A catch-up over 9 topics → at most four bubbles plus a Topics card.
  - A drafted Slack reply → one line plus a Send message card; the draft's text does not appear in the bubble.
  - Two queued questions answered in reverse order → the first answer carries ⟦re⟧ for the older message.
  - A ❓ on a bubble → one or two bubbles that reply to it and do not repeat it word for word.
  - A 👎 on an estimate → the next answer does not reuse it.

Judge checks: leads with the answer; one idea per bubble; reads like a text from a capable colleague; nothing that a card already shows.

Run it on every change to the prompt block and before changing the default chat model. Report the bubble-length distribution and the post-check rates along with pass or fail.

## 3. Contract and data changes

Shapes and names only; WP owners settle the details.

### 3.1 Chat items (`packages/agent-contract/src/chat/items.ts`)

- **`JunoBubbleItem`** replaces the body of `JunoMessageItem` as the row the list renders. One bubble is one row, which keeps rows short for the virtual list and gives reactions and replies a target.
  - `id: BubbleId` (new branded id: the message id and the bubble's index, stable because the parse is deterministic)
  - `messageId`, `runId`, `at`, `origin`, `group`, `unread`
  - `body: JunoInline[]`
  - `replyTo?: QuoteRef`
  - `reactions: Reaction[]`
- **`JunoMessageItem`** keeps what belongs to the whole reply: `cards`, `ending`, and the run identity. It renders as the card stack and ending line after the last bubble; with no cards and a `complete` ending it renders nothing.
- **`JunoInline`** gains `{ _tag: 'slack', text, target: OpenTarget }` for a cited Slack message or topic.
- **`OwnerMessageItem`** gains `replyTo?: QuoteRef` and `reactions: Reaction[]`.
- **`QuoteRef`**: `{ target: { _tag: 'bubble', id: BubbleId } | { _tag: 'card', id: CardId } | { _tag: 'owner', id: ChatMessageId }, preview: string, removed?: true }`. `preview` is the one line the quote shows, computed by the agent.
- **`Reaction`**: `{ by: 'owner' | 'juno', kind: ReactionKind }`, at most one per `by`.
- **`ReactionKind`**: `Schema.Literals(['like', 'dislike', 'love', 'laugh', 'emphasis', 'question'])`. The emoji is a view mapping; the model and the archive store the name.
- Read tracking moves to the bubble: a bubble is read after one second fully on screen. A long reply no longer has to fit the viewport to count as read.
- `chatCopy` gains: `reply: 'Reply'`, `react: 'React'`, `quoteRemoved: 'Removed'`, the `Juno` sender name for a quote, and accessible names for each reaction ("Liked", "Disliked", "Loved", "Laughed at", "Emphasized", "Questioned", as Messages reads them).

### 3.2 Inputs and events

The core keeps its two inputs. Both new owner actions go through the inbox like a message, with an `op_id`:

- `send` gains `replyTo?: QuoteTarget`.
- New inbox kind `react`: `{ target: BubbleId | ChatMessageId, kind: ReactionKind | null }` (null removes). The router stores it and starts a run only for `question`. Paused, offline and recovery states accept it like a message.

Turn events (`packages/agent/src/router/events.ts`):

- `bubble`: `{ runId, id: BubbleId, index, body, replyTo? }` when a bubble is complete. Replaces `text` for the chat. Keep `text` only if another surface needs raw streaming.
- `reaction`: `{ target, by, kind | null }`, for both directions.
- `status`, `queued`, `steered`, `remembered`, `ended` as today. `steered` is when Juno's 👍 can land.

### 3.3 The request builder's view

- **Handles.** The builder labels what the model can point at with short handles per request: owner messages `n1…`, Juno bubbles `b1…`, cards `c1…`, Slack messages and topics read in this run `h1…`. The projector resolves them back through a table the builder writes with the request. The model never sees or writes a real id.
- **Owner messages** render as `<owner n="3" replying-to="b7">…</owner>`. If the target is outside the tail and the active run, the builder appends the target's full text (a bubble, at most 2 KB) or a card summary (kind, title, status: "Send message card for #eng, failed"). The cost sits inside the active-run cap (plan v3 §5.2).
- **Reactions** render as a line at the time they happened: `(owner reacted 👍 to b7: "The deploy is green on staging")`, with the first 60 characters of the bubble. A removal renders as `(owner removed 👍 from b7)`. Within the active run, only the latest state per bubble is shown.
- **Juno's own reactions** render the same way, so the model knows it already acknowledged a message.
- **Directives** the model writes: `⟦re nN⟧` at the start of a bubble, `⟦react nN like⟧` (or the emoji) as its own paragraph, and `⟦hN|words⟧` inline. The projector parses them; the archive keeps the raw text, so a re-parse gives the same bubbles.

### 3.4 Records and memory

- `messages` (plan v3 §4.1): a `juno` row stores the raw text with directives; bubbles are derived, not stored. A `user` row gains `reply_to` (the target and its kind).
- New table `reactions(op_id, target_kind, target_id, bubble_index, by, kind, at)`, append-only, `kind` null for removal. Replicated with the archive, so backup and move carry it.
- **Compaction** reads reactions in its window as short lines, so a summary keeps `emphasis` and `dislike` when they matter. Reactions do not change `gen`; they are new archive input like a message.
- **Redaction.** Removing a message removes reactions on it and on its bubbles, and replies that quote it show "Removed". Reactions hold no text, so they do not taint summaries beyond the message they point at.
- **Pins** are unchanged: never from a reaction.

### 3.5 Views and gallery states for WP12

New or changed views: `JunoBubble`, `OwnerBubble` with quote and reactions, `ReactionBadge` (sits on the bubble's top corner, owner's on the left of Juno's bubbles, Juno's on the right of the owner's, as Messages places them), `ReactionPicker` (one row of six), `QuoteStub` (above a bubble and above the composer), and the hover actions (React, Reply) beside a bubble.

Gallery states, each in light and dark:

1. A three-bubble Juno reply with the tail on the last, and the mark beside it.
2. Juno bubble with each of the six owner reactions.
3. Owner bubble with Juno's 👍.
4. A reaction-only run: dots, then the dots gone and 👍 on the owner bubble (as a two-frame filmstrip in the feel suite).
5. A bubble arriving while two are already shown, with the dots below (the 350 ms gap).
6. Owner reply quoting a Juno bubble; quoting a card; quoting a removed message.
7. Juno bubble quoting an older owner message among three queued ones.
8. Composer with a quote attached.
9. The picker open over a bubble, with one reaction already chosen.
10. A bubble with five `•` lines, and one with a Slack citation.
11. A one-line bubble followed by a Send message card.
12. The longest allowed bubble (280 characters) and a long unbroken word, at the 336 px minimum width.
13. Reduced motion for 4 and 5.

Performance: a reaction appears on the bubble within one frame of the click, before the inbox commit, as an owner bubble does today. Adding a bubble must not move rows above it; the feel suite checks it.

### 3.6 Docs that would change

SPEC §13.1 (bubbles, reactions, replies, context menu), §13.2 (whole bubbles, one reply is several bubbles), §13.5 (the steer 👍), §13.11 (reactions and the voice), §13.12 (first-bubble budget), §17 (state that reactions are content). Plan v3 §4.1, §5.2, §8 and §13.1. `docs/performance.md` for the first-bubble budget. These wait for the owner's answers below; another agent is editing SPEC §13 now.

## 4. Open questions for the owner

1. **Whole bubbles, or text streaming into the bubble?** Recommended: whole bubbles with dots between them. It is how iMessage feels, and short bubbles make the wait small.
2. **The speed budget.** "First token within 1.5 s" becomes "first bubble within 2.5 s" on OpenRouter, with the dots meanwhile. Recommended: yes. A 280-character bubble takes well under a second to write once the model starts.
3. **Reaction set.** The six Tapbacks, or any emoji? Recommended: the six. Each has a meaning Juno can act on, and the picker stays one row.
4. **Which reactions start a run?** Recommended: only ❓. Everything else is noted and read at the next turn. Alternative: 👎 also starts a run so Juno corrects at once; the cost is a run each time the owner disagrees in passing.
5. **Juno's reactions.** Only 👍? Recommended: yes. ❤️ is the one candidate; it reads as warm in Messages but performed from an assistant.
6. **The steer 👍.** Should Juno react 👍 to a message that joins a run, instead of acknowledging it in words? Recommended: yes. It is the quiet "got it" a person gives, and the reply then shows the change.
7. **Bubble length.** 280 characters, one to three bubbles normally, four at most before a card or an offer. Recommended as stated; the eval will show whether 280 is too tight for catch-ups.
8. **Reactions and replies on cards.** Recommended: replies yes, reactions no, so a reaction is never mistaken for approval.
