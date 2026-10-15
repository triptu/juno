import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSource } from './check-tokens.mjs'

const source = (body) => `import * as sx from '@stylexjs/stylex';\nconst styles = sx.create({ root: { ${body} } });`
test('rejects colours and lengths in declarations, conditions and templates', () => {
  for (const value of ["'#fff'", "'rgba(0,0,0,.5)'", "'hsl(0 0% 0%)'", "'rebeccapurple'", "'2px'", "'1rem'", "'.5em'", '12', "{ default: 0, ':hover': '2px' }", '`calc(${spacing.x} + 2px)`']) {
    assert.equal(checkSource(source(`width: ${value}`)).length, 1, value)
  }
})
test('allows tokens, percentages, zero, hairlines and unitless properties', () => {
  assert.deepEqual(checkSource(source("width: sizes['--icon-12'], height: '100%', margin: 0, padding: '0px', borderWidth: 1, outlineWidth: '1px', opacity: 0.5, lineHeight: 1.5, flexGrow: 1, color: 'currentColor', background: 'transparent'")), [])
})
test('requires a real trailing comment with a reason', () => {
  assert.equal(checkSource(source("width: '3px', // tokens-allow: Match the external viewport.\n")).length, 0)
  assert.equal(checkSource(source("width: '3px', // tokens-allow: \n")).length, 1)
  assert.equal(checkSource(source("width: '3px // tokens-allow: fake' ")).length, 1)
  assert.equal(checkSource(source("width: '3px',\n// tokens-allow: Not trailing.\n")).length, 1)
})
test('supports named aliases and ignores unrelated code, keys and comments', () => {
  const code = `import { create as css } from '@stylexjs/stylex';
    const other = { color: 'red' }; // width: 8px
    css({ red: { '@media (min-width: 20px)': { width: '2px' } } });`
  assert.equal(checkSource(code).length, 1)
})

test('hairline allowance does not cover negative widths or rounded corners', () => {
  for (const declaration of ["borderRadius: '1px'", 'borderWidth: -1', "borderWidth: '-1px'", 'backgroundSize: 12']) {
    assert.equal(checkSource(source(declaration)).length, 1, declaration)
  }
})
