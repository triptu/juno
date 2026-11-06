// Outbox directed schedules: `<name>Step` keeps every invariant and drains;
// `<name>BugStep` breaks the named property. Read by check.mjs and by the
// conformance run (conformance.mjs), which replays both against the engine.
export const outboxPairs = [
  ['blindRetry', 'atMostOnce', 'outbox-blind-retry'],
  ['crashResend', 'atMostOnce', 'outbox-crash-resend'],
  ['echoKeepsRow', 'noDoubleShow', 'outbox-echo-keeps-row'],
  ['answerAfterEcho', 'noDoubleShow', 'outbox-answer-after-echo'],
  ['actionBeforeStore', 'actionNeedsMessage', 'outbox-action-before-store'],
  ['actionOnDiscarded', 'noActionOnDiscarded', 'outbox-action-on-discarded'],
  ['reactionOnGone', 'reactionsLand', 'outbox-reaction-on-gone'],
  ['offlineSend', 'sendsWaitOffline', 'outbox-offline-send'],
  ['networkCopy', 'shownOnce', 'outbox-network-copy'],
  ['sameText', 'keepsRealSends', 'outbox-same-text'],
  ['keptDeleted', 'keepsRealSends', 'outbox-kept-deleted'],
  ['copyReply', 'repliesKeepRoot', 'outbox-copy-reply'],
  ['ownDelete', 'ownDeleteHolds', 'outbox-own-delete'],
  ['deletedOffline', 'keepsRealSends', 'outbox-deleted-offline'],
  ['uncoveredRecheck', 'keepsRealSends', 'outbox-uncovered-recheck'],
  ['deleteWhileUnknown', 'deletedNeverQueued', 'outbox-delete-while-unknown'],
  ['refusedLookup', 'drainBound', 'outbox-refused-lookup'],
]
// Corrected schedules with no broken variant.
export const outboxSchedules = ['pendingRoot', 'failedRoot', 'answerBeforeEcho', 'lostLookupAbsent', 'reconnectPage', 'dependentDelete', 'actionRetry', 'uploadRetry']
