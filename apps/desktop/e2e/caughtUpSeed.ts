import { seedWorkspace, type FakeSlackOptions } from '@juno/fake-slack'

type Seed = NonNullable<FakeSlackOptions['seed']>

/** The default seed with every conversation and followed thread read, then one unread DM from Maya: the dock dot's starting point. */
export const caughtUpSeed: Seed = (workspace, avatars) => {
  seedWorkspace(workspace, avatars)
  for (const channel of workspace.conversations.keys()) {
    const last = workspace.all(channel).at(-1)?.ts
    if (last !== undefined) workspace.markConversation(channel, last)
  }
  for (const sub of workspace.subscriptions.values()) {
    const last = workspace.all(sub.channel).at(-1)?.ts
    if (last !== undefined) workspace.markThread(sub.channel, sub.threadTs, last, true)
  }
  workspace.post({ channel: 'D0MAYA', user: 'U0MAYA', text: 'A DM before launch' })
}
