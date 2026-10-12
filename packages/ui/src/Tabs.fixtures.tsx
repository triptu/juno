import { EyeOff, Hash, LayoutList, Lightbulb, Lock, Plus } from 'lucide-react'
import { defineFixtures, scene } from './fixtures/define'
import { IconButton } from './IconButton'
import { Tab, TabStrip } from './Tabs'

const newTab = <IconButton icon={Plus} label="New message" size={28} iconSize={15} tone="muted" />

export default defineFixtures(
  TabStrip,
  {
    'two-tabs': scene(() => (
      <TabStrip trailing={newTab}>
        <Tab icon={Hash} label="Postgres 16 migration plan" active onClose={() => {}} />
        <Tab icon={Hash} label="Thread list density" onClose={() => {}} />
      </TabStrip>
    )),
    'with-page': scene(() => (
      <TabStrip trailing={newTab}>
        <Tab icon={Hash} label="eng" onClose={() => {}} />
        <Tab icon={Hash} label="Thread list density" onClose={() => {}} />
        <Tab icon={LayoutList} label="All topics" active onClose={() => {}} />
      </TabStrip>
    )),
    stealth: scene(() => (
      <TabStrip trailing={newTab}>
        <Tab icon={Hash} label="eng" onClose={() => {}} />
        <Tab icon={EyeOff} label="Rina Sato · Staff backend" active onClose={() => {}} />
        <Tab icon={Lightbulb} label="For you" onClose={() => {}} />
      </TabStrip>
    )),
    many: scene(() => (
      <TabStrip trailing={newTab}>
        <Tab icon={Hash} label="Postgres 16 migration plan" onClose={() => {}} />
        <Tab icon={Lock} label="Rina Sato · Staff backend" onClose={() => {}} />
        <Tab icon={Hash} label="Q4 roadmap cuts" active onClose={() => {}} />
        <Tab icon={Hash} label="Staging bill doubled since August" onClose={() => {}} />
        <Tab icon={Lightbulb} label="For you" onClose={() => {}} />
      </TabStrip>
    )),
  },
  { width: 720, padded: false },
)
