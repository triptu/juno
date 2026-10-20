/**
 * One StyleX style per type role. Each sets the five properties of the role
 * from the `text` tokens. Text exposes them as its `variant`; controls compose
 * the one they need (Button uses `ui`, Chip uses `tag`, ...).
 */
import * as stylex from '@stylexjs/stylex'
import { text, weights } from '@juno/tokens/tokens.stylex'

export type TextVariant =
  | 'sectionLabel'
  | 'tableHeader'
  | 'divider'
  | 'tag'
  | 'tagSmall'
  | 'meta'
  | 'pill'
  | 'buttonSmall'
  | 'ui'
  | 'preview'
  | 'bodySmall'
  | 'body'
  | 'rowTitle'
  | 'messageName'
  | 'heading'
  | 'topicTitle'
  | 'pageTitle'
  | 'pageTitleCompact'
  | 'display'
  | 'emptyTitle'
  | 'kbd'
  | 'code'

export const variants = stylex.create({
  sectionLabel: {
    fontFamily: text['--text-section-label-family'],
    fontSize: text['--text-section-label-size'],
    fontWeight: text['--text-section-label-weight'],
    lineHeight: text['--text-section-label-leading'],
  },
  tableHeader: {
    fontFamily: text['--text-table-header-family'],
    fontSize: text['--text-table-header-size'],
    fontWeight: text['--text-table-header-weight'],
    lineHeight: text['--text-table-header-leading'],
  },
  divider: {
    fontFamily: text['--text-divider-family'],
    fontSize: text['--text-divider-size'],
    fontWeight: text['--text-divider-weight'],
    lineHeight: text['--text-divider-leading'],
  },
  tag: {
    fontFamily: text['--text-tag-family'],
    fontSize: text['--text-tag-size'],
    fontWeight: text['--text-tag-weight'],
    lineHeight: text['--text-tag-leading'],
    letterSpacing: text['--text-tag-tracking'],
  },
  tagSmall: {
    fontFamily: text['--text-tag-small-family'],
    fontSize: text['--text-tag-small-size'],
    fontWeight: text['--text-tag-small-weight'],
    lineHeight: text['--text-tag-small-leading'],
    letterSpacing: text['--text-tag-small-tracking'],
  },
  meta: {
    fontFamily: text['--text-meta-family'],
    fontSize: text['--text-meta-size'],
    fontWeight: text['--text-meta-weight'],
    lineHeight: text['--text-meta-leading'],
    letterSpacing: text['--text-meta-tracking'],
  },
  pill: {
    fontFamily: text['--text-pill-family'],
    fontSize: text['--text-pill-size'],
    fontWeight: text['--text-pill-weight'],
    lineHeight: text['--text-pill-leading'],
    letterSpacing: text['--text-pill-tracking'],
  },
  buttonSmall: {
    fontFamily: text['--text-button-small-family'],
    fontSize: text['--text-button-small-size'],
    fontWeight: text['--text-button-small-weight'],
    lineHeight: text['--text-button-small-leading'],
    letterSpacing: text['--text-button-small-tracking'],
  },
  ui: {
    fontFamily: text['--text-ui-family'],
    fontSize: text['--text-ui-size'],
    fontWeight: text['--text-ui-weight'],
    lineHeight: text['--text-ui-leading'],
    letterSpacing: text['--text-ui-tracking'],
  },
  preview: {
    fontFamily: text['--text-preview-family'],
    fontSize: text['--text-preview-size'],
    fontWeight: text['--text-preview-weight'],
    lineHeight: text['--text-preview-leading'],
    letterSpacing: text['--text-preview-tracking'],
  },
  bodySmall: {
    fontFamily: text['--text-body-small-family'],
    fontSize: text['--text-body-small-size'],
    fontWeight: text['--text-body-small-weight'],
    lineHeight: text['--text-body-small-leading'],
    letterSpacing: text['--text-body-small-tracking'],
  },
  body: {
    fontFamily: text['--text-body-family'],
    fontSize: text['--text-body-size'],
    fontWeight: text['--text-body-weight'],
    lineHeight: text['--text-body-leading'],
    letterSpacing: text['--text-body-tracking'],
  },
  rowTitle: {
    fontFamily: text['--text-row-title-family'],
    fontSize: text['--text-row-title-size'],
    fontWeight: text['--text-row-title-weight'],
    lineHeight: text['--text-row-title-leading'],
    letterSpacing: text['--text-row-title-tracking'],
  },
  messageName: {
    fontFamily: text['--text-message-name-family'],
    fontSize: text['--text-message-name-size'],
    fontWeight: text['--text-message-name-weight'],
    lineHeight: text['--text-message-name-leading'],
    letterSpacing: text['--text-message-name-tracking'],
  },
  heading: {
    fontFamily: text['--text-heading-family'],
    fontSize: text['--text-heading-size'],
    fontWeight: text['--text-heading-weight'],
    lineHeight: text['--text-heading-leading'],
    letterSpacing: text['--text-heading-tracking'],
  },
  topicTitle: {
    fontFamily: text['--text-topic-title-family'],
    fontSize: text['--text-topic-title-size'],
    fontWeight: text['--text-topic-title-weight'],
    lineHeight: text['--text-topic-title-leading'],
    letterSpacing: text['--text-topic-title-tracking'],
  },
  pageTitle: {
    fontFamily: text['--text-page-title-family'],
    fontSize: text['--text-page-title-size'],
    fontWeight: text['--text-page-title-weight'],
    lineHeight: text['--text-page-title-leading'],
    letterSpacing: text['--text-page-title-tracking'],
  },
  pageTitleCompact: {
    fontFamily: text['--text-page-title-compact-family'],
    fontSize: text['--text-page-title-compact-size'],
    fontWeight: text['--text-page-title-compact-weight'],
    lineHeight: text['--text-page-title-compact-leading'],
    letterSpacing: text['--text-page-title-compact-tracking'],
  },
  display: {
    fontFamily: text['--text-display-family'],
    fontSize: text['--text-display-size'],
    fontWeight: text['--text-display-weight'],
    lineHeight: text['--text-display-leading'],
    letterSpacing: text['--text-display-tracking'],
  },
  emptyTitle: {
    fontFamily: text['--text-empty-title-family'],
    fontSize: text['--text-empty-title-size'],
    fontWeight: text['--text-empty-title-weight'],
    lineHeight: text['--text-empty-title-leading'],
    letterSpacing: text['--text-empty-title-tracking'],
  },
  kbd: {
    fontFamily: text['--text-kbd-family'],
    fontSize: text['--text-kbd-size'],
    fontWeight: text['--text-kbd-weight'],
    lineHeight: text['--text-kbd-leading'],
    letterSpacing: text['--text-kbd-tracking'],
  },
  code: {
    fontFamily: text['--text-code-family'],
    fontSize: text['--text-code-size'],
    fontWeight: text['--text-code-weight'],
    lineHeight: text['--text-code-leading'],
    letterSpacing: text['--text-code-tracking'],
    fontVariantLigatures: text['--text-code-ligatures'],
  },
})

export type Weight = 'regular' | 'medium' | 'semibold'

export const weight = stylex.create({
  regular: { fontWeight: weights['--weight-regular'] },
  medium: { fontWeight: weights['--weight-medium'] },
  semibold: { fontWeight: weights['--weight-semibold'] },
})

export const numeric = stylex.create({
  tabular: { fontVariantNumeric: 'tabular-nums' },
})
