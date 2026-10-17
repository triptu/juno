/**
 * The fixed words of the chat (SPEC "Juno Agent" and plan v3 §13.2). One
 * place, so the views, the gallery fixtures and the e2e driver print the
 * same strings. Juno's own replies are not here; they come from the model.
 * Every line a failure or an ending prints is here, so the model never
 * writes one. Lines with a number or a name in them are functions
 * ("Resolved 3", "Using Claude Sonnet 5.5"), so a count is never pasted
 * into a string by a view.
 *
 * SPEC §17 applies: sentence case, verb-first buttons, no emoji.
 */

/** "$2.00", "$0.35". Two decimals, always. */
const usd = (amount: number): string => `$${amount.toFixed(2)}`

const priceUsd = (amount: number) => Number.isInteger(amount) ? `$${amount}` : usd(amount)

export const chatCopy = {
  modelPrice: (input: number, output: number) => `${priceUsd(input)} in, ${priceUsd(output)} out per million tokens`,
  empty: {
    title: 'What do you need?',
    body: 'Ask me to find, summarize, catch you up or tidy up. I can read your topics and propose messages, but nothing is sent until you press Send.',
    suggestions: ['Catch me up on today', 'Summarize this topic', 'Draft a reply in this topic', 'Find topics I can resolve'],
  },
  composer: {
    placeholder: 'Ask Juno, like "what did I miss in #eng?"',
    /** In the Juno panel beside a topic. */
    panelPlaceholder: 'Ask about this topic',
    send: 'Send',
  },
  /** The About line over an owner bubble and the About chip above the panel's composer (SPEC 7). */
  about: {
    prefix: 'About ',
    remove: 'Remove',
  },
  /** A Juno page's tab title, as the Juno menu names it (SPEC 13.10). */
  pageTitles: {
    scheduled: 'Scheduled',
    remembers: 'What Juno remembers',
    memory: 'Memory of this chat',
    activity: 'Activity',
    connections: 'Connections',
    settings: 'Settings',
    review: 'Review',
  },
  /** The Juno panel (SPEC 7, inventory 12.1). */
  panel: {
    openInTab: 'Open in a tab',
    close: 'Close Juno',
    removeQuote: 'Remove quote',
    /** The context chips in the composer: what Juno sees with the next message. */
    contextLabel: (place: string) => `Juno sees ${place}`,
    selection: 'Selection',
    removeSelection: 'Remove selection',
  },
  list: {
    newMessage: 'New message',
    newDivider: 'New',
  },
  delivery: {
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
    interrupted: 'Juno was interrupted. Your message is kept.',
    blocked: {
      tooLarge: "Juno can't fit this in one request. Removing a pin or starting a smaller task helps.",
      budget: "Juno has used today's budget.",
    },
    failed: {
      provider: "Juno didn't answer. Give it a moment and try again.",
      missingKey: 'Add an OpenRouter key in Settings to send this message.',
      rateLimited: 'The provider is busy. Your message is kept. Try again shortly.',
      keyRejected: 'OpenRouter rejected the key. Check it in Settings.',
      codexMissing: 'Codex is not installed on this Mac. Install Codex and try again.',
      codexQuota: 'Codex has used the available ChatGPT quota. Try again when it resets.',
      codexCrash: 'Codex stopped before finishing. Check any action cards before trying again.',
      codexSignedOut: 'Codex is signed out on this Mac. Sign in to Codex and try again.',
      offline: 'Juno lost the connection. Try again when you are back online.',
    },
    tryAgain: 'Try again',
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
    paused: { chip: 'Juno is paused', line: 'Juno is paused. Messages you send wait until you resume.', resume: 'Resume' },
    aiOff: { chip: 'Juno is off', line: 'Juno is off. Turn on AI assist in Settings.' },
    offline: { chip: "You're offline", line: "You're offline. Juno shows what it has and catches up when you're back." },
    recovery: { chip: 'Juno restored from backup', line: "Juno restored from backup. It won't act until you check pending actions.", review: 'Review' },
    updateNeeded: { chip: 'Juno needs an update', line: 'Juno needs to update its records before it can run. Nothing is lost.' },
    otherDevice: { chip: 'Juno is on your other Mac', line: 'Juno is working on your other Mac.' },
  },
  card: {
    /** The header's kind label, by card `_tag`. A `question` card's header is its asker instead. */
    kind: {
      sendMessage: 'Send message',
      resolve: 'Resolve',
      topics: 'Topics',
      proposedTask: 'Proposed task',
      task: 'Task',
      question: 'Question',
      proposedSchedule: 'Proposed schedule',
      schedule: 'Schedule',
      connect: 'Connect',
      change: 'Change',
      remove: 'Remove',
      budget: 'Budget',
      provider: 'Provider',
      unknown: 'Card',
    },
    /** The source beside a task's kind: where the job runs. */
    jobKind: { t3: 'T3 Code', subagent: 'Juno' },
    /** Prefix of the "Because" line. */
    because: 'Because ',
    dismissed: 'Dismissed',
    expired: 'Expired',
    askAgain: 'Ask again',
    unknownKind: 'This card needs a newer Juno',
    dismiss: 'Dismiss',
    may: 'This may already have happened.',
    /** A row, or a whole card, that was rejected or that Juno could not confirm. No button follows it. */
    failed: 'Failed',
    sendMessage: {
      send: 'Send',
      sent: 'Sent',
      /** The card's own line: "Sent", "Sent 3". */
      sentCount: (sent: number) => (sent === 1 ? 'Sent' : `Sent ${sent}`),
      /** "Sent 1 of 3". */
      sentOf: (sent: number, of: number) => `Sent ${sent} of ${of}`,
      open: 'Open',
      /** "in {topic title}" beside a reply inside a thread. */
      inTopic: (title: string) => `in ${title}`,
    },
    resolve: {
      resolve: 'Resolve',
      /** "Resolve 2 topics". */
      title: (count: number) => (count === 1 ? 'Resolve 1 topic' : `Resolve ${count} topics`),
      /** "Resolved 3". */
      resolved: (count: number) => `Resolved ${count}`,
    },
    task: {
      open: 'Open',
      stop: 'Stop',
      start: 'Start',
      started: 'Started',
      done: 'Done',
      /** "Open PR 412". */
      openPr: (number: number) => `Open PR ${number}`,
      failed: 'Failed',
      showInActivity: 'Show in Activity',
      stopping: 'Stopping',
      stopFailed: 'Could not stop the task. Open it in T3 Code.',
      stopped: 'Stopped',
      lostSight: 'Sign in to T3 Code to keep watching',
      signIn: 'Sign in',
    },
    question: {
      junoAsks: 'Juno asks',
      t3Asks: 'T3 Code asks',
      reply: 'Reply',
      /** "You chose Keep both". */
      chose: (label: string) => `You chose ${label}`,
      replied: 'You replied',
    },
    schedule: {
      keep: 'Keep',
      start: 'Start',
      pause: 'Pause',
      delete: 'Delete',
      kept: 'Kept',
      started: 'Started',
      paused: 'Paused',
      deleted: 'Deleted',
      /** "Delivers: Now", "Delivers: Digest", "Delivers: Silent". */
      delivers: { now: 'Delivers: Now', digest: 'Delivers: Digest', silent: 'Delivers: Silent' },
    },
    connect: { connect: 'Connect', skip: 'Skip', connected: 'Connected' },
    change: {
      apply: 'Apply',
      applied: 'Applied',
      showAll: 'Show all',
      /** The auto-review's one line on a connection call (SPEC 13.9): why Juno asked, or why it ran without asking. */
      review: {
        always: 'Asked because your rule for this tool is Always ask.', failed: "Asked because Juno couldn't review this call.",
        notAsked: "Asked because you didn't ask for this.", untrusted: 'Asked because only something Juno read asked for this.',
        implied: "Asked because you didn't ask for exactly this.", delete: "Asked because deleting can't be undone.",
        send: "Asked because sending can't be undone.", write: "Asked because this change can't be undone.",
        ranExplicit: 'Ran without asking because you asked for it and it can be undone.',
        ranNever: 'Ran without asking because your rule for this tool is Never ask.',
        ruleChanged: 'Asked because your rule for this tool changed.',
      },

    },
    remove: {
      remove: 'Remove',
      keep: 'Keep',
      alsoReply: "Also remove Juno's reply",
      cannotRecall: 'Copies already sent to the model provider cannot be recalled.',
      /** "Removed 2 messages". */
      removed: (count: number) => (count === 1 ? 'Removed 1 message' : `Removed ${count} messages`),
    },
    budget: {
      title: "Juno has used today's budget.",
      /** "$2.00 of $2.00 today". */
      spent: (spentUsd: number, capUsd: number) => `${usd(spentUsd)} of ${usd(capUsd)} today`,
      allow: 'Allow $1 more today',
      wait: 'Wait until tomorrow',
      allowed: 'Allowed until midnight',
    },
    provider: {
      title: 'Choose a model provider',
      setUp: 'Set up',
      disclosure: 'Juno sends its memory of this chat to the provider you choose, on every turn.',
      /** "Using Claude Sonnet 5.5". */
      using: (model: string) => `Using ${model}`,
    },
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
  /** Reactions and replies. The emoji itself is content; these are the labels around it. */
  react: {
    react: 'React',
    reply: 'Reply',
    /** The sender beside a quote of a Juno bubble or card, and of one of yours. */
    juno: 'Juno',
    you: 'You',
    /** The reaction picker's name and its field for any emoji (the system picker works there too). */
    picker: 'Reactions',
    anyEmoji: 'Any emoji',
    /** A reaction's accessible name: "Reacted 🎉". */
    reacted: (emoji: string) => `Reacted ${emoji}`,
    /** The composer's close button on a quote. */
    clearQuote: 'Remove quote',
    /** A quote whose target was removed. */
    removed: 'Removed',
  },
  /**
   * Model providers (SPEC 13.10): the Juno tab's and panel's state with none
   * set up, and the provider section of Settings › Juno.
   */
  providers: {
    noneTitle: 'Juno needs a model',
    noneBody: 'Juno runs on a model provider you choose: OpenRouter, or a model on this Mac or another OpenAI-compatible service.',
    add: 'Add a provider',
    heading: 'Provider',
    sub: 'Juno uses one at a time. Keys stay in your keychain.',
    openRouter: 'OpenRouter',
    custom: 'OpenAI-compatible',
    customNote: 'A model server such as Ollama, LM Studio or vLLM, or another service.',
    key: 'API key',
    keyOptional: 'API key (optional)',
    baseUrl: 'Base URL',
    save: 'Save',
    remove: 'Remove',
    /** Under the fields of the provider in use: "OpenRouter is in use." */
    inUse: (name: string) => `${name} is in use.`,
    keySet: 'Key set',
    invalidKey: 'That is not a key. Keys have no spaces.',
    invalidUrl: 'Enter an http or https address.',
    failed: 'The keychain did not save the key. Try again.',
    customRejected: 'The endpoint rejected this key',
    modelId: 'Model id',
    modelTyped: 'This endpoint does not list its models. Type the id of the one to use.',
    spendUntracked: 'This model reports no prices, so the daily limit cannot track what it costs.',
  },
  contextMenu: {
    copy: 'Copy',
    remember: 'Remember this',
    remove: 'Remove',
  },
  pages: {
    activity: {
      outcome: { replied: 'Replied', interrupted: 'Interrupted', blocked: 'Blocked', failed: 'Failed', stayedQuiet: 'Stayed quiet' },
      /** Who asked, for a run without a named job. */
      who: { owner: 'You', click: 'You', wake: 'A schedule', report: 'A job' },
      copyDetails: 'Copy details',
    },
    memory: { beingUpdated: 'being updated' },
    remembers: { changed: 'This changed. Check it and save again.', full: 'Juno remembers as much as it can. Remove a line to add another.' },
    review: {
      title: 'Check what was pending',
      body: 'Juno restored from a backup. These actions were waiting. Each may already have happened. Approve the ones you still want, then activate Juno.',
      activate: 'Activate Juno',
      /** Shown when no trusted deletion record checked the backup (SPEC 13.8). */
      unchecked: "Juno can't check that this backup is the newest. If the folder is out of date, messages you removed may come back. You can remove them again.",
      /** "Move code 7KQ2-M9XA. Check that your other Mac shows the same code." */
      moveCode: (code: string) => `Move code ${code}. Check that your other Mac shows the same code.`,
    },
    settings: {
      /** "Removal pending · 1 copy in a running job". */
      removalPending: (copies: number) => `Removal pending · ${copies === 1 ? '1 copy' : `${copies} copies`} in a running job`,
      stopJob: 'Stop job',
      missingKey: 'Add an OpenRouter key in Settings to send this message.',
      rateLimited: 'The provider is busy. Your message is kept. Try again shortly.',
      keyRejected: 'OpenRouter rejected this key',
      /** Under the rules when the agent refused the list. */
      rulesInvalid: 'Each rule is one line, a sentence or two, and there are at most 20.',
      exportPhrase: 'Export recovery phrase',
      move: 'Move to another Mac',
      restore: 'Restore from backup',
      attest: 'Confirm the old Mac is off, erased, or has Juno removed. Juno cannot check this.',
      /** Who owns Juno's state, by `Ownership`: the chip, then the line beside it. */
      owner: {
        active: { chip: 'Active here', line: 'This Mac owns Juno’s state.' },
        moving: { chip: 'Moving', line: 'Writing the final backup. This Mac is read-only.' },
        moved: { chip: 'Moved', line: (code: string) => `Move code ${code}. Restore from this backup on your other Mac and check that it shows the same code.` },
        otherMac: { chip: 'Another Mac', line: (name: string) => `Juno is working on ${name === '' ? 'your other Mac' : name}. This Mac is read-only.` },
        recovery: { chip: 'Recovery', line: (pending: number) => `Restored from a backup. ${pending === 1 ? '1 action was' : `${pending} actions were`} pending.` },
      },
      /** Shown once after Export recovery phrase. */
      phraseSheet: {
        title: 'Your recovery phrase',
        body: 'It opens your backup on another Mac. Juno shows it only this once, so keep it in your password manager.',
        copy: 'Copy',
        copied: 'Copied',
        done: 'Done',
      },
      restoreSheet: {
        title: 'Restore from backup',
        body: 'Juno replaces its state on this Mac with the backup, then waits until you review what was pending.',
        folder: 'Backup folder',
        noFolder: 'No folder chosen',
        choose: 'Choose folder',
        phrase: 'Recovery phrase',
        phraseNote: 'Needed on a new Mac. Leave it empty on the Mac that made the backup.',
        phraseInvalid: 'That is not a recovery phrase. Check it and try again.',
        attest: 'The old Mac is off, erased, or has Juno removed',
        attestNote: 'Juno cannot check this. If Juno is still running on the old Mac, both Macs can act until it sees this Mac’s backup, which happens only if they share a backup folder.',
        restore: 'Restore',
        cancel: 'Cancel',
      },
      moveSheet: {
        title: 'Move to another Mac',
        body: 'Juno finishes what is running, makes this Mac read-only and writes a final backup. Then restore from that backup on your other Mac.',
        move: 'Move',
        cancel: 'Cancel',
      },
      allowNetwork: 'Allow T3 Code over the local network',
      allowNetworkNote: 'Tries this Mac first. Network sign-in may require https.',
    },
    connections: {
      intro: "Where Juno can read and act. Reads run on their own. Before anything else, Juno checks how clearly you asked and whether it can be undone, and asks you when it can't tell.",
      configure: 'Configure',
      /** The Configure sheet's title. */
      tools: (label: string) => `${label} tools`,
      search: 'Search tools',
      tool: 'Tool', enabled: 'Enabled', autoReview: 'Auto-review', read: 'Read',
      rules: { auto: 'Auto', always: 'Always ask', never: 'Never ask' },
      connectionRule: 'Auto-review for all tools',
      connectionRuleNote: "A tool's own rule comes first. Never ask still asks for a delete, or when only something Juno read asked for the call.",
      changed: 'Changed',
      added: 'New',
      /** Why a fixed rule is fixed, under the tool's name. */
      locked: { delete: "Deleting can't be undone, so Juno always asks.", forbidden: 'Juno never merges, buys or force-pushes.' },
      notOffered: 'Not offered',
      noTools: 'Connect to see its tools.', noMatch: 'No tools match.', done: 'Done',
      connect: 'Connect',
      signIn: 'Sign in',
      cancel: 'Cancel',
      disconnect: 'Disconnect',
      remove: 'Remove',
      signingIn: 'Your browser is open to finish signing in.',
      add: 'Add a server',
      addSub: 'Any MCP server by its address. Juno signs in if the server asks.',
      name: 'Name',
      address: 'Address',
      addButton: 'Add',
      t3Address: 'T3 Code address',
      invalidAddress: 'Use an https address, or http on this Mac.',
      failed: 'That did not work. Check the connection and try again.',
    },
  },
} as const
