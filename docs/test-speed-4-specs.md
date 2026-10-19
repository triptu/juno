# Desktop e2e per-spec timings

Summed test-attempt seconds, including setup, teardown and retries. Skips add zero.
These overlap across three workers and cannot be added to remote wall time.
The before run and first snapshot run each contain the same header failure and cold-sync retry.
See [Test speed round 4](test-speed-4.md) for suite results, build costs and limitations.

| Spec | Before | First snapshot | Final 1 | Final 2 |
| --- | ---: | ---: | ---: | ---: |
| `actions.spec.ts` | 14.7 | 13.9 | 13.4 | 13.4 |
| `ai-activity.spec.ts` | 6.2 | 6.0 | 5.9 | 5.9 |
| `ai-errors.spec.ts` | 12.5 | 12.6 | 13.2 | 12.5 |
| `ai-key.spec.ts` | 7.9 | 7.1 | 7.0 | 7.1 |
| `all-topics.spec.ts` | 21.2 | 21.2 | 20.4 | 20.8 |
| `app.spec.ts` | 11.2 | 11.7 | 11.6 | 11.2 |
| `art.spec.ts` | 16.5 | 15.2 | 15.9 | 16.0 |
| `attachments.spec.ts` | 44.2 | 34.0 | 35.1 | 34.6 |
| `automated-record.spec.ts` | 12.8 | 8.2 | 9.5 | 9.6 |
| `automated.spec.ts` | 17.0 | 18.9 | 17.1 | 18.3 |
| `avatars-unfurls.spec.ts` | 17.1 | 15.0 | 13.9 | 14.0 |
| `break-pass-1017-input.spec.ts` | 24.1 | 17.7 | 16.9 | 16.7 |
| `break-pass-1017.spec.ts` | 73.6 | 58.1 | 57.3 | 60.0 |
| `break-pass-1017b.spec.ts` | 29.3 | 19.7 | 20.2 | 20.0 |
| `break-pass.spec.ts` | 28.2 | 19.2 | 20.8 | 20.4 |
| `cache-update.spec.ts` | 5.2 | 6.2 | 5.7 | 6.0 |
| `classifier.spec.ts` | 3.3 | 3.1 | 2.7 | 3.1 |
| `conversation-search.spec.ts` | 2.7 | 2.8 | 2.6 | 2.7 |
| `diagnostics.spec.ts` | 7.5 | 7.7 | 7.4 | 7.0 |
| `emoji-colon.spec.ts` | 11.4 | 9.9 | 9.4 | 7.7 |
| `engine.spec.ts` | 17.2 | 15.8 | 15.9 | 15.0 |
| `grammar-spelling.spec.ts` | 24.6 | 23.9 | 24.5 | 23.7 |
| `home-send-tab.spec.ts` | 12.3 | 8.7 | 8.8 | 9.2 |
| `home-thoughts.spec.ts` | 4.6 | 5.6 | 5.4 | 4.3 |
| `home-topic.spec.ts` | 4.9 | 3.6 | 3.9 | 4.1 |
| `home-write.spec.ts` | 31.0 | 23.6 | 23.1 | 23.3 |
| `home.spec.ts` | 27.7 | 26.2 | 26.8 | 26.1 |
| `huddle.spec.ts` | 9.0 | 9.5 | 9.2 | 9.1 |
| `idleJourney.ts` | 54.4 | 54.5 | 54.5 | 54.0 |
| `integration-messages.spec.ts` | 2.9 | 3.0 | 2.7 | 3.1 |
| `juno-agent/auto-review.spec.ts` | 7.8 | 8.0 | 8.3 | 8.2 |
| `juno-agent/backup.spec.ts` | 9.6 | 9.4 | 9.3 | 9.2 |
| `juno-agent/break-pass-1017.spec.ts` | 18.1 | 16.4 | 16.5 | 17.5 |
| `juno-agent/break-pass.spec.ts` | 12.2 | 12.2 | 11.8 | 11.8 |
| `juno-agent/cards.spec.ts` | 25.9 | 20.6 | 20.0 | 21.3 |
| `juno-agent/chat-reactions.spec.ts` | 9.3 | 9.1 | 9.0 | 9.5 |
| `juno-agent/chat.spec.ts` | 48.8 | 49.9 | 43.8 | 45.9 |
| `juno-agent/codemode.spec.ts` | 5.4 | 6.7 | 5.4 | 5.9 |
| `juno-agent/connections.spec.ts` | 7.2 | 8.4 | 7.5 | 8.4 |
| `juno-agent/crash.spec.ts` | 129.1 | 135.7 | 122.3 | 122.8 |
| `juno-agent/hello.spec.ts` | 3.6 | 3.6 | 3.5 | 3.2 |
| `juno-agent/images.spec.ts` | 11.4 | 11.1 | 9.6 | 9.7 |
| `juno-agent/learn.spec.ts` | 7.1 | 7.3 | 6.3 | 5.3 |
| `juno-agent/mcp.spec.ts` | 8.0 | 7.3 | 5.6 | 7.4 |
| `juno-agent/memory.spec.ts` | 23.0 | 24.2 | 21.7 | 20.1 |
| `juno-agent/mentions.spec.ts` | 8.4 | 9.3 | 6.7 | 7.6 |
| `juno-agent/notifications.spec.ts` | 11.3 | 13.6 | 12.2 | 11.6 |
| `juno-agent/pages.spec.ts` | 9.1 | 9.0 | 6.8 | 7.6 |
| `juno-agent/panel-shots.spec.ts` | 0.0 | 0.0 | 0.0 | 0.0 |
| `juno-agent/people.spec.ts` | 13.4 | 15.5 | 12.5 | 13.1 |
| `juno-agent/providers-ui.spec.ts` | 10.7 | 12.0 | 9.7 | 10.6 |
| `juno-agent/providers.spec.ts` | 10.7 | 10.4 | 9.7 | 7.7 |
| `juno-agent/resolve.spec.ts` | 4.4 | 4.7 | 4.1 | 3.5 |
| `juno-agent/schedule.spec.ts` | 30.0 | 32.1 | 29.2 | 29.4 |
| `juno-agent/selection.spec.ts` | 8.3 | 8.3 | 8.3 | 9.1 |
| `juno-agent/set-up.spec.ts` | 6.7 | 8.0 | 6.9 | 6.3 |
| `juno-agent/source-link.spec.ts` | 8.2 | 6.9 | 7.4 | 6.2 |
| `juno-agent/states.spec.ts` | 53.9 | 54.1 | 49.8 | 53.1 |
| `juno-agent/steer.spec.ts` | 4.9 | 4.9 | 4.2 | 4.1 |
| `juno-agent/switcher.spec.ts` | 10.2 | 10.4 | 9.2 | 9.8 |
| `juno-agent/t3.spec.ts` | 41.9 | 40.0 | 39.9 | 39.3 |
| `juno-agent/tool-approval.spec.ts` | 22.0 | 22.8 | 21.7 | 21.8 |
| `juno-agent/transfer.spec.ts` | 46.7 | 44.4 | 44.0 | 43.4 |
| `juno-agent/writes.spec.ts` | 25.2 | 23.1 | 22.5 | 21.7 |
| `layout-shift.spec.ts` | 65.2 | 80.6 | 48.9 | 48.4 |
| `links.spec.ts` | 7.6 | 5.2 | 7.0 | 8.7 |
| `live.spec.ts` | 13.0 | 9.1 | 11.0 | 12.7 |
| `main-new-threads.spec.ts` | 4.3 | 1.9 | 5.6 | 6.2 |
| `mark-unread.spec.ts` | 23.0 | 16.3 | 17.2 | 18.3 |
| `media.spec.ts` | 20.7 | 12.1 | 15.0 | 15.4 |
| `mentions.spec.ts` | 10.8 | 6.9 | 5.8 | 5.8 |
| `menus.spec.ts` | 3.7 | 2.3 | 2.1 | 1.8 |
| `message-actions.spec.ts` | 33.5 | 24.7 | 25.1 | 24.0 |
| `mirror-reads.spec.ts` | 6.7 | 5.0 | 5.0 | 4.8 |
| `navigation.spec.ts` | 30.4 | 24.1 | 20.7 | 21.1 |
| `new-message-typing.spec.ts` | 14.3 | 7.8 | 7.6 | 7.8 |
| `notifications.spec.ts` | 33.7 | 27.1 | 25.4 | 25.2 |
| `palette-pages.spec.ts` | 5.3 | 3.6 | 3.2 | 3.8 |
| `palette.spec.ts` | 40.9 | 27.3 | 27.7 | 26.5 |
| `peek.spec.ts` | 22.2 | 16.4 | 16.3 | 15.3 |
| `pending-menu.spec.ts` | 4.5 | 3.1 | 3.1 | 2.8 |
| `perf.spec.ts` | 0.0 | 0.0 | 0.0 | 0.0 |
| `presence.spec.ts` | 16.1 | 15.5 | 16.0 | 30.6 |
| `privacy-sharing.spec.ts` | 12.5 | 7.4 | 7.8 | 6.4 |
| `privacy.spec.ts` | 14.6 | 10.4 | 10.2 | 10.6 |
| `quick-reactions.spec.ts` | 15.4 | 12.5 | 12.1 | 11.3 |
| `quick-start.perf.spec.ts` | 0.0 | 0.0 | 0.0 | 0.0 |
| `quick-start.spec.ts` | 38.0 | 35.5 | 36.7 | 32.9 |
| `quiet-window.spec.ts` | 4.1 | 3.8 | 3.7 | 2.8 |
| `reaction-delivery.spec.ts` | 40.0 | 41.5 | 35.2 | 37.4 |
| `reactors.spec.ts` | 4.8 | 3.5 | 3.6 | 2.7 |
| `realtime.spec.ts` | 106.7 | 110.3 | 106.2 | 101.9 |
| `review-cards.spec.ts` | 7.5 | 7.7 | 6.7 | 7.5 |
| `screens.spec.ts` | 0.0 | 0.0 | 0.0 | 0.0 |
| `send-checks.spec.ts` | 74.1 | 59.1 | 58.9 | 59.6 |
| `send-while-staging.spec.ts` | 9.2 | 6.5 | 6.1 | 6.1 |
| `send.spec.ts` | 30.0 | 18.0 | 18.5 | 17.4 |
| `session.spec.ts` | 25.8 | 23.4 | 23.9 | 25.3 |
| `settled-review.spec.ts` | 12.0 | 7.6 | 6.6 | 6.8 |
| `sidebar-hold.spec.ts` | 15.0 | 8.4 | 8.2 | 8.2 |
| `sidebar-preview.spec.ts` | 3.3 | 2.0 | 2.1 | 2.0 |
| `sidebar.spec.ts` | 34.9 | 23.0 | 23.9 | 24.1 |
| `slack-links.spec.ts` | 13.8 | 12.5 | 13.1 | 13.0 |
| `stick-bottom.spec.ts` | 17.8 | 15.1 | 15.0 | 15.0 |
| `suggestions.spec.ts` | 17.2 | 14.9 | 14.4 | 14.2 |
| `tabs.spec.ts` | 57.1 | 43.0 | 43.5 | 43.5 |
| `text-menu.spec.ts` | 4.9 | 3.3 | 3.2 | 3.7 |
| `theme.spec.ts` | 2.3 | 2.2 | 2.0 | 2.2 |
| `thread-root.spec.ts` | 6.8 | 4.4 | 4.5 | 4.3 |
| `topic-titles.spec.ts` | 24.0 | 21.9 | 21.1 | 21.0 |
| `topic.perf.spec.ts` | 0.0 | 0.0 | 0.0 | 0.0 |
| `topic.spec.ts` | 50.3 | 44.3 | 33.3 | 33.3 |
| `updates.spec.ts` | 7.9 | 6.9 | 6.0 | 6.2 |
| `usergroups.spec.ts` | 4.8 | 4.6 | 4.3 | 4.0 |
| `views.spec.ts` | 29.3 | 26.6 | 24.1 | 24.6 |
| `web-panel.spec.ts` | 14.1 | 12.2 | 11.8 | 12.3 |
| `welcome.spec.ts` | 14.1 | 13.4 | 16.5 | 16.6 |

Source reports:

- `.remote/juno-1792431019901-14222-9b0514c4/run.log`
- `.remote/juno-1792434024551-50826-09476a3a/run.log`
- `.remote/juno-1792435161057-62594-ed832ac4/run.log`
- `.remote/juno-1792435972671-67543-cc0912a0/run.log`
