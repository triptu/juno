# Future ideas

Product ideas for Juno that are not planned yet. Each one says what it is, why a manager would want it, and how it fits what Juno already does. This is not the backlog (`backlog.md` holds small known items) and not the spec (`design/handoff/SPEC.md` decides behaviour). When an idea is briefed, move it to a plan and remove it here. When it is declined, move it to the last section with the reason.

The test for an idea: it saves a manager time or a mistake most weeks, it stays calm (one quiet row, never a feed), it keeps the person as the author of anything that leaves Juno, and it is reachable from the topic it belongs to.

Juno can connect to anything with an MCP server or anything that runs locally (coding agents, scripts, the browser). The ideas below assume that, not only what is connected today.

## Open loops

- **Waiting on them.** The mirror of Home's "Waiting on you": a question you asked, with an @mention or in a DM, that nobody answered after a notification day, grouped by person. Reply watches exist but are set one at a time; this finds them all. Reuses the follow-up detector and the watch machinery.
- **Their promises.** "Sam said he'd ship Thursday" is a commitment made to you. Track it like your own follow-ups and surface it when the date passes, with the source message. With Waiting on them and your follow-ups this makes one Open loops page: you owe, they owe, unanswered.
- **Acknowledgement count.** You ask five people to confirm something; Juno counts ✅ reactions and replies against the people you addressed. The row reads "3 of 5 confirmed" and names who has not. Rules only.
- **Status without nagging.** Before you ask "any update?", Juno shows what that person posted about the same work elsewhere: "Sam wrote in #infra two hours ago that it is blocked on the migration." Removes the most common manager ping.
- **Bring back on Monday.** Resolve hides a topic for good, but many topics are "not now". A snooze that resolves until a date, or until a named person replies. Same hover, one more option; the "until Sam replies" case feeds Waiting on them.
- **Resolve with an outcome.** Resolving takes one optional word: done, dropped, or moved to a ticket. All topics shows it, and the person page and decisions can use it.
- **Triage pass.** A keyboard pass through what wants you: J and K move, R replies, L is Bring back later, D resolves. Fits "fast to clear" and the sidebar's held order.

## Before you send

- **Send it in their morning.** Slack knows every person's time zone and supports scheduled sends. A send check next to audience and route: "It's 11:40 pm for Maya. Send at 9 her time?" One click, same pattern as the existing checks.
- **Already answered.** A send check that notices your question was answered in the last few days: "Maya answered this yesterday in #infra", with the message linked.
- **You answered this before.** The mirror: someone asks you something you have answered before. Juno shows your own past answer with a link and a one-click quote. Your words, so not ghostwriting.
- **Tone, opt-in.** Flags only a clearly sharp message, never style, in the grammar check's 800 ms budget. A terse late reply to a report is the message a manager regrets.
- **Forwardable summary.** "Explain this thread for Priya" puts a cited summary in the composer with Priya as the destination. Giving context to someone who was not in the thread is a large share of a manager's writing. It is organizing, and it sends only on your click.

## Knowing the organization

- **Person page.** Click a name: every open topic with them, what you owe them, what they owe you, the last decisions you made together, and your private notes. Per-person memory (in progress) gives it a home. Before a 1:1 it is the prep, without a feature called "1:1 prep".
- **Decisions.** "What did we decide about the staging bill?" is the question every manager asks Slack and never gets answered. Extract decisions from topics the way titles are extracted, client-only, cited to the source message, and make them a third ⌘K tab. Resolving a topic offers "Record the decision" with the sentence prefilled.
- **Decided without you.** A thread in a channel you are in reached a decision that touches your team, and you did not take part. One Home row, from the decision extractor.
- **Who knows.** "Who should I ask about payment retries?" answered from who writes about it, cited. Managers route questions all day and often guess.
- **Glossary.** Juno learns the team's acronyms and project names from Slack. Hover one to see what it means, with the message it came from. Small, and worth a lot across teams.
- **My team lens.** Tell Juno once who reports to you. The sidebar and Home get a filter for topics involving them, and Home's ranking weights them higher.
- **Heating up.** One Home row for a thread in a channel you are in but do not follow, where the reply rate spiked and three or more people are in it. Rules, not the model, and capped at one row so it stays calm. A manager wants to know about a fire before someone pings them about it.
- **Load on your team.** Which report is pulled into the most threads and mentions this week. Built only from what you can already see, shown only on the person page, and never a ranking. Risk: it reads as surveillance; needs a design decision before a brief.

## Continuity

- **This continues.** The same subject comes back as a new thread every few weeks. Juno links the new topic to the earlier one ("Continues: Staging bill doubled") so the context and the decision are one click away.
- **Away and back.** "Out until Monday" sets your Slack status, holds notifications, and on return Home shows a return brief ranked by what moved and what waits, in place of the usual three rows. The same brief after a long meeting or a focus block. This is the catch-up that section 7 removed from the topic view, moved to the one moment it is wanted.
- **Your week, for your manager.** A Friday draft of what you did, from your own messages and resolved topics, cited, pasted wherever your update goes. You edit and send; Juno only gathers.

## Beyond Slack

Juno's rule is topics, not channels. The next step is topics, not apps: one list of conversations that want you, with Slack first.

- **Approvals in one place.** Expense, PR, access, PTO and vendor approvals arrive as bot messages from different tools. Juno recognizes an approval request from any connected tool and shows them as one Approve list; each approval runs through that tool on your click. Managers drown in approvals, and no tool owns the list.
- **Thread to ticket, round trip.** One click turns a thread into a Linear, Jira or GitHub issue. The issue's state shows on the topic row, a merged PR suggests resolving the topic, and a state change in the tool posts to the thread only with your confirm.
- **Live links.** Any link pasted in Slack (Figma, Notion, Linear, a PR, a dashboard) shows its current state from the tool's MCP, not Slack's stale unfurl. Daily, small.
- **Calendar-aware Juno.** With Littlebird or a calendar connected: a Home row before a meeting ("Sync with Maya in 10 min") with your open loops with her and the thread that prompted the meeting. After it, the meeting's action items offered as follow-ups, and a card to post them to the channel. Notification rules follow the calendar: in a meeting means held.
- **Answers from documents.** Someone asks a policy or process question in a channel; Juno finds the answer in Notion, Drive or the wiki and offers a quote with the link for you to send. When a thread discusses a document, the Juno panel shows its recent changes and comments. Recorded decisions can be written to the team's decisions page with your confirm.
- **Answers from the code.** "Is this fixed?" in a bug thread is answered from git history and open PRs through a local coding agent. "Why does X do Y?" gets an answer with file citations for you to review and send. An incident thread links the deploy that caused it.
- **Answers from the numbers.** "Did signups drop?" runs against the metrics tool (PostHog, Metabase, a warehouse) and shows the chart in the Juno panel; you decide what to say. An alert in a monitoring channel is enriched with the current graph.
- **Email and review requests as topics.** Email threads, GitHub review requests and issues assigned to you appear in the same sidebar as topics, with the same quiet rules. Big, and the end state of "topics, not apps".
- **Agents as participants.** Generalize "Fix this with T3 Code": a thread can become a job for any local or remote agent ("draft the RFC in Notion", "run the query", "open the PR"). The agent shows in the topic as a participant with its state, its progress shows in the Juno panel, and when it is done a card offers to post the result in the thread. Nothing posts without your click.
- **Watch anything.** Reply watches generalized: watch a PR, a ticket, a document, a dashboard number, and get told in the thread it belongs to. "Tell me when this PR merges" or "when this number is back above 100" is one sentence to Juno.
- **Rules in plain words.** "When a PR that closes this thread's ticket merges, resolve the topic." Juno turns a sentence into an event rule across connections and lists it on Scheduled with the schedules. Each rule's actions follow the existing tool trust rules.
- **One identity across tools.** The same person on Slack, GitHub, Linear and the calendar is one person in Juno. Juno matches handles and asks you to confirm once. This is what makes the person page and the Open loops page real.
- **Hiring loop.** A candidate thread shows the scorecard state from the applicant tracker, and feedback you owe shows under Waiting on you. Narrow, but every manager hires.
- **Evidence for a review.** On an explicit ask only: gather what a report delivered, the thanks they got and the decisions they drove from Slack and the connected tools, cited, into a document you write from. Private to you and never automatic.

## Making connections easier

- **Connect from what your team shares.** Juno sees that your team pasted Linear links forty times this week and offers "Connect Linear?" as a proactive ask, the pattern 13.6 already defines. Setup is paste a URL or a command, sign in, done.
- **Recipes.** A connection comes with named behaviours that are on by default, in plain words ("Show PR state on topic rows", "Approvals in one place"), each with its own switch and the trust rules of 13.9. The person understands what the connection does without reading a tool list.
- **Local first.** Anything on the Mac (a coding agent, a script, the browser's current page) connects with no server and no account. "Summarize what I'm looking at for #eng" reads the browser page.

## Declined for now

- **Weekly reflection page** (topics resolved, people talked to most). Nice, not useful most days. "Your week, for your manager" keeps the useful half.
- **Automatic re-titling on drift.** The open question in SPEC section 19. Answer: offer a split only when a reply is on a different subject; never retitle silently.
- **Seen-by on your messages.** Slack does not expose others' reads. Acknowledgement count covers the useful case.
