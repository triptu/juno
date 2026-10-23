# @juno/notifications

The notification pipeline and scheduled presence for one signed-in workspace. It depends on domain rules, the store, and the AI task provider. The engine adapts Slack events and supplies presence writes. This package does not import Slack or Electron.

`makeNotifications(notifier, setPresence, self)` reads the `notifications` and `aiAssist` prefs; `self` is the owner's user id. `NotificationSettingsSchema` validates the notification settings, and `readSettings` reads levels stored before 2026-10-23 as they are now (`every` is Always, `matters` is Auto) and keeps the old What matters to you text stored but unread. Missing or invalid settings use the domain defaults; missing switches and instructions take theirs. Times use the Mac's local calendar, including overnight windows.

- `receive(candidate)` deduplicates by channel and message timestamp, reads the conversation's facts (`readConversation`), runs `decideNotification`, and stores the outcome, `decided_by`, the reason, the facts with the candidate, and any reading. When Auto needs it, `notificationReading` gets the message, the thread's first message, up to 10 earlier messages, the facts, the 30-day DM exchange count (`exchangesWith`) and the instructions. After two seconds without an answer the reading is `failed`: DMs and mentions notify, the rest stays. Hours are checked again after the reading, so its delay cannot notify past the closing boundary.
- `settingsChanged` re-runs today's rows at their original decision time, with their stored facts and readings. It makes no model calls. A row that would now need a reading it does not have keeps its decision. An already delivered or focused-topic-suppressed row cannot notify again.
- `tick` applies a changed presence schedule. `wake` also reapplies scheduled presence. The engine calls it on launch and wake. A manual change holds until the next schedule switch or wake.
- `observePresence` tracks Slack's manual-presence event. `setPresence` handles an explicit change from the owner through the same Slack callback. `presenceChanges` streams what Slack shows, for the avatar menu.
- Every write to `notification_log` invalidates the `notification_log` key, so the Notifications page's Today follows.

Outcomes are `notify` and `stay`; the 2026-10-23 migration renamed older `now` and `hold` rows and added `decided_by` and `decision_json` (the level or instruction behind a decision). The older `digest_slot` column and the agent's `chat_summaries` table remain on disk for migration compatibility but are never read or written. Hours starts and launches do not deliver messages that stayed.

## Host callbacks

`Notifier.show` receives a stable notification id, title, body, and click target. `viewing(topicId)` returns true only when that topic is visible in a focused window. Showing no OS notification for such a topic consumes its notification. `suppressed_at` records this separately from `delivered_at`, and the stored reason explains the suppression.

Delivery is claimed in SQLite before the OS call, to prevent a duplicate interruption. A crash between the claim and the OS call can lose that interruption. Reasons and message content remain in the log.

## Tests

Run `pnpm test:notifications test/notifications.test.ts` from the root. The engine tests cover fake Slack input, duplicate events, the reading's timeout, settings re-runs, focused-topic suppression, held messages across hours starts and relaunches, message targets, and presence. Domain tests cover the pure decisions and calendar boundaries. Run `pnpm test` for the full suite.
