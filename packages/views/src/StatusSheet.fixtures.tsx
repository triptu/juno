import { defineFixtures, fixture } from '@juno/ui'
import { StatusSheet, type StatusSheetProps } from './StatusSheet'

const noop = () => {}

const presets: StatusSheetProps<string>['presets'] = [
  { emoji: { name: 'spiral_calendar_pad', unicode: '🗓️' }, text: 'In a meeting', clearAfter: '1h', clearAfterLabel: '1 hour' },
  { emoji: { name: 'bus', unicode: '🚌' }, text: 'Commuting', clearAfter: '30m', clearAfterLabel: '30 minutes' },
  { emoji: { name: 'face_with_thermometer', unicode: '🤒' }, text: 'Out sick', clearAfter: 'today', clearAfterLabel: 'Today' },
  { emoji: { name: 'palm_tree', unicode: '🌴' }, text: 'Vacationing', clearAfter: 'never', clearAfterLabel: 'Don’t clear' },
  { emoji: { name: 'house_with_garden', unicode: '🏡' }, text: 'Working remotely', clearAfter: 'today', clearAfterLabel: 'Today' },
]

const choices = [
  { value: 'never', label: 'Don’t clear' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
]

const sheet = (props: Partial<StatusSheetProps<string>>) =>
  fixture<StatusSheetProps<string>>({
    text: '',
    maxLength: 100,
    presets,
    clearAfterOptions: choices,
    clearAfter: 'today',
    hasStatus: false,
    onEmoji: noop,
    onTextChange: noop,
    onClearField: noop,
    onPreset: noop,
    onClearAfterChange: noop,
    onSave: noop,
    onClearStatus: noop,
    onCancel: noop,
    ...props,
  })

export default defineFixtures(
  StatusSheet,
  {
    New: {
      empty: sheet({}),
      typed: sheet({ emoji: { name: 'books', unicode: '📚' }, text: 'Reading the Q4 plan', clearAfter: '4h' }),
      // A custom emoji from the workspace, drawn as its image.
      'custom-emoji': sheet({ emoji: { name: 'juno_wave', url: '/emoji/juno_wave.svg' }, text: 'Back at 2', clearAfter: '1h' }),
      // Text with no emoji: the button shows the 💬 Save sends.
      'text-only': sheet({ textEmoji: { name: 'speech_balloon', unicode: '💬' }, text: 'Heads down on the release', clearAfter: 'today' }),
      // A custom emoji the workspace no longer has: a plain square, not its name.
      'missing-emoji': sheet({ emoji: { name: 'party_parrot_wave_long_name' }, text: 'Back at 2', clearAfter: '1h' }),
    },
    Edit: {
      // The status clears later: its own time is the first choice, and Clear status shows.
      'with-expiry': sheet({ emoji: { name: 'spiral_calendar_pad', unicode: '🗓️' }, text: 'In a meeting', hasStatus: true, clearAfter: 'keep', clearAfterOptions: [{ value: 'keep', label: 'Today at 3:30pm' }, ...choices] }),
      saving: sheet({ emoji: { name: 'palm_tree', unicode: '🌴' }, text: 'Vacationing', hasStatus: true, clearAfter: 'never', busy: true }),
      failed: sheet({ emoji: { name: 'palm_tree', unicode: '🌴' }, text: 'Vacationing', hasStatus: true, clearAfter: 'never', error: 'Couldn’t reach Slack. Try again.' }),
    },
  },
  { width: 440, padded: true, surface: 'subtle' },
)
