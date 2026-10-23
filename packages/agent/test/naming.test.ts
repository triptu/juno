// What a Change card calls a connection call (SPEC 13.3, 17): the action by what it does, and a short verb.
import { expect, it } from 'bun:test'
import { actionName, actionStatus } from '../src/mcp/naming'

it.each([
  ['Littlebird', 'search_user_context', undefined, { title: 'Search Littlebird', verb: 'Search' }],
  ['Notion', 'notion-create-pages', undefined, { title: 'Create pages in Notion', verb: 'Create pages' }],
  ['Notion', 'notion-update-page', undefined, { title: 'Update page in Notion', verb: 'Update page' }],
  ['Slack', 'send_message', undefined, { title: 'Send message in Slack', verb: 'Send' }],
  // A generic or code-like name never shows: the description's words, else plain words.
  ['PostHog', 'exec', undefined, { title: 'Run a command in PostHog', verb: 'Run' }],
  ['PostHog', 'exec', 'Executes a HogQL query against the project.', { title: 'Run a HogQL query in PostHog', verb: 'Run' }],
  ['PostHog', 'get_v2', 'Gets a dashboard by its id.', { title: 'Get a dashboard in PostHog', verb: 'Get' }],
  ['PostHog', 'run_hql', undefined, { title: 'Run a command in PostHog', verb: 'Run' }],
  ['Docs', 'create_x2', 'Creates a page.', { title: 'Create a page in Docs', verb: 'Create' }],
  ['Littlebird', 'getMeeting', undefined, { title: 'Get meeting in Littlebird', verb: 'Get meeting' }],
  ['Docs', 'note', 'Create a note in the handbook.', { title: 'Create note in Docs', verb: 'Create note' }],
  ['Docs', 'handbook_page_details', 'Everything about one page.', { title: 'Check with Docs', verb: 'Run' }],
  ['Docs', 'create_page_from_template_draft', undefined, { title: 'Create page from template draft in Docs', verb: 'Create' }],
])('names %s %s', (server, tool, description, name) => {
  expect(actionName(server, tool, description)).toEqual(name)
  // Never the tool's own name, when it is not plain words.
  if (/[_\d]/.test(tool) || tool === 'exec') expect(actionName(server, tool, description).title).not.toContain(tool)
})

it.each([
  ['Littlebird', 'search_user_context', undefined, 'Searching Littlebird'],
  ['Notion', 'notion-create-pages', undefined, 'Creating pages in Notion'],
  ['Notion', 'notion-update-page', undefined, 'Updating a page in Notion'],
  ['Slack', 'send_message', undefined, 'Sending a message in Slack'],
  ['Littlebird', 'getMeeting', undefined, 'Getting a meeting from Littlebird'],
  ['Docs', 'note', 'Create a note in the handbook.', 'Creating a note in Docs'],
  ['Docs', 'handbook_page_details', 'Everything about one page.', 'Checking with Docs'],
  ['PostHog', 'exec', undefined, 'Running a command in PostHog'],
  ['PostHog', 'exec', 'Executes a HogQL query against the project.', 'Running a HogQL query in PostHog'],
  ['PostHog', 'get_v2', 'Gets a dashboard by its id.', 'Getting a dashboard from PostHog'],
  ['Notion', 'notion-add-item', undefined, 'Adding an item in Notion'],
])('the status for %s %s', (server, tool, description, line) => {
  expect(actionStatus(server, tool, description)).toBe(line)
})
