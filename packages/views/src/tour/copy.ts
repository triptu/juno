/**
 * The tour's words (SPEC 4.1, "The tour"). Each step has one job, a
 * heading of a few words, one or two short sentences and at most three
 * callouts. A callout names an anchor that `pnpm tour:shots` measured in
 * the step's screenshot (`shots/manifest.json`), so a label always points
 * at what it names, whatever the UI looks like by then.
 */

export type TourStepId = 'topics' | 'dm-twice' | 'around' | 'yours' | 'juno'

export interface TourCallout {
  /** The anchor in the screenshot's manifest. */
  readonly anchor: string
  readonly label: string
}

export interface TourStep {
  readonly id: TourStepId
  readonly heading: string
  readonly body: string
  /** What the screenshot shows, for VoiceOver. The callouts are read as text after it. */
  readonly alt: string
  readonly callouts: ReadonlyArray<TourCallout>
}

export const tourSteps: ReadonlyArray<TourStep> = [
  {
    // Moves the model from channels to topics: the list is threads and Mains, not channels.
    id: 'topics',
    heading: 'Topics, not channels',
    body: 'Each Slack thread is its own topic in the sidebar. Messages sent outside threads go to the channel’s Main, which is a topic too.',
    alt: 'The sidebar, with a thread in #eng and the #eng Main marked.',
    callouts: [
      { anchor: 'thread', label: 'A thread in #eng' },
      { anchor: 'main', label: 'The #eng Main: messages outside threads' },
    ],
  },
  {
    // Answers the first question people ask: why is this DM here twice?
    id: 'dm-twice',
    heading: 'Why a DM can show up twice',
    body: 'It’s not a duplicate. Your DM with Maya has a Main for messages outside threads, and each thread in it is a topic of its own.',
    alt: 'Maya Chen’s DM open on its Main, with a thread from the same DM as a second row in the sidebar.',
    callouts: [
      { anchor: 'main', label: 'The DM’s Main' },
      { anchor: 'thread', label: 'A thread in the same DM' },
      { anchor: 'link', label: 'Where that thread started' },
    ],
  },
  {
    // The lay of the land: where things are and how to move between them.
    id: 'around',
    heading: 'Getting around',
    body: 'Topics open in tabs, like a browser. Home shows what needs you, and All topics has everything, quiet threads included.',
    alt: 'The window, with a topic open in a peek beside the sidebar.',
    callouts: [
      { anchor: 'nav', label: 'Home, All topics and Juno' },
      { anchor: 'search', label: '⌘K finds any conversation or command' },
      { anchor: 'peek', label: 'Hold ⌥ over a row to peek without marking it read' },
    ],
  },
  {
    // What the owner can change, and where.
    id: 'yours',
    heading: 'Make it yours',
    body: 'Views group the channels and DMs you choose. Bot and alert channels go to Automated, so they stay out of All.',
    alt: 'The sidebar, with the Automated view and two views of your own among the filters.',
    callouts: [
      { anchor: 'automated', label: 'Automated: bots and alerts' },
      { anchor: 'new-view', label: 'Make a view' },
      { anchor: 'settings', label: 'Settings: theme, density, notifications (⌘,)' },
    ],
  },
  {
    // What Juno is, what it does and what it never does.
    id: 'juno',
    heading: 'Juno helps, you decide',
    body: 'Juno is the assistant. Ask it to catch you up or find what someone said. It sends nothing until you click.',
    alt: 'The Juno tab, with a message to Maya waiting for Send.',
    callouts: [
      { anchor: 'nav', label: 'Open Juno here, or press ⌘J in a topic' },
      { anchor: 'send', label: 'Nothing goes out until you click Send' },
    ],
  },
]

export const tourCopy = {
  /** The sheet's name for VoiceOver. */
  label: 'Tour of Juno',
  step: (index: number, total: number) => `Step ${index + 1} of ${total}`,
  next: 'Next',
  back: 'Back',
  done: 'Done',
  skip: 'Skip tour',
  /** Under the last step's text while no model provider is set up. */
  needsProvider: 'Juno needs an AI provider before it can answer.',
  addProvider: 'Add a provider',
  dots: 'Steps',
} as const
