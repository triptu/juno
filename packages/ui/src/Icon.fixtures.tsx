import { Bell, CircleCheck, Hash, Lock, MessageSquare, MessagesSquare, Pin, Search, Sparkles, User, Users } from 'lucide-react'
import { defineFixtures, fixture, scene } from './fixtures/define'
import { Row } from './fixtures/layout'
import { Icon } from './Icon'

export default defineFixtures(Icon, {
  default: fixture({ icon: Hash }),
  dim: fixture({ icon: Hash, size: 14, dim: true }),
  labelled: fixture({ icon: CircleCheck, size: 14, label: 'Resolved' }),
  'all-sizes': scene(() => (
    <Row>
      <Icon icon={Sparkles} size={11} />
      <Icon icon={Sparkles} size={12} />
      <Icon icon={Sparkles} size={13} />
      <Icon icon={Sparkles} size={14} />
      <Icon icon={Sparkles} size={15} />
      <Icon icon={Sparkles} size={16} />
      <Icon icon={Sparkles} size={18} />
    </Row>
  )),
  'common-set': scene(() => (
    <Row>
      <Icon icon={Hash} />
      <Icon icon={Lock} />
      <Icon icon={User} />
      <Icon icon={Users} />
      <Icon icon={MessageSquare} />
      <Icon icon={MessagesSquare} />
      <Icon icon={Pin} />
      <Icon icon={Bell} />
      <Icon icon={Search} />
      <Icon icon={Sparkles} />
    </Row>
  )),
})
