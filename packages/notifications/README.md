# @juno/notifications

The notification pipeline and scheduled presence for one signed-in workspace. It depends on domain rules, the store, and the AI task provider. The engine adapts Slack events and supplies presence writes. This package does not import Slack or Electron.

`makeNotifications(notifier, setPresence)` reads the `notifications` and `aiAssist` prefs. `NotificationSettingsSchema` validates the notification settings. Missing or invalid settings use the domain defaults. Times use the Mac's local calendar, including overnight windows. Optional `threads` overrides use thread topic ids; Every message on any thread, channel, or person wins over Never.

- `receive(candidate)` deduplicates by channel and message timestamp, runs `decideNotification`, and stores the reason and any AI judgement. `urgencyGate` receives the owner's `matters` text. After two seconds without an answer, DMs and mentions notify under the AI-off rule. Hours are checked again after the gate, so its delay cannot notify past the closing boundary.
- `settingsChanged` re-runs today's rows at their original decision time, using stored judgements. It makes no model calls. A row without a judgement uses the AI-off rule. An already delivered or focused-topic-suppressed row cannot notify again.
- `tick` applies a changed presence schedule. `wake` also reapplies scheduled presence. The engine calls it on launch and wake. A manual change holds until the next schedule switch or wake.
- `observePresence` tracks Slack's manual-presence event. `setPresence` handles an explicit change from the owner through the same Slack callback. `presenceChanges` streams what Slack shows, for the avatar menu.
- Every write to `notification_log` invalidates the `notification_log` key, so the Notifications page's Today follows.

The removal migration drops `summary_due_at` and its index and converts old `summary` outcomes to `hold`. The older `digest_slot` column and the agent's `chat_summaries` table remain on disk for migration compatibility but is never read or written. Hours starts and launches do not deliver held messages.

## Host callbacks

`Notifier.show` receives a stable notification id, title, body, and click target. `viewing(topicId)` returns true only when that topic is visible in a focused window. Showing no OS notification for such a topic consumes its notification. `suppressed_at` records this separately from `delivered_at`, and the stored reason explains the suppression.

Delivery is claimed in SQLite before the OS call, to prevent a duplicate interruption. A crash between the claim and the OS call can lose that interruption. Reasons and message content remain in the log.

## Tests

Run `pnpm test:notifications test/notifications.test.ts` from the root. The engine tests cover fake Slack input, duplicate events, timeout fallback, settings re-runs, focused-topic suppression, held messages across hours starts and relaunches, message targets, and presence. Domain tests cover the pure decisions and calendar boundaries. Run `pnpm test` for the full suite.
