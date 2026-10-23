import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { Copy } from '@phosphor-icons/react/dist/icons/Copy'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { ContextMenu, type ContextMenuProps } from './ContextMenu'
import { defineFixtures, fixture } from './fixtures/define'

const noop = () => {}

const items: ContextMenuProps['items'] = [
  { id: 'copy', label: 'Copy text', icon: Copy },
  { id: 'open', label: 'Open in Slack', icon: ArrowSquareOut },
  { separator: true },
  { id: 'delete', label: 'Delete…', icon: Trash },
]

const withKeys: ContextMenuProps['items'] = [
  { id: 'copy', label: 'Copy text', icon: Copy },
  { id: 'open', label: 'Open in Slack', icon: ArrowSquareOut },
  { separator: true },
  { id: 'edit', label: 'Edit', icon: PencilSimple, shortcut: 'E' },
  { id: 'delete', label: 'Delete…', icon: Trash, shortcut: '⌫' },
]

const menu = (overrides: Partial<ContextMenuProps> = {}, hover?: string) =>
  fixture<ContextMenuProps>({ anchor: { x: 24, y: 24 }, items, label: 'Message actions', onSelect: noop, onClose: noop, inline: true, ...overrides }, { width: 320, height: 200, padded: false, ...(hover === undefined ? {} : { hover }) })

export default defineFixtures(ContextMenu, {
  // Drawn like a macOS menu, at the pointer: rows with icons, separators between groups.
  Look: {
    default: menu(),
    disabled: menu({ items: [...items.slice(0, 3), { id: 'delete', label: 'Delete…', icon: Trash, disabled: true }] }),
  },
  // Key equivalents at the rows' ends; a disabled row's shows disabled.
  Shortcuts: {
    default: menu({ items: withKeys }),
    disabled: menu({ items: [...withKeys.slice(0, 3), { id: 'delete', label: 'Delete…', icon: Trash, disabled: true, shortcut: '⌫' }] }),
    'hover-row': menu({ items: withKeys }, '[data-menu-item="delete"]'),
  },
  Interaction: {
    'hover-row': menu({}, '[data-menu-item="open"]'),
    'hover-disabled': menu({ items: [...items.slice(0, 3), { id: 'delete', label: 'Delete…', icon: Trash, disabled: true }] }, '[data-menu-item="delete"]'),
  },
})
