/**
 * The `demo` seed, for screenshots and recordings of the web shell
 * (`bun run web --demo`): one invented company, Kestrel, which makes a
 * booking app for small clinics, in an ordinary week. Ten channels, two
 * DMs and a group DM; threads that are unread, that mention you, that ask
 * you something, and some that look settled; two design mocks. Every name
 * and message is invented.
 *
 * ```ts
 * const fake = await startFakeSlack({ seed: demoSeed, teamName: DEMO_TEAM_NAME })
 * ```
 */
import { seedFrom, type SeedConversation, type SeedFile, type SeedUser } from '../fixtures.ts'
import type { Workspace } from '../state.ts'
import { threeDayViewPng, weekViewPng } from './demoImages.ts'

export const DEMO_TEAM_NAME = 'Kestrel'

const SELF = 'U0TUSHAR'

const PEOPLE: ReadonlyArray<SeedUser> = [
  { id: SELF, name: 'alex', realName: 'Alex Rivera', title: 'Head of engineering', color: '3b6ea8', tz: 'Europe/London' },
  { id: 'U0NAOMI', name: 'naomi', realName: 'Naomi Brandt', title: 'Product lead', color: 'b0496b', tz: 'Europe/Berlin' },
  { id: 'U0THEO', name: 'theo', realName: 'Theo Lindqvist', title: 'Staff engineer', color: '2f6f5e', tz: 'Europe/Stockholm' },
  { id: 'U0AMARA', name: 'amara', realName: 'Amara Nwosu', title: 'Product designer', color: 'c26a2e', tz: 'Europe/London' },
  { id: 'U0KENJI', name: 'kenji', realName: 'Kenji Mori', title: 'iOS engineer', color: '5b4aa0', tz: 'Europe/Amsterdam' },
  { id: 'U0LUCIA', name: 'lucia', realName: 'Lucía Ferreira', title: 'Backend engineer', color: '8a5a44', tz: 'Europe/Lisbon' },
  { id: 'U0FARAH', name: 'farah', realName: 'Farah Siddiqui', title: 'Customer success', color: '1f7a8c', tz: 'Europe/London' },
  { id: 'U0OSKAR', name: 'oskar', realName: 'Oskar Hale', title: 'Site reliability', color: '64748b', tz: 'Europe/Oslo' },
  { id: 'U0RUTH', name: 'ruth', realName: 'Ruth Adeyemi', title: 'Recruiter', color: 'a0526e', tz: 'Europe/London' },
  { id: 'U0DEPLOYBOT', name: 'deploybot', realName: 'Deploy Bot', title: '', color: '7a7a80', tz: 'UTC', bot: true },
  { id: 'U0UPTIME', name: 'uptime', realName: 'Uptime', title: '', color: '7a7a80', tz: 'UTC', bot: true },
]

const TEAM = PEOPLE.filter((p) => p.bot !== true).map((p) => p.id)

const WEEK_VIEW: SeedFile = { id: 'F0DEMOWEEK', name: 'calendar-week.png', title: 'Calendar, week view', mimetype: 'image/png', bytes: weekViewPng }
const THREE_DAY_VIEW: SeedFile = { id: 'F0DEMO3DAY', name: 'calendar-three-days.png', title: 'Calendar, three days', mimetype: 'image/png', bytes: threeDayViewPng }

const HOUR = 60
const DAY = 24 * HOUR

const CONVERSATIONS: ReadonlyArray<SeedConversation> = [
  {
    id: 'C0ENG',
    name: 'eng',
    kind: 'public',
    members: TEAM,
    topic: 'Engineering',
    purpose: 'Engineering at Kestrel. Start a thread for anything longer than a quick question.',
    unread: 2,
    messages: [
      { from: 'U0OSKAR', text: 'Heads up: staging is read-only from 2 to 3pm today for the database upgrade.', ago: 5 * HOUR },
      { from: 'U0LUCIA', text: 'thanks for the warning', ago: 5 * HOUR - 4 },
      { from: 'U0KENJI', text: 'Does that affect TestFlight builds?', ago: 4 * HOUR + 40 },
      { from: 'U0OSKAR', text: 'No, only the staging API.', ago: 4 * HOUR + 36 },
      { from: 'U0THEO', text: 'Small thing: please rebase on main before Thursday. The lint config changed.', ago: 42 },
      { from: 'U0LUCIA', text: 'Done for mine.', ago: 39, reactions: [['+1', 'U0THEO']] },
      {
        from: 'U0THEO',
        text: "Release 2.4 goes out Thursday. Here's what's in it and what's still open.",
        ago: 2 * DAY + 2 * HOUR,
        thread: { unread: 2 },
        replies: [
          { from: 'U0KENJI', text: 'The iOS build is in review with Apple. Usually takes a day.', ago: 2 * DAY + HOUR },
          { from: 'U0LUCIA', text: 'The recurring bookings API is merged behind the flag.', ago: DAY + 5 * HOUR, reactions: [['tada', 'U0THEO', 'U0NAOMI']] },
          { from: 'U0NAOMI', text: 'Release notes draft is in the doc. The calendar week view is the headline.', ago: DAY + 2 * HOUR },
          { from: 'U0THEO', text: 'Two blockers left: the time zone bug in reminders and the push retry. Both have owners.', ago: 3 * HOUR },
          { from: 'U0THEO', text: '<@U0TUSHAR> can you sign off on the release notes by Wednesday?', ago: 25 },
        ],
      },
      {
        from: 'U0LUCIA',
        text: 'Push reminders on the new queue? Retries are best effort today, and we lose about 0.3% of them.',
        ago: DAY + 6 * HOUR,
        replies: [
          { from: 'U0OSKAR', text: 'Agree. The new queue gives us dead letters for free.', ago: DAY + 5 * HOUR },
          { from: 'U0THEO', text: 'After 2.4, though. Not worth the risk this week.', ago: DAY + 4 * HOUR },
          { from: 'U0LUCIA', text: "Fair. I'll have the plan ready for Monday.", ago: DAY + 4 * HOUR - 10, reactions: [['+1', 'U0THEO', 'U0OSKAR', SELF]] },
        ],
      },
      {
        from: 'U0KENJI',
        text: 'Sign-in test is flaky again. It fails on CI about one run in ten.',
        ago: 7 * HOUR,
        replies: [
          { from: 'U0THEO', text: "It waits on the keyboard animation. I've seen this one before.", ago: 6 * HOUR + 30 },
          { from: 'U0KENJI', text: 'Adding an explicit wait for the field. PR in a bit.', ago: 6 * HOUR },
          { from: 'U0KENJI', text: 'Fixed in #1482. Ten green runs in a row.', ago: 3 * HOUR + 20, reactions: [['tada', 'U0THEO', 'U0LUCIA']] },
        ],
      },
      {
        from: 'U0OSKAR',
        text: 'CI bill went up 40%. Most of it is the iOS simulators.',
        ago: 3 * DAY + HOUR,
        replies: [
          { from: 'U0KENJI', text: 'We run the full UI suite on every push. We could run it on merge only.', ago: 3 * DAY },
          { from: 'U0OSKAR', text: "Let's try that for two weeks and compare.", ago: 3 * DAY - 20 },
        ],
      },
    ],
  },
  {
    id: 'C0PRODUCT',
    name: 'product',
    kind: 'public',
    members: TEAM,
    topic: 'Roadmap, specs and launches',
    messages: [
      {
        from: 'U0NAOMI',
        text: 'Onboarding v2: drop the phone step. 31% of new clinics stop at the phone number screen.',
        ago: 3 * HOUR + 20,
        thread: { unread: 3 },
        replies: [
          { from: 'U0AMARA', text: 'Agree. We only need it for SMS reminders, and we can ask for it later.', ago: 3 * HOUR },
          { from: 'U0FARAH', text: "Two clinics told me last week they didn't want to give a personal number at sign-up.", ago: 2 * HOUR + 40 },
          { from: SELF, text: 'Eng is fine with it. The SMS opt-in moves to settings, about two days of work.', ago: 2 * HOUR },
          { from: 'U0NAOMI', text: "Great, I'll update the spec. <@U0AMARA> can you mock the new first screen?", ago: HOUR + 30 },
          { from: 'U0AMARA', text: 'On it. First pass tomorrow morning.', ago: HOUR + 10, reactions: [['pray', 'U0NAOMI']] },
          { from: 'U0FARAH', text: 'I can line up three clinics to try it next week.', ago: 50 },
        ],
      },
      {
        from: 'U0NAOMI',
        text: 'Annual plan pricing copy is ready. Comments by Wednesday, please.',
        ago: 2 * DAY + 3 * HOUR,
        replies: [
          { from: 'U0FARAH', text: 'Can we say "two months free" instead of "17% off"? Clinics think in months.', ago: 2 * DAY + 2 * HOUR },
          { from: 'U0NAOMI', text: 'Good call. Changed.', ago: 2 * DAY + HOUR, reactions: [['white_check_mark', 'U0FARAH']] },
        ],
      },
      {
        from: 'U0FARAH',
        text: 'Customer interview notes are up. They are in the research folder. Short version: recurring appointments came up in every call.',
        ago: DAY + 2 * HOUR,
        replies: [
          { from: 'U0NAOMI', text: "That matches support. It's been the top request three months running.", ago: DAY + HOUR },
          { from: SELF, text: 'The API side is done for 2.4. The booking screen is the open part.', ago: DAY + 30 },
        ],
      },
    ],
  },
  {
    id: 'C0DESIGN',
    name: 'design',
    kind: 'public',
    members: TEAM,
    topic: 'Crits, mocks and the design system',
    messages: [
      { from: 'U0AMARA', text: 'Design crit moves to Thursday at 3pm this week.', ago: 9 * HOUR },
      {
        from: 'U0AMARA',
        text: 'Week or three-day calendar by default? Mock attached.',
        ago: 2 * HOUR + 30,
        files: [WEEK_VIEW],
        thread: { unread: 2 },
        replies: [
          { from: 'U0KENJI', text: "Three days on phones. A week doesn't fit without tiny text.", ago: 2 * HOUR + 10 },
          { from: 'U0NAOMI', text: 'Week on desktop and iPad, though. Clinics plan by the week.', ago: HOUR + 50, reactions: [['+1', 'U0AMARA', 'U0KENJI']] },
          { from: 'U0AMARA', text: "Here's the three-day view for phones.", ago: 35, files: [THREE_DAY_VIEW] },
          { from: 'U0AMARA', text: 'Going with a default per device unless someone objects by tomorrow.', ago: 33 },
        ],
      },
      {
        from: 'U0AMARA',
        text: 'New dashboard empty states are ready. They are in Figma.',
        ago: 4 * DAY,
        replies: [{ from: 'U0THEO', text: 'These are lovely. Ship them.', ago: 4 * DAY - HOUR, reactions: [['heart', 'U0AMARA']] }],
      },
    ],
  },
  {
    id: 'C0INCIDENTS',
    name: 'incidents',
    kind: 'public',
    members: TEAM,
    topic: 'One thread per incident',
    messages: [
      {
        from: 'U0OSKAR',
        text: 'Booking confirmations delayed in the EU. Looking.',
        ago: DAY + 9 * HOUR,
        replies: [
          { from: 'U0OSKAR', text: 'Cause: the email provider is throttling us after the spike this morning. Switched to the backup sender.', ago: DAY + 8 * HOUR + 30 },
          { from: 'U0LUCIA', text: 'Confirmations are flowing again. The backlog is cleared.', ago: DAY + 8 * HOUR, reactions: [['tada', 'U0OSKAR', SELF]] },
          { from: SELF, text: "Thanks both. Can we write up why the backup didn't take over on its own?", ago: DAY + 7 * HOUR + 40 },
          { from: 'U0OSKAR', text: 'Yes. Postmortem by Friday.', ago: DAY + 7 * HOUR + 30, reactions: [['white_check_mark', SELF]] },
        ],
      },
    ],
  },
  {
    id: 'C0MOBILE',
    name: 'mobile',
    kind: 'public',
    members: TEAM,
    topic: 'iOS and Android',
    unread: 1,
    messages: [
      {
        from: 'U0KENJI',
        text: 'Widget crashes on small phones. It happens when a clinic has more than 20 bookings in a day.',
        ago: HOUR + 40,
        thread: { unread: 2 },
        replies: [
          { from: 'U0AMARA', text: 'Could it show the next three and a count?', ago: HOUR + 20 },
          { from: 'U0KENJI', text: 'That fixes it, and it looks better. Doing that.', ago: HOUR },
          { from: 'U0KENJI', text: "<@U0TUSHAR> is it OK to take this into 2.4? It's a small change.", ago: 12 },
        ],
      },
      { from: 'U0KENJI', text: 'The 2.4 beta is on TestFlight for anyone who wants to try the week view.', ago: 18, reactions: [['eyes', 'U0NAOMI', 'U0AMARA']] },
    ],
  },
  {
    id: 'C0FEEDBACK',
    name: 'customer-feedback',
    kind: 'public',
    members: TEAM,
    topic: 'What clinics tell us',
    purpose: 'Quotes, requests and complaints from customers. One message each.',
    unread: 2,
    messages: [
      { from: 'U0FARAH', text: 'A clinic in Lyon: "The new reminders cut our no-shows in half."', ago: 2 * DAY + 4 * HOUR, reactions: [['heart', 'U0NAOMI', 'U0LUCIA', SELF], ['tada', 'U0THEO']] },
      { from: 'U0FARAH', text: 'Two requests this week to export bookings as a spreadsheet.', ago: DAY + 3 * HOUR },
      {
        from: 'U0FARAH',
        text: 'Can Northgate Physio pay by invoice? They want the yearly plan.',
        ago: 6 * HOUR,
        replies: [
          { from: 'U0NAOMI', text: 'Not yet. Finance can do it by hand for now.', ago: 5 * HOUR + 30 },
          { from: 'U0FARAH', text: "Thanks, I'll let them know.", ago: 5 * HOUR + 20 },
        ],
      },
      { from: 'U0FARAH', text: "A dental practice in Porto asked for recurring bookings again. That's the 14th this month.", ago: 2 * HOUR },
      { from: 'U0FARAH', text: "Harbour Street Clinic can't find where to change opening hours. Screenshot is in the ticket.", ago: 45 },
    ],
  },
  {
    id: 'C0DEPLOYS',
    name: 'deploys',
    kind: 'public',
    members: [...TEAM, 'U0DEPLOYBOT'],
    unread: 4,
    messages: [
      { from: 'U0DEPLOYBOT', text: 'api@3f9c2e deployed to staging', ago: 6 * HOUR },
      { from: 'U0DEPLOYBOT', text: 'api@3f9c2e deployed to production', ago: 5 * HOUR },
      { from: 'U0DEPLOYBOT', text: 'web@a1d077 deployed to staging', ago: 3 * HOUR },
      { from: 'U0DEPLOYBOT', text: 'web@a1d077 deployed to production', ago: 2 * HOUR },
      { from: 'U0DEPLOYBOT', text: 'api@b82e41 deployed to staging', ago: 40 },
      { from: 'U0DEPLOYBOT', text: 'api@b82e41 deployed to production', ago: 8 },
    ],
  },
  {
    id: 'C0ALERTS',
    name: 'alerts',
    kind: 'public',
    members: [...TEAM, 'U0UPTIME'],
    topic: 'Uptime checks for production',
    unread: 3,
    messages: [
      { from: 'U0UPTIME', text: '[DOWN] booking-api eu-west: 3 checks failed', ago: DAY + 9 * HOUR + 5 },
      { from: 'U0UPTIME', text: '[UP] booking-api eu-west after 14 minutes', ago: DAY + 8 * HOUR + 50 },
      { from: 'U0UPTIME', text: '[SLOW] reminders worker p95 above 2s', ago: 4 * HOUR },
      { from: 'U0UPTIME', text: '[OK] reminders worker p95 back under 2s', ago: 3 * HOUR + 30 },
      { from: 'U0UPTIME', text: '[SLOW] web dashboard p95 above 1.5s', ago: 30 },
    ],
  },
  {
    id: 'C0LEADERSHIP',
    name: 'leadership',
    kind: 'private',
    members: [SELF, 'U0NAOMI', 'U0THEO'],
    topic: 'Plans, people and budget',
    messages: [
      {
        from: 'U0NAOMI',
        text: 'Q1 headcount plan for finance. It is due on the 20th.',
        ago: 3 * DAY,
        thread: { unread: 1 },
        replies: [
          { from: 'U0THEO', text: 'Engineering would ask for three: two backend, one mobile.', ago: 3 * DAY - 2 * HOUR },
          { from: 'U0NAOMI', text: '<@U0TUSHAR> can you write the case for the mobile hire? A paragraph is enough.', ago: 4 * HOUR },
        ],
      },
    ],
  },
  {
    id: 'C0HIRING',
    name: 'hiring',
    kind: 'private',
    members: [SELF, 'U0RUTH', 'U0THEO', 'U0KENJI'],
    topic: 'Open roles and candidates',
    messages: [
      {
        from: 'U0RUTH',
        text: 'Selin finished the Android onsite. Panel notes are in the scorecard.',
        ago: HOUR + 10,
        thread: { unread: 2 },
        replies: [
          { from: 'U0KENJI', text: 'Strong. Her take-home handled offline sync better than our app does.', ago: 40 },
          { from: 'U0RUTH', text: '<@U0TUSHAR> she has another offer that expires this week. Could you do a 20 minute call with her tomorrow?', ago: 15 },
        ],
      },
    ],
  },
  // Channels you are not in, for the channel sheet.
  {
    id: 'C0MARKETING',
    name: 'marketing',
    kind: 'public',
    members: ['U0NAOMI', 'U0FARAH'],
    topic: 'Campaigns, the blog and the newsletter',
    messages: [{ from: 'U0NAOMI', text: 'The November newsletter goes out on Tuesday.', ago: DAY }],
  },
  {
    id: 'C0SOCIAL',
    name: 'social',
    kind: 'public',
    members: ['U0AMARA', 'U0KENJI', 'U0LUCIA', 'U0OSKAR', 'U0RUTH'],
    topic: 'Lunch, pets and weekend plans',
    messages: [{ from: 'U0RUTH', text: "Pub quiz on Thursday. Who's in?", ago: 8 * HOUR }],
  },
  {
    id: 'D0NAOMI',
    name: '',
    kind: 'im',
    members: [SELF, 'U0NAOMI'],
    messages: [
      { from: 'U0NAOMI', text: 'Do you have 15 minutes before the planning sync?', ago: DAY + 3 * HOUR },
      { from: SELF, text: 'Yes, 10:45?', ago: DAY + 3 * HOUR - 5 },
      { from: 'U0NAOMI', text: 'Perfect', ago: DAY + 3 * HOUR - 6 },
      {
        from: 'U0NAOMI',
        text: "Engineering slot at Friday's all-hands? Ten minutes on what shipped this month.",
        ago: HOUR + 45,
        thread: { unread: 1 },
        replies: [
          { from: SELF, text: "Yes. I'll show the week view and the reminder numbers.", ago: HOUR + 30 },
          { from: 'U0NAOMI', text: 'Great. Send me a title when you have one.', ago: 20 },
        ],
      },
    ],
  },
  {
    id: 'D0THEO',
    name: '',
    kind: 'im',
    members: [SELF, 'U0THEO'],
    unread: 2,
    messages: [
      { from: 'U0THEO', text: 'Thanks for covering the review yesterday.', ago: DAY + 5 * HOUR },
      { from: SELF, text: 'Any time.', ago: DAY + 5 * HOUR - 3 },
      { from: 'U0THEO', text: 'Do you have a minute to look at the queue plan?', ago: 28 },
      { from: 'U0THEO', text: 'No rush. Before Monday is fine.', ago: 27 },
    ],
  },
  {
    id: 'G0LUNCH',
    name: 'mpdm-alex--amara--kenji-1',
    kind: 'mpim',
    members: [SELF, 'U0AMARA', 'U0KENJI'],
    messages: [
      { from: 'U0AMARA', text: 'Lunch on Friday? The new place by the station.', ago: 6 * HOUR },
      { from: 'U0KENJI', text: 'In', ago: 5 * HOUR + 50 },
      { from: SELF, text: 'Same. 12:30?', ago: 5 * HOUR + 40, reactions: [['+1', 'U0AMARA', 'U0KENJI']] },
    ],
  },
]

/** Fills a workspace with the demo company. Pass it as `startFakeSlack({ seed })`. */
export function demoSeed(workspace: Workspace, avatarBase: string): void {
  seedFrom(workspace, avatarBase, {
    people: PEOPLE,
    usergroups: [{ id: 'S0MOBILE', handle: 'mobile-team', name: 'Mobile team' }],
    prefs: {
      muted_channels: 'C0DEPLOYS',
      highlight_words: 'release',
      mute_sounds: false,
      show_typing: true,
      enable_unread_view: true,
      enable_threads_view: true,
      tz: 'Europe/London',
      time24: false,
      locale: 'en-US',
      all_channels_loud: false,
      channel_notification_settings: '{}',
      desktop_notification_actions: 'default',
      emoji_mode: 'default',
      dnd_enabled: true,
      dnd_days: 'weekdays',
      dnd_start_hour: '19:00',
      dnd_end_hour: '9:00',
    },
    conversations: CONVERSATIONS,
  })
}
