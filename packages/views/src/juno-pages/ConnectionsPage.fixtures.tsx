import { chatCopy } from '@juno/agent-contract'
import { defineFixtures, fixture } from '@juno/ui'
import { connections, settings } from './fixtures'
import { ConnectionsPage, type ConnectionsPageProps } from './ConnectionsPage'
import { RulesSection, type RulesSectionProps } from './RulesSection'

const noop = () => {}
const rules = (props: Partial<Pick<RulesSectionProps, 'rules' | 'rulesError'>> = {}) => (
  <RulesSection rules={settings.rules} {...props} onRuleChange={noop} onRuleRemove={noop} onRuleAdd={noop} onRulesCommit={noop} />
)
const page = (props: Pick<ConnectionsPageProps, 'page' | 'error' | 'rules'>) => fixture<ConnectionsPageProps>({ rules: rules(), ...props, onAction: noop, onConfigure: noop, onAdd: noop })
const signingIn = { connections: connections.connections.map((row) => (row.id === 'littlebird' ? { ...row, state: 'connecting' as const } : row)) }

export default defineFixtures(
  ConnectionsPage,
  {
    Connections: {
      servers: page({ page: connections }),
      off: page({ page: { connections: connections.connections.map((row) => ({ ...row, state: 'off', enabled: false, tools: [] })) } }),
      'needs-sign-in': page({ page: { connections: connections.connections.map((row) => ({ ...row, state: 'needsSignIn', enabled: false })) } }),
      signingIn: page({ page: signingIn }),
      failed: page({ page: connections, error: { id: connections.connections[0]!.id, message: 'That did not work. Check the connection and try again.' } }),
      badAddress: page({ page: connections, error: { id: 'new', message: 'Use an https address, or http on this Mac.' } }),
      empty: page({ page: { connections: [] } }),
      'no-rules': page({ page: connections, rules: rules({ rules: [] }) }),
      'rules-refused': page({ page: connections, rules: rules({ rulesError: chatCopy.pages.settings.rulesInvalid }) }),
    },
  },
  { width: 960, height: 880, padded: false },
)
