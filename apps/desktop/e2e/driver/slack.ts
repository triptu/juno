/**
 * What other people do in Slack, in the driver's words:
 * `slack.as('Leo').replyIn(POSTGRES, 'Cutover is a go')`. Wraps the fake's
 * control API, finding people by first name and threads by their root's text.
 * It loads no test runner, so the browser, Electron and DOM lanes share it.
 */
import type { FakeSlack } from '@juno/fake-slack'

const MARK_METHODS = ['conversations.mark', 'subscriptions.thread.mark']

/** Polls `check` until it is true, or fails with `what` after `timeout`. */
async function within(what: string, check: () => boolean, timeout = 10_000): Promise<void> {
  const deadline = performance.now() + timeout
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Slack: timed out after ${timeout} ms waiting until ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export class Slack {
  constructor(readonly fake: FakeSlack) {}

  /** Someone in the workspace, by first name or handle. */
  as(name: string): Person {
    const wanted = name.toLowerCase()
    for (const user of this.fake.workspace.users.values()) {
      const first = (user.real_name ?? '').split(' ')[0]?.toLowerCase()
      if (user.name?.toLowerCase() === wanted || first === wanted) return new Person(this, user.id)
    }
    throw new Error(`No one called ${name} in the fake workspace`)
  }

  /** The channel and ts of the thread root that starts with `text`; a message without replies only when no root matches. */
  root(text: string): { readonly channel: string; readonly ts: string } {
    let single: { readonly channel: string; readonly ts: string } | undefined
    for (const channel of this.fake.workspace.conversations.keys()) {
      for (const message of this.fake.messages(channel)) {
        if (!message.text?.startsWith(text) || (message.thread_ts !== undefined && message.thread_ts !== message.ts)) continue
        if ((message.reply_count ?? 0) > 0) return { channel, ts: message.ts }
        single ??= { channel, ts: message.ts }
      }
    }
    if (single !== undefined) return single
    throw new Error(`No message starts with "${text}"`)
  }

  /** A channel's id by name, without the "#". */
  channel(name: string): string {
    for (const [id, conversation] of this.fake.workspace.conversations) if (conversation.name === name) return id
    throw new Error(`No channel #${name}`)
  }

  /** Forgets the calls so far, so later expectations look only at what follows. */
  resetCalls(): void {
    this.fake.resetCalls()
  }

  /** How many `tickle` frames Juno sent on the socket since the last `resetCalls`. */
  tickles(): number {
    return this.fake.received.filter((frame) => frame.type === 'tickle').length
  }

  /** The `presence_sub` frames Juno sent since the last `resetCalls`, oldest first: each one's ids. */
  presenceSubs(): ReadonlyArray<ReadonlyArray<string>> {
    return this.fake.received.filter((frame) => frame.type === 'presence_sub').map((frame) => frame.ids ?? [])
  }

  /** Juno's socket is subscribed to this person's presence, or with `false` no longer is, within 10 s. */
  async expectPresenceSubscribed(name: string, subscribed = true): Promise<void> {
    const { id } = this.as(name)
    await within(`${name}'s presence is ${subscribed ? '' : 'not '}subscribed`, () => this.fake.presenceSubscriptions().includes(id) === subscribed)
  }

  /** What colleagues see for you in Slack, within 10 s. */
  async expectSeenAs(presence: 'active' | 'away'): Promise<void> {
    await within(`colleagues see you ${presence}`, () => this.fake.selfPresence() === presence)
  }

  /** Time passes in Slack, as if `millis` went by: presence that depends on recent activity runs out. */
  advanceClock(millis: number): void {
    this.fake.advanceClock({ millis })
  }

  /** Juno set your presence in Slack: `active` or `away`, as the official client sends them. */
  async expectPresenceSet(presence: 'active' | 'away'): Promise<void> {
    await within(`presence.set ${presence}`, () => this.fake.calls.some((call) => call.method === 'presence.set' && call.args['presence'] === presence))
  }

  /** Juno sent no read mark to Slack since the last `resetCalls`. */
  async expectNoMarks(): Promise<void> {
    // Marks leave the engine in the background; give one a moment to show up.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const marks = this.fake.calls.filter((call) => MARK_METHODS.includes(call.method)).map((call) => call.method)
    if (marks.length > 0) throw new Error(`Slack: expected no read marks, got ${marks.join(', ')}`)
  }

  /** Juno marked the conversation read in Slack. */
  async expectMarked(channelName: string): Promise<void> {
    const id = this.channel(channelName)
    await within(`#${channelName} is marked read`, () => this.fake.calls.some((call) => call.method === 'conversations.mark' && call.args['channel'] === id))
  }
}

export class Person {
  constructor(
    readonly slack: Slack,
    readonly id: string,
  ) {}

  /** Goes active or away, as colleagues see it in Slack. */
  setPresence(presence: 'active' | 'away'): void {
    this.slack.fake.setPresence({ users: [this.id], presence })
  }

  /** Replies in the thread whose root starts with `rootText`. */
  replyIn(rootText: string, text: string): void {
    const root = this.slack.root(rootText)
    this.slack.fake.injectMessage({ channel: root.channel, threadTs: root.ts, user: this.id, text })
  }

  /** Sends you a DM. Returns the message ts. */
  dm(text: string): string {
    for (const [id, conversation] of this.slack.fake.workspace.conversations) {
      if (conversation.kind === 'im' && conversation.members.has(this.id)) return this.slack.fake.injectMessage({ channel: id, user: this.id, text }).ts
    }
    throw new Error(`No DM with ${this.id}`)
  }

  /** Says `text` in a group DM you share. Returns the message ts. */
  groupDm(text: string): string {
    for (const [id, conversation] of this.slack.fake.workspace.conversations) {
      if (conversation.kind === 'mpim' && conversation.members.has(this.id)) return this.slack.fake.injectMessage({ channel: id, user: this.id, text }).ts
    }
    throw new Error(`No group DM with ${this.id}`)
  }

  /**
   * Posted in a channel's Main `days` ago, with no event: Juno's cache does
   * not hold it, so only Slack's search finds it. Returns the message ts.
   */
  postedLongAgo(channelName: string, text: string, days: number): string {
    const workspace = this.slack.fake.workspace
    return workspace.post({ channel: this.slack.channel(channelName), user: this.id, text, at: workspace.clock.now() - days * 24 * 60 * 60 * 1000, silent: true }).ts
  }

  /** Posts in a channel's Main. Returns the message ts. */
  postIn(channelName: string, text: string): string {
    return this.slack.fake.injectMessage({ channel: this.slack.channel(channelName), user: this.id, text }).ts
  }
}
