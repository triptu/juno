import type { AskId, AskStatus, ProactiveAsk } from '@juno/agent-contract'
import { defineFixtures, fixture } from '@juno/ui'
import { AskCard, type AskCardProps } from './AskCard'
import { noopActions } from './commands'
import { NOW } from './fixtures/data'

const ask = (status: AskStatus, more: Partial<ProactiveAsk> = {}): ProactiveAsk => ({ id: 'a1' as AskId, kind: 'learn', reason: 'setup', sources: ['Littlebird', 'Notion'], status, at: NOW, ...more })
const card = (status: AskStatus, more: Partial<ProactiveAsk> = {}) => fixture<AskCardProps>({ ask: ask(status, more), actions: noopActions, enter: false })

/** Juno's proactive ask to learn how the owner works (SPEC 13.6, 13.8), in every state its footer has. */
export default defineFixtures(
  AskCard,
  {
    Learn: {
      open: card({ _tag: 'open' }),
      'slack-only': card({ _tag: 'open' }, { sources: [] }),
      connection: card({ _tag: 'open' }, { reason: 'connection', connection: 'Notion', sources: ['Notion'] }),
      running: card({ _tag: 'running', line: 'Reading your messages' }),
      done: card({ _tag: 'done', written: 14 }),
      'done-nothing': card({ _tag: 'done', written: 0 }),
      'failed-budget': card({ _tag: 'failed', reason: 'budget', written: 4 }),
      stopped: card({ _tag: 'stopped', reason: 'owner', written: 2 }),
      'stopped-closed': card({ _tag: 'stopped', reason: 'interrupted', written: 0 }),
      dismissed: card({ _tag: 'dismissed' }),
    },
  },
  { width: 560, height: 240 },
)
