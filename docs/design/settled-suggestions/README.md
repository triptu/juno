# Settled suggestions

Home's Tidy up card said "5 topics look settled", listed the topics' titles in one line and offered only Resolve all. The owner liked it, but could not see which topics it meant, why Juno thought they were finished, or what Resolve would do. This folder holds the design that answers that: a review of every proposal with its reason, one-click Resolve and Keep open per row, an explanation of Resolve, and Settings › Tidy up.

SPEC §12 (Home, Tidy up), §14 (Settings › Tidy up) and §15 decide behaviour. The views are `SettledReview` and `SettingsTidyUp` in `@juno/views`; the gallery has every state under SettledReview and SettingsPage.

## Files

| Shot | What it shows |
| --- | --- |
| `card-light.png`, `card-dark.png` | Home's card: the whole row opens the review, the meta line names the places, Resolve all keeps its slot |
| `a-sheet-light.png`, `a-sheet-dark.png` | Direction A, a sheet over Home |
| `a-sheet-acted-*.png` | One resolved, one kept open: each row stays in place, says what happened, and has Undo |
| `a-sheet-about-*.png` | The info button open: What Resolve does, and Tidy up settings |
| `a-sheet-minimum-*.png` | The minimum window: the buttons go under each row's text |
| `b-in-place-*.png`, `b-in-place-many-*.png` | Direction B, the card opening in place on Home |
| `settings-light.png`, `settings-dark.png` | Settings › Tidy up |

Shoot again with `GALLERY_SHOTS_ONLY=SettledReview,SettingsPage pnpm gallery:shots` and copy from `apps/gallery/shots/`.

## Where the reason comes from

The rule that proposes a topic is the settled decision (`settledScore`, SPEC §15): a fast classifier gives a probability, and Tidy up takes topics at 0.8 or more. The classifier gives no reason, so a reason invented after the fact would be a guess. Instead the engine reads the same last messages the decision read and records what they show (`settledEvidence` in `@juno/domain`, unit tested):

| Signal in the last messages | Reason shown |
| --- | --- |
| The last message thanks someone | Ended with a thank-you from Maya |
| The last message says done, merged, shipped, fixed, deployed | Dev said it's done |
| The last message agrees: sounds good, lgtm, ok, a thumbs up | Ended with an OK from Priya |
| You wrote last, after someone else | No replies for 6 days after your answer |
| None of these | No replies for 3 days, or Juno's own clause when a chat model gave one ("Juno: the invoices were approved and filed") |

The same reading also blocks a proposal outright: a topic where someone asked you something you have not answered (Home's existing `asksUser` rule), or where the last message mentions you, is never proposed, whatever the score.

## Two directions

**A · Sheet.** The card opens a sheet over Home, the way a Mac app reviews a batch: Mail's "Review" sheets, System Settings' sheets. Every proposal is a row: art, title, the reason, the place and the last activity, then Keep open and Resolve. The rows are one Tab stop: ↑ ↓ move, Enter opens the topic (⌘Enter in a new tab, so the review stays), R resolves, K keeps open, ⌘Z undoes the current row, Esc closes. Done and Resolve all sit at the bottom right; Resolve all takes only the rows still open. The info button in the header opens What Resolve does with a link to Settings.

**B · In place.** The card grows into a panel on Home with the same rows, the info and a collapse caret.

**Recommendation: A, the sheet.** It is the one that fits Home and the Mac:

- Home is a calm, fixed page: at most three 52px rows in a centred column, and nothing moves under the pointer (SPEC §12). Opening five to twenty rows in place makes Home a long list, and because the column is centred, the scene and greeting move up as it grows (`b-in-place-many-*.png`). A sheet leaves Home exactly as it was.
- Reviewing a batch is a modal task with a clear end. A sheet gives it a beginning (the card), a focus trap, Esc and Done, which a panel inside a scrolling page does not.
- Home's composer owns the keyboard on Home. Single-key actions (R, K) are safe in a sheet that has no text field and would fight the composer on the page.
- The same sheet works for the topic view's settled hint, ⌘K and the later suggestion cards below, so every self-managing card can share one review pattern.

An acted-on row stays where it was and says "Resolved" or "Kept open" with Undo in the same slot, so the next row never jumps under the pointer, and the toast with Undo still shows, as everywhere else.

## Explaining Resolve

The info button, and the top of Settings › Tidy up, say exactly what the code does (`topics.resolve` in the engine):

- Hides the topic from the sidebar. It stays in All topics, under Resolved.
- Marks it read. Nothing is posted to Slack. With Mark messages read in Slack too on, Slack shows it read on your other devices. (The mark is the normal read mark, sent only when that setting is on and the topic is a Main or a thread you follow in Slack.)
- A new message brings it back to the sidebar, tagged Reopened.
- Keep open stops Juno suggesting it until someone writes in it again.

## Settings

Only settings that change behaviour people would want different. Weighed, and decided:

| Candidate | Decision | Why |
| --- | --- | --- |
| How quiet a topic must be before it is suggested | **Built.** 1 hour · 4 hours · 1 day · 3 days, default 4 hours | Today a topic is scored two minutes after its last message, so a thread that got "thanks" a minute ago can be proposed while people are still typing. Some people want a clean sidebar the same hour; others want a day for stragglers. Four hours covers a lunch or a meeting and still clears the sidebar the same day. |
| Kinds: threads, DMs | **Built.** Threads and Direct messages, both on | Resolving a DM hides the person from the sidebar until they write, which some people never want. A channel's Main is never proposed: it is a stream, not a topic you follow. |
| Never suggest where someone asked you something, or you were mentioned last | **A rule, not a setting** | Nobody wants an unanswered question tidied away. Stated on the page so the rule is visible. |
| What Resolve does to Slack | **No new setting** | Resolve only marks read, and Mark messages read in Slack too already decides whether that reaches Slack. A second switch would disagree with the first. |
| How often to suggest | **No setting** | Home computes items when it appears; the quiet time is the real control. |
| A Keep open list or snooze | **No list** | Keep open ends by itself when someone writes again, so there is nothing to manage. All topics still shows every topic. |
| Resolve automatically, without asking, once trusted | **Proposed next, not built** | The owner's end state. It needs a place to see what Juno did: a Home row "Juno resolved 4 topics" with the same review sheet, every row with Reopen, and an AI activity entry per resolve. Suggest it as a choice in Settings › Tidy up ("Ask first" · "Resolve and tell me") after the owner has used Resolve from the review a few times. Default Ask first. |

The preference is one workspace value, `tidyUp` (`TidyUpPrefs` in `@juno/contract`), read by the engine's Home query. Keep open is the `settled_dismissed_ts` column `topic_overlay` already had: the topic's latest activity when you chose Keep open. Neither touches the follow or read-state protocols in `specs/`, so no Quint change.

## More self-management

Cards in the same spirit, each opening the same kind of review sheet: every row with its signal in words, one click to act, one to say no, Undo, and a line on what the action does in Slack. Ranked by value, then by trust risk (low risk first at equal value). Card 3 is built (SPEC §12, "Automated's record"); the rest are not.

| # | Card | Signal | What it does | Staying transparent | Value | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Unfollow threads you never open** | A followed thread with replies over two weeks that you have not opened or been mentioned in ("14 replies since you joined, never opened") | Notify me Never: unfollows it in Slack, so it leaves the sidebar and stops notifying on every device | The sheet says it unfollows in Slack and that a mention follows again; Undo follows again | High | Medium: it writes to Slack |
| 2 | **Quiet a channel you always mark read** | A channel whose Main you marked read without opening five times in two weeks | Notify me Never on the channel, in Juno only | "You marked #deploys read 7 times without opening it"; Keep notifying; Undo | High | Low |
| 3 | **Automated, with a record** (built) | Every move the rules or Juno make after the first sync, in or back out, with the counts that decided it | A once-a-day card "Juno moved 2 channels to Automated" with the same review sheet (`AutomatedReview`): each channel's reason ("Apps wrote 24 of the last 30 top-level messages"), Move back and Keep | Silent moves become visible once, then stop; the info says what Automated is and that nothing changes in Slack | Medium | Low |
| 4 | **Mark a follow-up done by itself** | A promise in Follow-up ("I'll send the deck") followed by your own message with a file or link in the same topic | Mark done, with the matching message quoted in the row | Shows both messages; Not done brings it back | Medium | Low |
| 5 | **Clear old drafts** | A topic draft untouched for 14 days, in a topic that moved on since | Deletes the draft | The draft's first line and age in the row; Undo restores it; Keep | Medium | Low |
| 6 | **Ignore a channel you never read** | A channel you are in that you have not opened for 30 days, with more than 50 messages since | Ignore channel (hidden everywhere in Juno, nothing in Slack) | "312 messages since you last opened it, 5 weeks ago"; Settings › Ignored lists it; Undo | Medium | Medium: hides content |
| 7 | **Pin what you open every day** | A topic opened on five of the last seven days | Pin | "Opened 6 of the last 7 days"; Unpin | Low | Low |
| 8 | **Close tabs** | Exists as Settings › General › Close tabs not viewed in, without a card | No card: the setting already does it quietly and ⌘⇧T reopens | | Low | Low |

The common rules, so trust carries from one card to the next: the reason is always a fact from the data, never a guess dressed as one; the row never moves after you act; Undo is always there; anything that writes to Slack says so in the sheet; and a "no" stops that suggestion until something changes.
