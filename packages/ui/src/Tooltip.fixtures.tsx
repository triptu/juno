import * as stylex from '@stylexjs/stylex'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { NotePencil } from '@phosphor-icons/react/dist/icons/NotePencil'
import { SidebarSimple } from '@phosphor-icons/react/dist/icons/SidebarSimple'
import { spacing } from '@juno/tokens/tokens.stylex'
import { defineFixtures, scene } from './fixtures/define'
import { Row } from './fixtures/layout'
import { IconButton } from './IconButton'
import { TooltipLayer } from './Tooltip'

/** A title-bar row of icon buttons: the shortcut ones show keycaps. */
function Toolbar() {
  return (
    <>
      <Row gap="sm">
        <IconButton icon={SidebarSimple} label="Hide sidebar" shortcut="⌃⌘S" />
        <IconButton icon={CaretLeft} label="Back" shortcut="⌘[" />
        <IconButton icon={CaretRight} label="Forward" shortcut="⌘]" />
        <IconButton icon={MagnifyingGlass} label="Search" shortcut="⌘K" />
        <IconButton icon={NotePencil} label="New chat" shortcut="⌘N" />
        <IconButton icon={DotsThree} label="More" />
      </Row>
      <TooltipLayer />
    </>
  )
}

/** A button in each corner of the frame: each tooltip moves in to stay inside it. */
function Corners() {
  return (
    <div {...stylex.props(styles.corners)}>
      <span {...stylex.props(styles.corner, styles.topLeft)}>
        <IconButton icon={CaretLeft} label="Back to the conversation you had open before" shortcut="⌘[" data-corner="top-left" />
      </span>
      <span {...stylex.props(styles.corner, styles.topRight)}>
        <IconButton icon={MagnifyingGlass} label="Search messages and conversations" shortcut="⌘K" data-corner="top-right" />
      </span>
      <span {...stylex.props(styles.corner, styles.bottomLeft)}>
        <IconButton icon={NotePencil} label="Start a new chat with anyone" shortcut="⌘N" data-corner="bottom-left" />
      </span>
      <span {...stylex.props(styles.corner, styles.bottomRight)}>
        <IconButton icon={DotsThree} label="More actions for this topic" data-corner="bottom-right" />
      </span>
      <TooltipLayer />
    </div>
  )
}

export default defineFixtures(TooltipLayer, {
  Toolbar: {
    back: scene(() => <Toolbar />, { tooltip: '[aria-label="Back ⌘["]', width: 360, height: 120 }),
    label: scene(() => <Toolbar />, { tooltip: '[aria-label="More"]', width: 360, height: 120 }),
    'two-modifiers': scene(() => <Toolbar />, { tooltip: '[aria-label="Hide sidebar ⌃⌘S"]', width: 360, height: 120 }),
  },
  Edges: {
    corners: scene(() => <Corners />, { width: 320, height: 200, padded: false }),
  },
})

const styles = stylex.create({
  corners: {
    position: 'relative',
    width: '100%',
    height: '100%',
  },
  corner: {
    position: 'absolute',
    margin: spacing['--space-1'],
  },
  topLeft: { top: 0, left: 0 },
  topRight: { top: 0, right: 0 },
  bottomLeft: { bottom: 0, left: 0 },
  bottomRight: { bottom: 0, right: 0 },
})
