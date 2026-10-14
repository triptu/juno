/**
 * The fixed words of the chat (SPEC "Juno Agent" and plan v3 §13.2). One
 * place, so the views, the gallery fixtures and the e2e driver print the
 * same strings. Juno's own replies are not here; they come from the model.
 * Every line a failure or an ending prints is here, so the model never
 * writes one.
 *
 * SPEC §17 applies: sentence case, verb-first buttons, no emoji.
 */

export const chatCopy = {
  empty: {
    title: 'What do you need?',
    body: 'Ask me to find, summarize, catch you up or tidy up. I can read your topics and propose messages, but nothing is sent until you press Send.',
    suggestions: ['Catch me up on today', 'Summarize this topic', 'Draft a reply in this topic', 'Anything settled I can resolve?'],
  },
  composer: {
    placeholder: 'Ask Juno, like "what did I miss in #eng?"',
    send: 'Send',
  },
  list: {
    newMessage: 'New message',
    newDivider: 'New',
  },
  delivery: {
    queued: 'Queued',
    waiting: {
      network: 'Waiting for network',
      resume: 'Waiting for Resume',
      review: 'Waiting for your review',
    },
    notDelivered: 'Not delivered',
    tooLong: 'That is too long to send as one message. Split it up and send the parts.',
    tryAgain: 'Try again',
  },
  /** One line per `Ending` variant. `interrupted` and `failed` add "Try again" when the ending carries a retry op. */
  ending: {
    stopped: "Stopped. Juno won't start anything new for this reply.",
    interrupted: 'Juno was interrupted. Your message is kept.',
    blocked: {
      tooLarge: "Juno can't fit this in one request. Removing a pin or starting a smaller task helps.",
      budget: "Juno has used today's budget.",
    },
    failed: {
      provider: "Juno didn't answer. Give it a moment and try again.",
      keyRejected: 'OpenRouter rejected the key. Check it in Settings.',
      codexSignedOut: 'Codex is signed out on this Mac. Sign in to Codex and try again.',
      offline: 'Juno lost the connection. Try again when you are back online.',
    },
    tryAgain: 'Try again',
  },
  status: {
    stop: 'Stop',
  },
  note: {
    remembered: 'Remembered',
    removed: 'Removed',
    secretBlocked: 'Juno stopped a tool call that held a key or a token. Nothing was sent.',
    undo: 'Undo',
  },
  groupLabel: {
    why: 'Why this?',
    pauseSchedule: 'Pause schedule',
    muteUpdates: 'Mute updates',
  },
  /** `chip` is the header chip; `line` is the full sentence (the chip's title, or the one line under the list for AI off). */
  banner: {
    paused: { chip: 'Juno is paused', line: 'Juno is paused. Messages wait until you resume.', resume: 'Resume' },
    aiOff: { chip: 'Juno is off', line: 'Juno is off. Turn on AI assist in Settings.' },
    offline: { chip: "You're offline", line: "You're offline. Juno shows what it has and catches up when you're back." },
    recovery: { chip: 'Juno restored from backup', line: "Juno restored from backup. It won't act until you check pending actions.", review: 'Review' },
    updateNeeded: { chip: 'Juno needs an update', line: 'Juno needs to update its records before it can run. Nothing is lost.' },
    otherDevice: { chip: 'Juno is on your other Mac', line: 'Juno is working on your other Mac.' },
  },
  card: {
    expired: 'Expired',
    askAgain: 'Ask again',
    unknownKind: 'This card needs a newer Juno',
    dismiss: 'Dismiss',
    may: 'This may already have happened.',
    /** Beside every retry of an action whose destination does not deduplicate, whatever the first outcome (plan v3 §6.3). */
    mayDuplicate: 'If the first try went through, this does it again.',
    sendMessage: { send: 'Send', sent: 'Sent', notSent: 'Not sent', open: 'Open', unknown: "Juno can't tell whether this was sent.", check: 'Check channel', sendAgain: 'Send again' },
    resolve: { resolve: 'Resolve' },
    task: {
      open: 'Open',
      stop: 'Stop',
      start: 'Start',
      started: 'Started',
      done: 'Done',
      failed: 'Failed',
      showInActivity: 'Show in Activity',
      stopping: 'Stopping',
      stopped: 'Stopped',
      unknown: "Juno can't tell whether this is running.",
      lostSight: 'Sign in to T3 Code to keep watching',
      signIn: 'Sign in',
      quiet: "T3 Code has been quiet for 30 minutes. I'll keep watching, or you can stop it.",
    },
    question: { junoAsks: 'Juno asks', t3Asks: 'T3 Code asks', reply: 'Reply', chose: 'You chose', replied: 'You replied' },
    schedule: { keep: 'Keep', start: 'Start', pause: 'Pause', delete: 'Delete', kept: 'Kept', started: 'Started', paused: 'Paused', deleted: 'Deleted' },
    connect: { connect: 'Connect', skip: 'Skip', connected: 'Connected' },
    change: { apply: 'Apply', applied: 'Applied', showAll: 'Show all' },
    remove: { remove: 'Remove', keep: 'Keep', alsoReply: "Also remove Juno's reply", cannotRecall: 'Copies already sent to the model provider cannot be recalled.' },
    budget: { title: "Juno has used today's budget.", allow: 'Allow $1 more today', wait: 'Wait until tomorrow', allowed: 'Allowed until midnight' },
    provider: { title: 'Choose a model provider', setUp: 'Set up', disclosure: 'Juno sends its memory of this chat to the provider you choose, on every turn.' },
  },
  /** The local Remove sheet from a message's context menu. */
  removeSheet: {
    title: 'Remove from Juno',
    body: 'This deletes the message, what Juno learned from it, and any pending action that saw it.',
    cannotRecall: 'Copies already sent to the model provider cannot be recalled.',
    alsoReply: "Also remove Juno's reply",
    remove: 'Remove',
    keep: 'Keep',
  },
  contextMenu: {
    copy: 'Copy',
    remember: 'Remember this',
    remove: 'Remove',
  },
  pages: {
    activity: {
      outcome: { replied: 'Replied', stopped: 'Stopped', interrupted: 'Interrupted', blocked: 'Blocked', failed: 'Failed', stayedQuiet: 'Stayed quiet' },
      copyDetails: 'Copy details',
    },
    memory: { beingUpdated: 'being updated' },
    remembers: { changed: 'This changed. Check it and save again.', full: 'Juno remembers as much as it can. Remove a line to add another.' },
    review: {
      title: 'Check what was pending',
      body: 'Juno restored from a backup. These actions were waiting. Each may already have happened. Approve the ones you still want, then activate Juno.',
      activate: 'Activate Juno',
    },
    settings: {
      removalPending: 'Removal pending',
      stopJob: 'Stop job',
      keyRejected: 'OpenRouter rejected this key',
      exportPhrase: 'Export recovery phrase',
      move: 'Move to another Mac',
      restore: 'Restore from backup',
      attest: 'Confirm the old Mac is off, erased, or has Juno removed. Juno cannot check this.',
      allowNetwork: 'Allow T3 Code over the local network',
      allowNetworkNote: 'Only an https address works over the network.',
    },
  },
} as const

export type ChatCopy = typeof chatCopy
