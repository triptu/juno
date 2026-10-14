# Agent-native chat products: what is worth taking for Juno

Research for the owner's ask of 10-14: check the "agent-native" Slack alternatives and AI layers over Slack, and find agent experiences that are new and useful day to day, not launch demos. Written 10-14 from public web sources.

## How to read this

- **Evidence is thin across the board.** Nearly everything here comes from vendor sites, docs, changelogs and trade press. Independent user discussion (HN, Reddit, reviews) exists for a few products only, and is noted where found. No product was used hands-on. "Per vendor" means the claim is the company's own.
- Products launched or changed after mid-2026 were checked only through search results and their own pages.
- Ratings: **Novel** (not just "@mention a bot"), **Useful** (would help a busy manager most days), **Demo** (looks good in a launch video, little sign of daily use).
- The fit test for Juno: one owner, real Slack underneath, a calm client, a personal agent in one chat, one click per outward action, no unsolicited observations (owner, 10-14 01:59), few settings, and anything sayable done in chat (owner, 10-14 15:30).

## 1. Products covered

Starting list: [ando.so's article](https://www.ando.so/blog/best-alternatives-to-slack-with-built-in-ai-agents) (by Ando, updated 2026-10-06). It names 22 products, plus a few dead or redirecting domains. Search added Slack's own agents, the coding agents in Slack, and personal-assistant and inbox products.

### Slack replacements built around agents

| Product | The agent experience, concretely | Rating | Sources |
| --- | --- | --- | --- |
| Ando | Agents are workspace members with an identity, an inbox and permissions. They join channels, DMs and calls, may join a thread without an @mention, and ask a human when judgement is needed. They cannot read your DMs unless someone forwards the context. Bring your own agent (Codex, Claude, Devin) or use Ando's. Waitlist, teams up to about 30, $20M raise (Sept 2026). No public detail on approvals or noise control | Novel bet (unprompted joining). Unproven. A noise risk with no visible mechanism | [ando.so](https://ando.so), [tbreak](https://tbreak.com/ando-agent-native-messaging/) |
| Buzz (Block) | Open source, on Nostr. You add an agent to a channel like a person. The agent signs its own work, and the human signs a narrow grant that can be revoked. YAML workflows can start agents from messages, reactions, schedules or webhooks. Approval gates are "in progress". Pre-1.0. A large HN thread was skeptical (data leaking through agents in shared channels) | Novel (two-signature audit). Useful idea, early product | [github](https://github.com/block/buzz), [SiliconANGLE](https://siliconangle.com/2026/07/21/block-launches-buzz-open-source-workspace-humans-ai-agents/) |
| Hazel | Open-source Slack clone, in beta. You call a bot by slash command or @mention, and it answers in a new thread on the message that triggered it. OAuth-style scopes. No approvals or noise handling documented | Nothing new. The answer-in-a-thread habit is good | [hazel.sh](https://hazel.sh) |
| Sila | "AI Contacts", one per job, that you message like people. Per vendor, you can redirect one mid-task, editing your message restarts it, and contacts hand work to each other. It may message you first. No permission model described. Chat previews are mockups | Steering mid-task is useful. Agent-to-agent handoff is demo | [silahq.com](https://silahq.com) |
| Orchestra | Chat plus tasks, with "AI bots in chats" and meeting summaries. The task agent is on a waitlist. No detail on invocation or permissions | Nothing to judge | [orch.so](https://orch.so) |
| Slashwork | Ex-Meta Workplace team. Strongest on noise: a ranked feed, grouped notifications, summaries of weeks-long threads, and a separate space for automated output. Anyone can build an agent. No approval model | Useful noise ideas, not agent ideas | [slashwork.com](https://slashwork.com) |
| Chord | Group chat where people tag one or more models into a shared thread. Up to 20 people, bring your own key | Demo for our case (multiplayer prompting) | [chord.chat](https://chord.chat) |
| Campfire (ONCE) | Self-hosted chat with no AI and a plain bot API. 37signals took the opposite route for Basecamp: no AI features inside, a clean API, CLI and skill for outside agents | Useful as a stance: restraint plus good access | [once.com](https://once.com/campfire), [DHH](https://world.hey.com/dhh/basecamp-becomes-agent-accessible-3ae6b949) |
| Mattermost Agents | Right-side agents pane, DMs with agent bots, @mention in channels (the reply goes in a thread). A "Summarize new messages" button on the unread line. In DMs only the person who asked can approve a tool call. In channels, that person chooses whether to share the result or keep it private. After three failed tool calls in a row it stops and asks | Useful: catch-up placed at the unread line, and the clearest trust model of the incumbents | [docs](https://docs.mattermost.com/agents/docs/user_guide.html) |
| Microsoft Teams Copilot | Facilitator takes meeting notes and actions. Since Sept 2026 it posts web answers to the meeting on its own. Channel agent writes status reports. Chat recap covers decisions and action items. Complaints: licence cost and confusion, actions assigned to the wrong person, notes that lag the meeting | Recaps useful. Unprompted answers in meetings are demo and risky | [UC Today](https://uctoday.com/unified-communications/microsoft-teams-copilot-whats-new-in-september-2026/), [Microsoft](https://support.microsoft.com/office/use-copilot-in-microsoft-teams-chat-and-channels-cccccca2-9dc8-49a9-ab76-b1a8ee21486c) |
| Not covered | Idlechat (no product found; output.app redirects to it), Leverage (a thesis page, no product found), Den (YC 2025 launch post only), Matrix (a protocol), mention.so and tidbit.ai (inactive) | - | [Den launch](https://www.ycombinator.com/launches/NZ9-den-cursor-for-knowledge-workers) |

### Slack's own agent

| Product | The agent experience, concretely | Rating | Sources |
| --- | --- | --- | --- |
| Slackbot (personal agent, Jan 2026) | A private DM, a side panel, and a "Today" page since May 2026 (priorities, calendar, highlights). Answers "what did we decide about X", catches you up, drafts, schedules, runs deep research, and acts in other apps over MCP. Runs on Claude. Business+ and up only | Catch-up and recall are useful. Today has no usage evidence | [Salesforce](https://www.salesforce.com/news/press-releases/2026/01/13/slackbot-announcement/), [Today](https://slack.com/blog/news/today-daily-briefing) |
| Recaps | A daily summary of channels you pick, defaulting to ones you read but rarely post in. Covers your whole absence and links each point to its source message | Useful. The most plainly valuable manager feature found | [TNW](https://thenextweb.com/news/slack-slackbot-30-ai-features-agentic) |
| Skills | A workflow you describe once in plain words. It can run on a schedule, read channels and build on earlier runs (for example, keeping a status canvas current). Shareable between orgs since Oct 2026 | Useful if it stays accurate, which nobody has shown. Cross-org sharing is demo | [Slack](https://slack.com/blog/news/slackbot-shareable-skills) |
| Desktop agent, voice | Watches screen activity to suggest follow-ups. Two-way voice | Demo, with the largest privacy surface (press) | [TNW](https://thenextweb.com/news/slack-slackbot-30-ai-features-agentic) |
| RTS API and MCP server (GA Feb 2026) | Outside agents can search Slack with the user's permissions. Slack's terms forbid storing or indexing the results | Platform, not UX. It matters to Juno as a possible future read path | [Reworked](https://www.reworked.co/digital-workplace/slacks-rts-api-and-mcp-server-hit-general-availability/) |

Approvals: Slack says it acts "with guardrails" but publishes no rule. One third-party tracker says sends need confirming. Independent complaints are mostly about price (the old add-on had to be bought for the whole workspace).

### Agent layers over Slack, and coding agents in a thread

| Product | The agent experience, concretely | Rating | Sources |
| --- | --- | --- | --- |
| Dust | `@Dust` agents in Slack threads. Replies stream with a live line naming the tool in use. Admins set a "stake" per tool, and approval history is kept per agent, so a "post message" you approved once is not asked again. The agent posts as you. Setup is heavy (G2) | Novel (approval memory). Admin-shaped | [changelog](https://docs.dust.tt/changelog/medium-stake-tools-with-per-agent-approval-history) |
| type.com | Build an agent in Claude or Codex and publish it to a shared space. Teammates @mention it in Slack, or it runs on a schedule. It posts a short summary in the thread with a link to the full report. No approval step found | Useful pattern: short in chat, detail one click away | [type.com](https://type.com) |
| Duet | An always-on cloud machine per workspace, with memory. Agents run on schedules or events. Slack is one of many tools, not the home | Infrastructure. A report that is ready before your day starts | [duet.so](https://duet.so) |
| iterate | An event-sourced agent OS on Cloudflare, driven through one MCP tool. The Slack behaviour is undocumented | Infrastructure | [iterate.com](https://iterate.com) |
| Cursor in Slack | `@Cursor` with inline repo and branch. It reads the thread, posts a plan first for bug fixes, keeps one status line updated in place, and ends with a PR link. A later `@Cursor` in the same thread is a follow-up. Forum complaints: wrong repo or branch, and agents started from Slack are hard to find again | Useful patterns, and well documented failures | [docs](https://cursor.com/docs/integrations/slack) |
| Devin in Slack | "Silence is the default." It acknowledges with an eyes reaction and ends with a PR plus a root-cause note. Thread commands: `mute`, `(aside)`, `sleep` | Useful (noise etiquette) | [Devin blog](https://devin.ai/blog/devins-slack-etiquette) |
| Claude in Slack (Claude Tag) | Routes each request to code or chat, with "Retry as Code" and "Change repo" buttons when it guesses wrong. Shows a live checklist, then @mentions you with a summary, View session and Create PR. Docs warn that it may follow instructions from other people in the thread | Useful (buttons to correct a wrong guess) | [docs](https://code.claude.com/docs/en/slack), [Claude Tag](https://claude.com/docs/claude-tag/overview) |
| Codex in Slack | Posts a "task started" message. Only the requester sees Follow along and Cancel, and approval cards are private to the requester | Useful (controls private to the requester) | [docs](https://learn.chatgpt.com/docs/third-party/slack) |
| Slack Code (Aug 2026) | Tagging an agent opens a temporary channel per task with diffs and approvals, archived when done. The HN thread was skeptical: "just a diff viewer in Slack" | Demo (channel clutter, and GitHub reviews better) | [HN](https://news.ycombinator.com/item?id=49374965) |

### Personal assistants and agent inboxes

| Product | The agent experience, concretely | Rating | Sources |
| --- | --- | --- | --- |
| Superhuman | Labels on arrival. Mail you got no reply to comes back on its own, with a follow-up draft in your voice ready to review. It never sends. Flaw: removing a wrong label fixes one message, and the rule keeps firing until you edit settings | Useful (a draft only when the reminder comes back). The flaw is instructive | [help](https://help.superhuman.com/hc/en-us/articles/45265917418259-Follow-Up-Faster) |
| Cora (Every) | Keeps only mail that needs you, and summarises the rest twice a day. You teach it by chatting, not with settings | Useful idea. No real reviews | [Every](https://every.to/feeds/1d9e62247f697a00709f/cora-is-out-of-beta-give-ai-your-inbox-take-back-your-life) |
| Fyxer | Sorts mail and writes drafts into your Drafts folder. Reviews: drafts good about half the time; sorting "hid my important emails"; drafts left unsent caused missed replies | Lesson: work stored where you don't look fails silently | [eesel](https://www.eesel.ai/blog/fyxer-ai-reviews) |
| Notion Mail | AI-sorted mail client, shut down Sept 2026. Notion's reason: most users handled email "without ever opening their inbox" and moved to its agents | Lesson: an agent outside the client beat AI sorting inside it | [9to5Mac](https://9to5mac.com/2026/06/25/notion-shutting-down-its-ai-powered-email-client-including-mac-and-ios-apps/) |
| Poke | An assistant you text in iMessage, with a proactive morning digest. Reviews: quick setup, but date errors and "surfaces things that don't matter" | Proactive digest: mixed | [review](https://blog.saner.ai/poke-reviews/) |
| ChatGPT Pulse | Morning cards researched overnight. One HN user found it useful, another blocked the notifications. Reported as deprioritised | Demo for a calm product | [Tom's Guide](https://www.tomsguide.com/ai/chatgpt-pulse-is-here-now-ai-starts-the-chat-and-curates-your-feed) |
| Granola | Chat scoped to one meeting, a folder, a person or everything. You pick the scope by picking the object | Useful (scope by object, no filter UI) | [help](https://help.granola.ai/article/chatting-with-your-meetings) |
| Runbear, Lindy, Martin | Slack or text assistants that triage and draft. Lindy: credit use runs high, and agents you build yourself need supervising. Martin: marketing only | Self-built agents become settings bloat | [Runbear](https://docs.runbear.io/), [Lindy reviews](https://blog.saner.ai/lindy-ai-reviews/) |
| LangChain Agent Inbox (pattern) | The agent pauses with a request. The human accepts, edits, responds or ignores. The docs warn that a "respond" to a tool with side effects can be read by the model as success, so a rejection must be explicit | Useful engineering rule | [docs](https://docs.langchain.com/oss/python/langchain/frontend/human-in-the-loop) |

Littlebird (the owner's company) also came up. It is left unrated here because it is one of Juno's own connections.

## 2. What the field shows

1. **Most "agent-native chat" is a bet on teams with agents as members** (Ando, Buzz, Sila, Slashwork). It is unproven, and none of these products shows how agents avoid adding noise. Juno's case is different: one person, a personal agent, Slack unchanged for everyone else.
2. **What users plainly value is narrow:** linked catch-ups, recall ("what did we decide"), and quiet hand-offs to coding agents that end with a PR.
3. **What users push back on:** proactive pushes (Pulse, Poke, Teams' unprompted answers), self-built agents (Lindy), wrong guesses that are hard to correct (Cursor's repo), and output stored where nobody looks (Fyxer). Price and licences dominate complaints about the incumbents.
4. **Trust models are mostly unwritten.** Mattermost and Codex (approvals private to the requester), Dust (stakes) and Buzz (signed grants) are the only concrete ones. Juno's tier table (SPEC 13.9) is already more complete than any of them.

## 3. Where Juno is already ahead

| Field pattern | Juno already has |
| --- | --- |
| Catch-up button at the unread line (Mattermost) | The catch-up summary at the "new" divider (SPEC 7, 15) |
| Recaps and a morning page (Slack, Cora, Pulse) | The living home, built from the local cache before AI. One summary when notification hours start (SPEC 14) |
| AI-grouped notifications (Slashwork, Superhuman labels) | Juno's notification gate with "What matters to you", plus a "Why did this notify?" on every message (SPEC 14) |
| One status line, PR at the end (Cursor, Claude, Devin) | The Task card with its live state line, milestone messages, and the PR on Done (SPEC 13.4) |
| Mute an agent (Devin) | "Mute updates" on a job's group (SPEC 13.6) |
| Approvals private to the requester (Codex, Mattermost) | The whole chat is private. Outward actions are cards, one click per action (SPEC 13.3) |
| Signed audit trail (Buzz) | Activity lists every run and every action with its decision (SPEC 13.9) |
| Steering mid-task (Sila) | Queued messages read mid-run (SPEC 13.5) |
| Agent in a side panel (Slackbot, Mattermost) | Juno opens as a right sidebar on any topic and knows what you are looking at (owner, 10-14 15:30) |
| Agent outside the client (Notion Mail's lesson) | Juno Agent is a standalone module that can run on other surfaces (BRIEF) |
| Untrusted thread content (Claude docs' warning) | Once Slack content is read, Work-tier actions need a card (SPEC 13.9) |

## 4. Ideas that fit Juno

Each idea below needs little or no new UI. Cost is rough: S is days, M is about a week, L is more.

### A. Every Slack claim links to its message
- **Idea:** whenever Juno states something from Slack (in chat, a catch-up or the hours-start summary), the claim links to the message it came from.
- **Who:** Slack recaps link each point to its source. The Fyxer complaint shows the failure without links ("hid my important emails").
- **Why useful:** a manager acts on summaries. One click to check the source is what makes a summary trustworthy, and Juno already does this for its own memory ("On 12 Mar you said …", SPEC 13.1).
- **In Juno:** recall-style citations extended to Slack: a short link on the phrase that opens the topic at that message, in the current tab, or a new tab with ⌘-click. No new screen.
- **Cost:** S–M. The model returns message ids with its claims, and the renderer turns them into links. Catch-up generation needs the same.
- **Risk:** a wrong citation is worse than none. Check every cited id against the local cache and drop any that does not match.

### B. Ask Juno about this person or channel
- **Idea:** "Ask Juno" in the context menu of a person, a channel or a topic opens the Juno sidebar scoped to it ("What's open with Priya?", "What did #eng decide this week?").
- **Who:** Granola (pick the person or folder to set the scope), Slackbot's side panel.
- **Why useful:** a manager's real questions are about people and projects. Scope by object replaces a filter UI.
- **In Juno:** one menu item that opens the right sidebar (already decided) with the scope set as context. The question is typed in chat as normal. No new page.
- **Cost:** S, once the right sidebar exists. A person scope needs a read tool for "messages from or mentioning X".
- **Risk:** few. Search across DMs is costly, so stay within the read tools and the lane budget.

### C. Tell me if nobody replies
- **Idea:** "Remind me if Sam doesn't reply by Thursday", said in chat or chosen from a message's menu. Juno watches the thread and speaks only if the deadline passes with no reply.
- **Who:** Superhuman auto reminders. Slack's own "remind me" lacks the "unless they reply" condition.
- **Why useful:** chasing is a manager's main follow-up job, and a reply cancels the reminder, so it costs no attention when things go well.
- **In Juno:** a one-shot watch the owner set up, so it fits the proactive rule (SPEC 13.6: things you told it to watch, speaks only on change). It shows on Scheduled. A menu item, "Remind me if no reply", sits beside the existing message actions, because per-item choices live in that item's menu (owner, 10-14 15:30).
- **Cost:** S–M. It reuses schedules and monitors, plus a check for "a reply after this message from these people".
- **Risk:** deciding who must reply (one person, or anyone). Juno decides from the words and says what it will watch in one line.

### D. A correction teaches the rule, visibly
- **Idea:** when the owner corrects a notify or hold call ("this should have pinged me"), Juno asks once whether it applies more widely, then updates "What matters to you" in the owner's words, with Undo.
- **Who:** Cora (teach by chatting). Superhuman's flaw is the counter-example: fixing a label fixes one message, and the rule keeps firing.
- **Why useful:** this is how the gate gets right for this owner without a settings page, and the learning stays readable.
- **In Juno:** "Why did this notify?" already offers Tell Juno (SPEC 14). This adds behaviour only: Juno proposes the text change in chat and applies it as a Local action with "Notifications changed · Undo".
- **Cost:** S. A prompt plus the backlog's notification-settings tool.
- **Risk:** "What matters" can grow long and contradictory. Juno rewrites it as a whole and shows the new text, rather than appending.

### E. Dismiss is an explicit no
- **Idea:** when the owner dismisses a card or lets it expire, Juno's next turn is told plainly that it was declined. It never infers success from silence or from a reply.
- **Who:** LangChain's Agent Inbox docs, which warn that a "respond" can be read as success.
- **Why useful:** stops the agent from retrying, re-proposing or claiming an action happened. Pure correctness.
- **In Juno:** no UI. Replies can already quote a card (owner, 10-14 12:50), which gives the reason when the owner wants to add one.
- **Cost:** S. An outcome event in the journal for Dismiss, Expire and Keep.
- **Risk:** none found.

### F. Coding hand-off polish
- **Idea:** before Juno starts a T3 Code session, the Task card shows the project and branch it chose, so a wrong guess is visible at once. For large or unclear work Juno may ask first with a short plan, by its own judgement. The Done message gives the PR and one line on the cause.
- **Who:** Cursor (plan first, wrong repo is the top complaint), Claude ("Change repo"), Devin (root-cause line).
- **Why useful:** wrong repo or branch is the most reported failure of coding agents started from chat.
- **In Juno:** the Task card already shows "where it runs" (SPEC 13.3). Correcting it is a chat message ("no, the juno repo"), not a new button. The plan and the cause line are the model's judgement, not rules (owner, 10-14 12:50).
- **Cost:** S. Card copy and a field in the session brief.
- **Risk:** a plan step slows small tasks. Leave the choice to the model.

### G. A draft ready when the reminder fires
- **Idea:** when a "tell me if nobody replies" reminder (C) fires, a nudge draft is already in a Send card.
- **Who:** Superhuman auto drafts. Fyxer shows the risk when drafts sit where you don't look.
- **Why useful:** the follow-up becomes one click. The draft appears only at the moment it is needed.
- **In Juno:** a Send card under the reminder, with editable text. It conflicts with SPEC principle 5 ("AI manages, you write"), so it is the owner's call.
- **Cost:** S on top of C.
- **Risk:** Juno writing in the owner's voice, which the spec rules out today.

## 5. Considered and rejected

| Idea | Who | Why not for Juno |
| --- | --- | --- |
| Agents join threads unprompted | Ando | Breaks "no unsolicited observations". Juno is a personal client, so Slack colleagues never see Juno speak |
| Agents as workspace members with identities | Ando, Buzz, Sila | Needs a team product. Juno runs on the owner's Slack session alone |
| Approval memory ("don't ask again") | Dust stakes | Conflicts with the hard rule of one click per outward action |
| Daily AI briefing page | Slack Today, Pulse, Poke | The home and the hours-start summary cover it deterministically. Users block proactive pushes |
| Screen-watching desktop agent | Slackbot | Large privacy surface. Littlebird supplies that context through its connection |
| Meeting transcription and in-meeting answers | Teams, Ando, Slackbot | Calls are not designed in Juno (SPEC 19). Unprompted answers are the riskiest feature found |
| User-built agents, skills marketplace | Lindy, Slack Skills, type.com | Settings bloat. Juno schedules already take plain words ("catch me up on #eng every weekday at 9") |
| A temporary channel per coding task | Slack Code | Channel clutter. Review belongs in GitHub, and Juno links the PR |
| Several models in one shared thread | Chord | Multiplayer prompting. Juno has one owner |
| Agent-to-agent handoff in the chat | Sila | Juno speaks for its delegates already (SPEC 13.4). Showing handoffs is machinery |
| Separate stream for bot output | Slashwork | The ignore list and the notification gate cover it. A new stream is a new surface |
| Auto-sorted labels on the sidebar | Superhuman, Notion Mail | SPEC 15 forbids "needs you" labels. Notion Mail's closure argues against AI sorting as the product |

## 6. Shortlist

Ranked by value to a busy manager over cost. All seven fit inside chat, an existing menu, or a card.

| # | Idea | Recommendation | Open question for the owner |
| --- | --- | --- | --- |
| 1 | **A. Every Slack claim links to its message** (in chat, catch-ups and the hours-start summary) | Adopt now | None |
| 2 | **C. Tell me if nobody replies**, from chat or a message's menu | Adopt now | Menu item plus chat, or chat only? |
| 3 | **B. Ask Juno about this person or channel**, from the item's menu into the Juno sidebar | Adopt now, with the right sidebar | None |
| 4 | **D. A correction teaches the rule**, rewriting "What matters to you" with Undo | Adopt now, with M10 notifications | None |
| 5 | **E. Dismiss is an explicit no** to the model | Adopt now (engineering only) | None |
| 6 | **F. Coding hand-off polish:** project and branch on the Task card, plan first when Juno judges it needed, the cause in the Done line | Later, with the next T3 Code work | None |
| 7 | **G. A draft ready when the reminder fires** | No for now | Allow Juno to draft a nudge in your voice in this one case, against "AI manages, you write"? |

Short version: the field has few agent ideas that are both new and useful. The useful ones are small habits (sources, chasing, correcting by example, quiet hand-offs), and Juno can add them without new screens or settings.
