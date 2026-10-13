import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { FunnelSimple } from '@phosphor-icons/react/dist/icons/FunnelSimple'
import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { Lock } from '@phosphor-icons/react/dist/icons/Lock'
import { PaperPlaneTilt } from '@phosphor-icons/react/dist/icons/PaperPlaneTilt'
import { Tray } from '@phosphor-icons/react/dist/icons/Tray'
import { Avatar } from './Avatar'
import { Chip } from './Chip'
import { defineFixtures, scene } from './fixtures/define'
import { Icon } from './Icon'
import { Kbd } from './Kbd'
import { OptionGroupLabel, OptionList, OptionRow } from './OptionList'
import { Surface } from './Surface'

export default defineFixtures(OptionList, {
  Pickers: {
    'browse-channels': scene(
      () => (
        <Surface kind="popover" sx={undefined}>
          <OptionList label="Channels and people" activeId="eng">
            <OptionRow id="all" leading={<Icon icon={Tray} size={16} />} label="All topics" selected trailing={<Chip variant="strong" numeric>14</Chip>} />
            <OptionRow id="eng" leading={<Icon icon={Hash} size={16} />} label={<b>eng</b>} active trailing={<Chip variant="strong" numeric>9</Chip>} />
            <OptionRow id="hiring" leading={<Icon icon={Lock} size={16} />} label="hiring" sub="private" trailing={<Chip variant="accent">@</Chip>} />
            <OptionRow id="maya" leading={<Avatar label="MC" hue="claret" size={18} />} label="Maya Chen" />
            <OptionRow id="product" leading={<Icon icon={Hash} size={16} />} label="product" sub="quiet" />
          </OptionList>
        </Surface>
      ),
      { width: 320 },
    ),
    'mention-suggest': scene(
      () => (
        <Surface kind="popover">
          <OptionGroupLabel>People</OptionGroupLabel>
          <OptionList label="People" activeId="maya">
            <OptionRow id="maya" leading={<Avatar label="MC" hue="claret" size={20} />} label="Maya Chen" active />
            <OptionRow id="leo" leading={<Avatar label="LP" hue="midnight" size={20} />} label="Leo Park" />
            <OptionRow id="dev" leading={<Avatar label="DP" hue="cyan" size={20} />} label="Dev Patel" />
          </OptionList>
        </Surface>
      ),
      { width: 300 },
    ),
    'to-picker': scene(
      () => (
        <Surface kind="popover">
          <OptionList label="Channel or person" activeId="eng">
            <OptionRow id="eng" size={34} leading={<Icon icon={Hash} size={16} />} label="eng" sub="Public channel" active />
            <OptionRow id="hiring" size={34} leading={<Icon icon={Lock} size={16} />} label="hiring" sub="Private channel" />
            <OptionRow id="maya" size={34} leading={<Avatar label="MC" hue="claret" size={20} />} label="Maya Chen" sub="Direct message" />
          </OptionList>
        </Surface>
      ),
      { width: 420 },
    ),
    palette: scene(
      () => (
        <Surface kind="popover" radius="palette">
          <OptionGroupLabel>Juno</OptionGroupLabel>
          <OptionList label="Results" activeId="send">
            <OptionRow
              id="send"
              size={55}
              leading={<Icon icon={PaperPlaneTilt} size={18} />}
              label="Send to Maya Chen"
              sub="“the wednesday slot works”"
              subPlacement="below"
              active
              trailing={
                <>
                  <Chip variant="filled" size={20}>
                    95%
                  </Chip>
                  <Kbd>↵ Send</Kbd>
                </>
              }
            />
          </OptionList>
          <OptionGroupLabel>Results</OptionGroupLabel>
          <OptionList label="Results">
            <OptionRow id="t1" size={55} leading={<Icon icon={CheckCircle} size={18} />} label="Resolve Pricing page copy" sub="#product · hides it until there is new activity" subPlacement="below" />
            <OptionRow id="t2" size={55} leading={<Icon icon={FunnelSimple} size={18} />} label="eng" sub="Public channel · show its topics" subPlacement="below" />
          </OptionList>
        </Surface>
      ),
      { width: 560 },
    ),
  },
})
