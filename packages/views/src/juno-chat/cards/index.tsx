/**
 * One view per card kind, keyed by the card's `_tag`. The chat renders a
 * card through `renderCard`; a kind the build does not know arrives as
 * `unknown` and prints one line.
 */
import type { Card, CardKind } from '@juno/agent-contract'
import type { ChatActions } from '../commands'
import { BudgetCard } from './BudgetCard'
import { ChangeCard } from './ChangeCard'
import { ConnectCard } from './ConnectCard'
import { ProviderCard } from './ProviderCard'
import { QuestionCard } from './QuestionCard'
import { RemoveCard } from './RemoveCard'
import { ResolveCard } from './ResolveCard'
import { ProposedScheduleCard, ScheduleCard } from './ScheduleCards'
import { SendMessageCard } from './SendMessageCard'
import { ProposedTaskCard, TaskCard } from './TaskCards'
import { TopicsCard } from './TopicsCard'
import { UnknownCard } from './UnknownCard'

export interface CardViewProps<K extends CardKind = CardKind> {
  readonly card: Extract<Card, { readonly _tag: K }>
  readonly actions: ChatActions
  readonly now: number
}

type CardViews = { readonly [K in CardKind]: (props: CardViewProps<K>) => React.ReactNode }

const cardViews: CardViews = {
  sendMessage: SendMessageCard,
  resolve: ResolveCard,
  topics: TopicsCard,
  proposedTask: ProposedTaskCard,
  task: TaskCard,
  question: QuestionCard,
  proposedSchedule: ProposedScheduleCard,
  schedule: ScheduleCard,
  connect: ConnectCard,
  change: ChangeCard,
  remove: RemoveCard,
  budget: BudgetCard,
  provider: ProviderCard,
  unknown: UnknownCard,
}

export function renderCard(card: Card, actions: ChatActions, now: number): React.ReactNode {
  const View = cardViews[card._tag] as (props: CardViewProps) => React.ReactNode
  return <View card={card} actions={actions} now={now} />
}

export { ChatCard, type ChatCardProps } from './ChatCard'
export { RemoveRows } from './RemoveCard'
