import { Search } from 'lucide-react'
import { ContextPill } from './ContextPill'
import { defineFixtures, fixture } from './fixtures/define'
import { Text } from './Text'
import { TextField } from './TextField'

export default defineFixtures(
  TextField,
  {
    search: fixture({ size: 34, leadingIcon: Search, placeholder: 'Filter by title or message', width: 'search', label: 'Filter topics' }),
    'with-value': fixture({ size: 34, leadingIcon: Search, defaultValue: 'staging bill', width: 'search', label: 'Filter topics' }),
    title: fixture({ size: 36, placeholder: 'Title (optional, only in your client). AI names it if empty.', label: 'Title' }, { width: 420 }),
    keyword: fixture({ size: 32, placeholder: 'word or phrase', width: 'keyword', label: 'Keyword' }),
    'to-empty': fixture(
      {
        size: 44,
        placeholder: 'Channel or person',
        label: 'To',
        leading: (
          <Text role="ui" tone="muted">
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
            <Text role="ui" tone="muted">
              To
            </Text>
            <ContextPill kind="public" name="eng" showKind size={28} />
          </>
        ),
      },
      { width: 420 },
    ),
  },
  { width: 320 },
)
