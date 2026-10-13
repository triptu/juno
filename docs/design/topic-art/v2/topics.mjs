// The round 2 topic set. The 24 thread topics from round 1 (twenty from the
// fake-slack fixtures and four tricky ones), plus eleven channel Main
// topics: eight ordinary ones and three tricky (a channel with no purpose,
// a bot-only channel, a group DM's Main). A Main topic carries what the app
// has for it: the channel name, purpose and topic, and a sample of recent
// top-level messages.
import { topics as round1 } from '../topics.mjs'

export const threadTopics = round1

export const mainTopics = [
  { id: 'main-eng', kind: 'main', title: '#eng', channel: 'eng', purpose: 'Everything engineering. Threads for anything longer than two messages.', topic: 'Engineering',
    recent: ['Reminder: on-call handoff moves to Mondays starting next week.', 'Draft plan is in the doc. Short version: logical replication to the new cluster, cut over behind the read-only flag.', 'Unrelated: has anyone looked at the staging bill? It doubled since August.', 'checkout.spec failed again on main. Third time today.'] },
  { id: 'main-product', kind: 'main', title: '#product', channel: 'product', purpose: 'Roadmap, specs and launches.', topic: 'Product',
    recent: ['Proposal: cut offline mode and public API v3 from Q4. Keeps sync reliability as the one big bet.', 'Final copy for pricing is in. Any last edits?'] },
  { id: 'main-platform', kind: 'main', title: '#platform', channel: 'platform', purpose: '', topic: 'Platform and infra',
    recent: ["We have 142 flags. 61 haven't changed in 90 days.", 'Terraform state lock is stuck again on the staging workspace.'] },
  { id: 'main-incidents', kind: 'main', title: '#incidents', channel: 'incidents', purpose: '', topic: 'One thread per incident',
    recent: ['p95 on /v2/search jumped to 1.8s. Looking.'] },
  { id: 'main-alerts', kind: 'main', title: '#alerts-prod', channel: 'alerts-prod', purpose: '', topic: 'Production alerts from Grafana',
    recent: ['[FIRING] queue depth > 5k on billing-consumer', '[RESOLVED] queue depth > 5k on billing-consumer', '[FIRING] disk 85% on db-replica-2', '[RESOLVED] api p95 > 800ms (prod-eu)'] },
  { id: 'main-deploys', kind: 'main', title: '#deploys', channel: 'deploys', purpose: '', topic: '',
    recent: ['api@91be07 deployed to prod', 'api@91be07 deployed to staging', 'web@4f2a1c deployed to prod'] },
  { id: 'main-hiring', kind: 'main', title: '#hiring', channel: 'hiring', purpose: '', topic: 'Open roles and candidates',
    recent: ['Rina finished the onsite. Panel notes are in the scorecard.', "Marco's references came back. All positive, one note on delegation."] },
  { id: 'main-social', kind: 'main', title: '#social', channel: 'social', purpose: '', topic: '',
    recent: ['Board games at six?'] },
  // Tricky
  { id: 'main-random', kind: 'main', title: '#random', channel: 'random', purpose: '', topic: '',
    recent: ['anyone seen my mug', 'the blue one'] },
  { id: 'main-leadership', kind: 'main', title: '#leadership', channel: 'leadership', purpose: '', topic: '',
    recent: ['Retro notes are in the doc.', 'Finance wants the 2027 plan by the 20th.'] },
  { id: 'main-mpdm', kind: 'main', title: 'Leo, Maya', channel: 'Leo, Maya', purpose: '', topic: '',
    recent: ['lunch friday?', 'yes. the ramen place', 'in'] },
]

export const topics = [...threadTopics, ...mainTopics]
