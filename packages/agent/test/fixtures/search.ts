import { HostChannelId, type HostMessage, type HostSearchPage } from '@juno/agent-contract'

/** Messages as a `slack_search` page, each in its channel's Main. */
export function searchPage(messages: ReadonlyArray<{ readonly channelId: string; readonly channelName?: string }>): typeof HostSearchPage.Type {
  return {
    matches: messages.map((m) => ({
      topic: { topicId: `m:${m.channelId}`, title: m.channelName ?? m.channelId, where: m.channelName ?? m.channelId, tint: 'public' },
      channelId: HostChannelId.make(m.channelId), time: 'Wed, 2025-10-15, 09:16', message: m as typeof HostMessage.Type,
    })),
    notes: [],
  }
}
