import { expect } from '@playwright/test'
import { layoutTest, openState, readRoutes } from './support'

// A cached rendering test keys on the components it opened (support.ts): a state opened through the hash, in place or
// through the index must each be noted, or a change to that component would leave the old pass standing.
layoutTest('the rendering cache notes every component a test opens', async ({ page, renderedComponents }) => {
  await readRoutes(page)
  await page.goto('/#/Button?__state=variant/primary')
  await openState(page, { component: 'TopicRow', id: 'state/read', route: 'TopicRow/state/read', group: '', groupId: '', state: '', frame: {} })
  await openState(page, { component: 'Message', id: 'row/long-name', route: 'Message/row/long-name', group: '', groupId: '', state: '', frame: {} }, 'light', undefined, { inPlace: true })
  expect([...renderedComponents].toSorted()).toEqual(['#index', 'Button', 'Message', 'TopicRow'])
})
