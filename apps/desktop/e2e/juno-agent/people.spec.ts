// Person files (SPEC 13.8), in the app against the fake Slack and a fake OpenRouter: the learning
// pass builds files for the people the owner exchanges most with, a run in the panel beside a DM
// gets that person's file after the recent messages, a draft follows How you talk with them, the
// owner corrects the relationship from the DM's ⋯ menu, and privacy mode blurs the files.
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import type { Juno } from '../driver/juno'
import { openChat, openPage, ready } from './agent'
import { answer, expect, JunoChatPane, test as base } from './chat'
import { startScriptedModel, type ScriptedModel } from './model'

/** The pass's first message (`task` in `memory-docs/learn.ts`). */
const PASS = 'Learn how the owner works'
const TALK = 'Short and lowercase, no greeting. Replies within the hour.'
const WORK = 'Plans the offsite agenda with you.'
const DRAFT = 'draft a reply to Maya about the offsite'

/** One person in the pass's list: "- Maya Chen (U0MAYA), DM D0MAYA, 9 messages". */
const listed = (task: string) => [...task.matchAll(/^- (.+?) \((U[A-Z0-9]+)\)/gm)].map((match) => ({ name: match[1]!, id: match[2]! }))

/**
 * The pass writes a file for Maya (what she works on, how the owner talks with her, Peer) and a
 * line for the next person in its list, one write per request, then ends. In the chat, a draft
 * quotes How you talk with them from `<people-now>`; anything else is echoed.
 */
function scripted(): (request: OpenRouterRequest) => string | ToolCallAnswer {
  let plan: Array<Record<string, unknown>> | undefined
  return (request) => {
    if (request.input.startsWith(PASS)) {
      if (plan === undefined) {
        const people = listed(request.input)
        const other = people.find((person) => person.id !== 'U0MAYA')
        plan = [
          { person: 'U0MAYA', section: 'work', text: WORK, source: 'slack' },
          { person: 'U0MAYA', section: 'talk', text: TALK, source: 'slack' },
          { person: 'U0MAYA', relationship: 'peer', source: 'slack' },
          ...(other === undefined ? [] : [{ person: other.id, section: 'work', text: `${other.name} reviews the platform changes.`, source: 'slack' }]),
        ]
      }
      const next = plan.shift()
      return next === undefined ? 'Built files for the people you work with most.' : { toolCall: { name: 'memory_write', arguments: next } }
    }
    if (request.toolResult !== undefined) return '<say>Done.</say>'
    const talk = /How you talk with them \(talk\):\n- \[e\d+\] (.+)/.exec(request.memory)?.[1]
    if (request.input.includes(DRAFT) && talk !== undefined) return `<say>In your usual way with Maya (${talk}): "wednesday works, one-liner coming tonight"</say>`
    return answer(request)
  }
}

const test = base.extend<{ readonly model: ScriptedModel }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startScriptedModel({ answer: scripted() })
    await use(model)
    await model.close()
  },
})

test.describe.configure({ timeout: 180_000 })

async function setWindowWidth(juno: Juno, width: number): Promise<void> {
  await juno.app.evaluate(({ BrowserWindow }, w) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setSize(w, window.getSize()[1]!)
  }, width)
}

/** The last chat request that answers `text`. */
const askedWith = (model: ScriptedModel, text: string) => model.requests.filter((request) => !request.compaction && request.input.includes(text)).at(-1)!

test('the pass builds files for the top DM partners, a DM run gets the file and drafts the way the owner talks with them, the relationship is corrected, and privacy blurs the files', async ({ juno, slack, model }) => {
  await ready(juno)
  await setWindowWidth(juno, 1400)

  // Maya and the owner exchange messages in their DM, both ways.
  slack.as('Maya').dm('Are you around to plan the offsite?')
  await juno.sidebar.row('Maya', { exact: true }).open()
  await juno.topic.expectMessage('Are you around to plan the offsite?')
  await juno.topic.send('yes, give me five minutes')
  slack.as('Maya').dm('Wednesday slot then?')
  await juno.topic.expectMessage('Wednesday slot then?')
  await juno.topic.send('wednesday works')
  await juno.topic.expectMessage('wednesday works')

  // The learning pass, from Home.
  const ask = juno.home.item('ask')
  await expect.poll(async () => {
    await juno.home.open()
    return ask.count()
  }, { timeout: 30_000 }).toBe(1)
  await ask.getByRole('button', { name: 'Start', exact: true }).click()
  const chat = await openChat(juno)
  await expect(chat.root.locator('[data-chat-ask="learn"]')).toHaveAttribute('data-ask-status', 'done', { timeout: 30_000 })

  // Its task lists the people the owner exchanges most with, Maya among them; it wrote the first two files.
  const task = model.requests.find((request) => request.input.startsWith(PASS))!.input
  const people = listed(task)
  expect(people.map((person) => person.id)).toContain('U0MAYA')
  const other = people.find((person) => person.id !== 'U0MAYA')

  // People is a row per file: the name, the relationship chip and one line of what they work on.
  let page = await openPage(juno, 'What Juno remembers')
  const maya = page.locator('[data-memory-person="U0MAYA"]')
  await expect(maya.locator('[data-memory-person-name]')).toHaveText('Maya Chen')
  await expect(maya.locator('[data-memory-relationship]')).toHaveText('Peer')
  await expect(maya.locator('[data-memory-work]')).toHaveText(WORK)
  if (other !== undefined) await expect(page.locator(`[data-memory-person="${other.id}"] [data-memory-person-name]`)).toHaveText(other.name)
  await expect(page.locator('[data-memory-person]')).toHaveCount(other === undefined ? 1 : 2)

  // A row opens the file in place of the page, with its sections; Back returns to People.
  await maya.click()
  const file = page.locator('[data-memory-file="U0MAYA"]')
  await expect(file).toContainText('Maya Chen')
  await expect(page.locator('[data-memory-section="talk"] [data-memory-entry]')).toContainText(TALK)
  await expect(page.locator('[data-memory-section="talk"] [data-memory-entry]')).toHaveAttribute('data-memory-source', 'slack')
  await page.locator('[data-memory-back]').click()
  await expect(maya).toBeVisible()

  // In the panel beside Maya's DM, a run gets her file after the recent messages, and a draft follows How you talk with them.
  await juno.tabs.select('Maya')
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(juno.win)
  await panel.send(DRAFT)
  await panel.expectJuno(`In your usual way with Maya (${TALK})`)
  const drafted = askedWith(model, DRAFT)
  expect(drafted.memory).toMatch(/<\/recent>\n<people-now>\n## Maya Chen \(U0MAYA\)\nRelationship: Peer \(your guess\)/)
  expect(drafted.memory).toContain(`- [e`)
  expect(drafted.memory).toContain(TALK)
  // The outline names her, never her notes.
  const outline = /<about-owner[\s\S]*?<\/about-owner>/.exec(drafted.memory)?.[0] ?? ''
  expect(outline).toContain('Maya Chen (peer)')
  expect(outline).not.toContain(TALK)

  // The DM's ⋯ menu opens what Juno knows about Maya, where the owner corrects the relationship.
  const menu = await juno.topic.chooseInMenu('juno-knows')
  expect(menu.labels.slice(-2)).toEqual(['-', 'What Juno knows about Maya'])
  await juno.tabs.expectActive('What Juno remembers')
  page = juno.win.locator('main')
  await expect(page.locator('[data-memory-file="U0MAYA"]')).toBeVisible()
  const relationship = page.getByRole('combobox', { name: 'Who they are to you' })
  await expect(relationship).toHaveValue('peer')
  await expect(relationship).toHaveAttribute('data-memory-relationship-by', 'juno')
  await relationship.selectOption('manager')
  await expect(relationship).toHaveValue('manager')
  await expect(relationship).toHaveAttribute('data-memory-relationship-by', 'owner')
  await expect(relationship).toHaveAttribute('data-tooltip', 'Set by you')

  // Privacy mode blurs every note in the file and each row's line of work; names and chips stay readable.
  const note = page.locator('[data-memory-section="talk"] [data-memory-entry] [data-sensitive]')
  await juno.privacy.toggleWithMenu()
  await juno.privacy.expectBlurred(note)
  await page.locator('[data-memory-back]').click()
  await expect(maya.locator('[data-memory-relationship]')).toHaveText('Manager')
  await juno.privacy.expectBlurred(maya.locator('[data-memory-work]'))
  await juno.privacy.expectBlurred(maya.locator('[data-memory-person-name]'), false)
  await juno.privacy.toggleWithMenu()
  await juno.privacy.expectBlurred(maya.locator('[data-memory-work]'), false)

  // The next run beside the DM sees the owner's choice.
  await juno.tabs.select('Maya')
  await panel.send('what does Maya need from me this week?')
  await panel.expectJuno('You said: what does Maya need from me this week?')
  expect(askedWith(model, 'what does Maya need from me').memory).toContain('Relationship: Manager (set by the owner)')
})
