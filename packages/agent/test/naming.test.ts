// What a Change card calls a connection call (SPEC 13.3, 17): the action by what it does, and a short verb.
import { expect, it } from 'vitest'
import { actionName } from '../src/mcp/naming'

it.each([
  ['Littlebird', 'search_user_context', undefined, { title: 'Search Littlebird', verb: 'Search' }],
  ['Notion', 'notion-create-pages', undefined, { title: 'Create pages in Notion', verb: 'Create pages' }],
  ['Notion', 'notion-update-page', undefined, { title: 'Update page in Notion', verb: 'Update page' }],
  ['Slack', 'send_message', undefined, { title: 'Send message in Slack', verb: 'Send' }],
  ['PostHog', 'exec', undefined, { title: 'Run exec in PostHog', verb: 'Run' }],
  ['Littlebird', 'getMeeting', undefined, { title: 'Get meeting in Littlebird', verb: 'Get meeting' }],
  ['Docs', 'note', 'Create a note in the handbook.', { title: 'Create note in Docs', verb: 'Create note' }],
  ['Docs', 'handbook_page_details', 'Everything about one page.', { title: 'Run handbook_page_details in Docs', verb: 'Run' }],
  ['Docs', 'create_page_from_template_draft', undefined, { title: 'Create page from template draft in Docs', verb: 'Create' }],
])('names %s %s', (server, tool, description, name) => {
  expect(actionName(server, tool, description)).toEqual(name)
})
