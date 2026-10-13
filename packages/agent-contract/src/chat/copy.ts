/**
 * The fixed words of the chat (SPEC "Juno Agent" and plan v3 §13.2). One
 * place, so the views, the gallery fixtures and the e2e driver print the
 * same strings. Juno's own replies are not here; they come from the model.
 *
 * SPEC §17 applies: sentence case, verb-first buttons, no emoji.
 */

export const chatCopy = {
  empty: {
    title: 'What do you need?',
    body: 'Ask me to find, summarize, catch you up or tidy up. I can read your topics and propose messages, but nothing is sent until you press Send.',
    suggestions: ['Catch me up on today', 'Summarize this topic', 'Tell Maya the Wednesday slot works for eng', 'Anything settled I can resolve?'],
  },
  composer: {
    placeholder: 'Ask Juno, like "what did I miss in #eng?"',
    send: 'Send',
  },
  delivery: {
    queued: 'Queued',
    notDelivered: 'Not delivered',
    tooLong: 'That is too long to send as one message. Split it up and send the parts.',
    tryAgain: 'Try again',
  },
  ending: {
    interrupted: 'Juno was interrupted. Your message is kept.',
    blocked: "Juno can't fit this in one request. Removing a pin or starting a smaller task helps.",
  },
  status: {
    stop: 'Stop',
  },
  note: {
    remembered: 'Remembered',
    removed: 'Removed',
    undo: 'Undo',
  },
  groupLabel: {
    why: 'Why this?',
    stopThese: 'Stop these',
  },
  banner: {
    paused: 'Juno is paused',
    resume: 'Resume',
    aiOff: 'Juno is off. Turn on AI assist in Settings.',
    offline: "You're offline. Juno shows what it has and catches up when you're back.",
    recovery: "Juno restored from backup. It won't act until you check pending actions.",
    review: 'Review',
    otherDevice: 'Juno is working on your other Mac.',
  },
  card: {
    expired: 'Expired · Ask again',
    unknownKind: 'This card needs a newer Juno',
    dismiss: 'Dismiss',
    sendMessage: { send: 'Send', sent: 'Sent', notSent: 'Not sent', open: 'Open', unknown: "Juno can't tell whether this was sent.", check: 'Check channel', sendAgain: 'Send again' },
    resolve: { resolve: 'Resolve' },
    task: { open: 'Open', stop: 'Stop', start: 'Start', lostSight: 'Sign in to T3 Code to keep watching', quiet: "T3 Code has been quiet for 30 minutes. I'll keep watching, or you can stop it." },
    question: { junoAsks: 'Juno asks', t3Asks: 'T3 Code asks', reply: 'Reply', chose: 'You chose' },
    schedule: { keep: 'Keep', start: 'Start', pause: 'Pause', delete: 'Delete', paused: 'Paused' },
    connect: { connect: 'Connect', notNow: 'Not now', connected: 'Connected' },
    change: { apply: 'Apply', applied: 'Applied', showAll: 'Show all' },
    remove: { remove: 'Remove', keep: 'Keep', alsoReply: "Also remove Juno's reply" },
    budget: { title: "Juno has used today's budget.", allow: 'Allow $1 more today', wait: 'Wait until tomorrow', allowed: 'Allowed until midnight' },
    provider: { title: 'Pick how Juno thinks', setUp: 'Set up', disclosure: 'Juno sends its memory of this chat to the provider you pick, on every turn.' },
    may: 'This may already have happened.',
  },
} as const

export type ChatCopy = typeof chatCopy
