import { test } from './support'

/** The reset between tests on the shared gallery page (support.ts) fails a test that leaves state behind. */
for (const [what, leave] of [
  ['a node outside the fixture', () => document.body.append(document.createElement('div'))],
  ['a window global', () => { Object.assign(window, { leftOver: true }) }],
] as const) {
  test(`the shared page fails a test that leaves ${what}`, async ({ page }) => {
    test.fail(true, 'the reset after this test reports what it left')
    await page.goto('/#/Button?__state=variant/primary')
    await page.locator('[data-fixture-frame]').waitFor()
    await page.evaluate(leave)
  })
}
