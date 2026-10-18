import * as stylex from '@stylexjs/stylex'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { SparkleDuotone, defineFixtures, IconButton, scene, Surface, TooltipLayer, type FixtureFrame } from '@juno/ui'
import { noop, others } from './fixtures/data'
import { HuddleHeaderButton, type HuddleHeaderButtonProps } from './HuddleHeaderButton'

/**
 * The control as a Main's right island draws it: first, then ⋯ and Juno.
 * The frame is the header's size container, so the narrow form follows the
 * frame's width as it follows the topic area's.
 */
function RightIsland(props: HuddleHeaderButtonProps) {
  return (
    <div {...stylex.props(styles.header)}>
      <Surface kind="island">
        <HuddleHeaderButton {...props} />
        <IconButton icon={DotsThree} label="More" size={28} iconSize={18} iconWeight="bold" radius="full" variant="island" />
        <IconButton icon={SparkleDuotone} label="Juno" size={28} iconSize={16} radius="full" variant="island" />
      </Surface>
    </div>
  )
}

const wide: FixtureFrame = { width: 560 }
const narrow: FixtureFrame = { width: 400 }

const at = (props: Partial<HuddleHeaderButtonProps>, frame: FixtureFrame = wide) =>
  scene<HuddleHeaderButtonProps>(() => <RightIsland mode="start" place="#eng" onClick={noop} {...props} />, frame)

export default defineFixtures(HuddleHeaderButton, {
  Mode: {
    start: at({ mode: 'start' }),
    join: at({ mode: 'join', people: others(3) }),
    'join one person': at({ mode: 'join', people: others(1) }),
    'join many': at({ mode: 'join', people: others(7) }),
    switch: at({ mode: 'switch', people: others(2), current: '#design' }),
    joined: at({ mode: 'joined', people: others(2) }),
  },
  Narrow: {
    start: at({ mode: 'start' }, narrow),
    join: at({ mode: 'join', people: others(3) }, narrow),
    joined: at({ mode: 'joined' }, narrow),
  },
  Interaction: {
    'join hover': at({ mode: 'join', people: others(3) }, { ...wide, hover: '[aria-label^="Join the huddle"]' }),
    'join press': at({ mode: 'join', people: others(3) }, { ...wide, press: '[aria-label^="Join the huddle"]' }),
    'join focus': at({ mode: 'join', people: others(3) }, { ...wide, focus: '[aria-label^="Join the huddle"]' }),
    'switch tooltip': scene<HuddleHeaderButtonProps>(
      () => (
        <>
          <RightIsland mode="switch" place="#eng" current="#design" people={others(2)} onClick={noop} />
          <TooltipLayer />
        </>
      ),
      { ...wide, height: 100, tooltip: '[aria-label^="Leave the huddle"]' },
    ),
  },
})

const styles = stylex.create({
  header: {
    display: 'flex',
    justifyContent: 'flex-end',
    width: '100%',
    containerType: 'inline-size',
  },
})
