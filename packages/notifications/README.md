# @juno/notifications

The notification pipeline and scheduled presence for one signed-in workspace. It depends on domain rules, the store, and the AI task provider. The engine adapts Slack events and supplies presence writes. This package does not import Slack or Electron.

`makeNotifications(notifier, setPresence)` reads the `notifications` and `aiAssist` prefs. `NotificationSettingsSchema` validates the notification settings. Missing or invalid settings use the domain defaults. Times use the Mac's local calendar, including overnight windows. Optional `threads` overrides use thread topic ids; Every message on any thread, channel, or person wins over Never.

- `receive(candidate)` deduplicates by channel and message timestamp, runs `decideNotification`, and stores the reason and any AI judgement. `urgencyGate` receives the owner's `matters` text. After two seconds without an answer, DMs and mentions notify under the AI-off rule. Hours are checked again after the gate, so its delay cannot notify past the closing boundary.
- `settingsChanged` re-runs today's rows at their original decision time, using stored judgements. It makes no model calls. A row without a judgement uses the AI-off rule. An already delivered or focused-topic-suppressed row cannot notify again.
- `tick` applies a changed presence schedule and sends due summaries. `wake` also reapplies scheduled presence. The engine calls it on launch and wake. A manual change holds until the next schedule switch or wake.
- `observePresence` tracks Slack's manual-presence event. `setPresence` handles an explicit change from the owner through the same Slack callback. `presenceChanges` streams what Slack shows, for the avatar menu.
- Every write to `notification_log` invalidates the `notification_log` key, so the Notifications page's Today and the why popover follow.

The appended user migration retains the existing unique message constraint and adds the candidate, judgement, and summary due time. Each summary row records its next local hours start. A due row remains eligible after the window ends, so a missed start is delivered on relaunch. No configured start means that a summary remains pending.

## Host callbacks

`Notifier.show` receives a stable notification id, title, body, and click target. `viewing(topicId)` returns true only when that topic is visible in a focused window. Showing no OS notification for such a topic consumes its notification. `suppressed_at` records this separately from `delivered_at`, and the stored reason explains the suppression.

With AI assist on, `Notifier.summary` receives the full source list and the summary text before `show`. The host appends one Juno message with origin `summary`, one source inline per message, and no model run. It returns the chat message id for the click target. The callback must be idempotent by summary id. With AI assist off, there is no summary callback and the click opens the first source.

Delivery is claimed in SQLite before the OS call, to prevent a duplicate interruption. A crash between the claim and the OS call can lose that interruption. Reasons and message content remain in the log. The agent summary callback runs before the delivery claim.

Each summary source carries the place as the owner sees it (`#eng`, `Maya Chen`) and the sender when the place does not name them, so the chat can say "Maya Chen in #eng" without message text. In the app, `hostNotificationHost` in the engine sends notifications to main (`apps/desktop/src/main/notifier.ts`), which shows them and reports the focused topic. Its `summary` offers the summary to the agent over `host.notification.summaries` until the agent says it appended it (`host.notification.summaryTaken`), and returns the summary id; the chat keys the message by it (`summaryBubbleId`), so the click opens the Juno tab at it. The offer is held in memory: a summary the agent has not taken when the engine stops misses the chat, though its OS notification was shown.

## Tests

Run `pnpm test:notifications test/notifications.test.ts` from the root. The engine tests cover fake Slack input, duplicate events, timeout fallback, settings re-runs, focused-topic suppression, scheduled and missed summaries, source targets, and presence. Domain tests cover the pure decisions and calendar boundaries. Run `pnpm test` for the full suite.
