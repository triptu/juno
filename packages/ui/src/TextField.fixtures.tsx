import { Hash } from '@phosphor-icons/react/dist/icons/Hash'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { ContextPill } from './ContextPill'
import { defineFixtures, fixture } from './fixtures/define'
import { Text } from './Text'
import { TextField } from './TextField'

export default defineFixtures(
  TextField,
  {
    search: fixture({ size: 34, leadingIcon: MagnifyingGlass, placeholder: 'Filter by title or message', width: 'search', label: 'Filter topics' }),
    'with-value': fixture({ size: 34, leadingIcon: MagnifyingGlass, defaultValue: 'staging bill', width: 'search', label: 'Filter topics' }),
    title: fixture({ size: 36, placeholder: 'Title (optional, only in your client). AI names it if empty.', label: 'Title', width: 'full' }, { width: 640 }),
    keyword: fixture({ size: 32, placeholder: 'word or phrase', width: 'keyword', label: 'Keyword' }),
    focused: fixture({ size: 34, leadingIcon: MagnifyingGlass, placeholder: 'Filter by title or message', width: 'search', label: 'Filter topics' }, { focus: 'input' }),
    invalid: fixture({ size: 32, defaultValue: 'not-a-time', width: 'keyword', label: 'Digest time', invalid: true }),
    disabled: fixture({ size: 34, leadingIcon: MagnifyingGlass, placeholder: 'Filter by title or message', width: 'search', label: 'Filter topics', disabled: true }),
    'to-empty': fixture(
      {
        size: 44,
        placeholder: 'Channel or person',
        label: 'To',
        leading: (
          <Text variant="ui" tone="muted">
            To
          </Text>
        ),
      },
      { width: 420 },
    ),
    'to-set': fixture(
      {
        size: 44,
        placeholder: 'Change',
        label: 'To',
        leading: (
          <>
            <Text variant="ui" tone="muted">
              To
            </Text>
            <ContextPill tint="public" icon={Hash} name="eng" kindLabel="Public channel" showKind size={28} />
          </>
        ),
      },
      { width: 420 },
    ),
  },
  { width: 320 },
)
