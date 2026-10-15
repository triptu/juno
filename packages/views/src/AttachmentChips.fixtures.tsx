import { defineFixtures, fixture } from '@juno/ui'
import { AttachmentChips, type AttachmentChip, type AttachmentChipsProps } from './AttachmentChips'
import { picture } from './fixtures/messages'

const noop = () => {}

export const chips = {
  image: { id: 'c-image', name: 'replica-lag-dashboard.png', size: 418_221, mimetype: 'image/png', preview: picture(1600, 900, '#8EB5C9'), state: 'ready' },
  pdf: { id: 'c-pdf', name: 'Postgres 16 cutover runbook.pdf', size: 1_284_311, mimetype: 'application/pdf', state: 'ready' },
  sheet: { id: 'c-sheet', name: 'replica-sizing.xlsx', size: 88_120, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', state: 'ready' },
  video: { id: 'c-video', name: 'demo.mov', size: 48_120_000, mimetype: 'video/quicktime', state: 'ready' },
  long: {
    id: 'c-long',
    name: 'Quarterly infrastructure cost review with replica sizing options and the cutover plan (final, v7).pdf',
    size: 2_402_112,
    mimetype: 'application/pdf',
    state: 'ready',
  },
} satisfies Record<string, AttachmentChip>

const state = (files: ReadonlyArray<AttachmentChip>) => fixture<AttachmentChipsProps>({ files, onRemove: noop })

export default defineFixtures(
  AttachmentChips,
  {
    State: {
      ready: state([chips.image, chips.pdf, chips.sheet, chips.video]),
      staging: state([
        { ...chips.image, state: 'staging' },
        { ...chips.pdf, state: 'staging', size: undefined },
      ]),
      failed: state([{ ...chips.pdf, state: 'failed' }, chips.image]),
      'long-name': state([chips.long, chips.image]),
    },
    Interaction: {
      'hover-image': fixture<AttachmentChipsProps>({ files: [chips.image, chips.pdf], onRemove: noop }, { hover: '[data-attachment]' }),
      'focus-remove': fixture<AttachmentChipsProps>({ files: [chips.pdf, chips.image], onRemove: noop }, { focus: 'button' }),
    },
  },
  { width: 560 },
)
