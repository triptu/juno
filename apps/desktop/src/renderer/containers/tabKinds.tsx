/**
 * What each kind of tab shows: its look in the strip, its label in the
 * history menu, and its page. A new kind of place adds one entry here; the
 * type makes the table list every kind of `Place`.
 */
import { Suspense, type ReactElement } from 'react'
import { junoPageTitles } from '@juno/agent-contract'
import { mainTopicOf, type TopicDetail } from '@juno/contract'
import { pictureTitle, registry, topicAtom, type Place } from '@juno/state'
import type { WorkspaceTab, WorkspaceTabIcon } from '@juno/views'
import { chunk } from './chunks'
import { HomePage } from './Home'
import { huddleTabTitle } from './huddle/title'
import { JunoPageTab, JunoTab } from './juno/lazy'
import { AllTopicsPage } from './navigation'
import { TopicTab } from './TopicView'

// Settings warms on idle after the first paint, outside the startup bundle.
const settings = chunk(() => import('./Settings'))
const SettingsTab = settings.component((module) => module.SettingsTab)
export const loadSettingsTab = settings.load

// The developer log loads when its tab first shows.
const devLog = chunk(() => import('./DevLog'))
const DevLogTab = devLog.component((module) => module.DevLogTab)

// The gallery and the picture page load when a gallery tab first shows (SPEC 12, "Pictures and the gallery").
const gallery = chunk(() => import('./Gallery'))
const GalleryTab = gallery.component((module) => module.GalleryTab)

// The huddle page loads when a huddle tab first shows.
const huddle = chunk(() => import('./huddle/Tab'))
const HuddleTab = huddle.component((module) => module.HuddleTab)

/** How the strip draws a tab, apart from its id and pin. */
export type TabLook = Omit<WorkspaceTab, 'id' | 'pinned'>

export interface TabKind<P extends Place> {
  /** The tab in the strip. `detail` is the topic's header for a topic, and unused otherwise. */
  readonly strip: (place: P, detail: TopicDetail | null | undefined) => TabLook
  /** What the history menu calls the place. */
  readonly label: (place: P) => string
  /** The page. Its key is the place, so a new place in the tab mounts afresh. */
  readonly page: (place: P, tabId: string) => ReactElement
}

const kindIcons: Record<TopicDetail['channel']['kind'], WorkspaceTabIcon> = {
  public: 'hash',
  private: 'lock',
  im: 'user',
  mpim: 'users',
}

const blank = { tile: { kind: 'blank' } } as const

/**
 * A topic tab's tile: the other person's photo in a DM (its Main and its
 * threads), the same URL the sidebar row shows; the group glyph in a group
 * DM; otherwise the topic's art or its placeholder. Empty while the header loads.
 */
function tileOf(detail: TopicDetail | null | undefined): Pick<WorkspaceTab, 'tile'> {
  if (detail === undefined) return blank
  if (detail === null || detail.channel.kind === 'mpim') return {}
  if (detail.channel.kind === 'im') {
    const { channel } = detail
    const partner = channel.partner
    const src = partner?.avatarUrl === undefined ? undefined : partner.avatarLargeUrl || partner.avatarUrl
    return { tile: { kind: 'person', id: partner?.id ?? channel.id, name: partner?.name ?? channel.name, color: partner?.color ?? channel.color, ...(src === undefined ? {} : { src }) } }
  }
  return { tile: { kind: 'art', topicId: detail.id, ...(detail.art === undefined ? {} : { recipe: detail.art }) } }
}

/** A topic in the strip: its title, or the channel name for Main, with the topic's art or the DM person's photo in the icon slot. */
const topicLook = (detail: TopicDetail | null | undefined): TabLook => ({
  title: detail == null ? '' : detail.kind === 'main' ? detail.channel.name : detail.title,
  icon: detail == null ? 'hash' : kindIcons[detail.channel.kind],
  unread: detail != null && detail.unreadCount > 0,
  ...tileOf(detail),
})

function topicDetailOf(topicId: string): TopicDetail | null {
  const result = registry.get(topicAtom(topicId))
  return result._tag === 'Success' ? result.value : null
}

function topicLabel(topicId: string): string {
  const detail = topicDetailOf(topicId)
  if (detail === null) return 'Topic'
  return detail.kind === 'main' ? detail.channel.label : detail.title
}

/** A page's entry: one title in the strip and the history menu. */
const pageKind = <P extends Place>(title: (place: P) => string, icon: WorkspaceTabIcon, page: TabKind<P>['page']): TabKind<P> => ({
  strip: (place) => ({ title: title(place), icon }),
  label: title,
  page,
})

export const tabKinds: { readonly [K in Place['kind']]: TabKind<Extract<Place, { kind: K }>> } = {
  topic: {
    strip: (_, detail) => topicLook(detail),
    label: (place) => topicLabel(place.topicId),
    page: (place, tabId) => <TopicTab key={place.viewId ?? place.topicId} tabId={tabId} id={place.viewId ?? place.topicId} />,
  },
  home: pageKind(() => 'Home', 'home', (_, tabId) => <HomePage key="home" tabId={tabId} />),
  allTopics: pageKind(() => 'All topics', 'all-topics', () => (
    <Suspense key="all-topics" fallback={null}>
      <AllTopicsPage />
    </Suspense>
  )),
  settings: pageKind(() => 'Settings', 'settings', (place) => (
    <Suspense key="settings" fallback={null}>
      <SettingsTab section={place.section} />
    </Suspense>
  )),
  juno: pageKind(() => 'Juno', 'juno', (_, tabId) => (
    <Suspense key="juno" fallback={null}>
      <JunoTab tabId={tabId} />
    </Suspense>
  )),
  junoPage: pageKind((place) => junoPageTitles[place.page], 'juno', (place) => (
    <Suspense key={place.page} fallback={null}>
      <JunoPageTab page={place.page} />
    </Suspense>
  )),
  devLog: pageKind(() => 'Developer log', 'settings', () => (
    <Suspense key="dev-log" fallback={null}>
      <DevLogTab />
    </Suspense>
  )),
  gallery: pageKind((place) => (place.pictureId === undefined ? 'Gallery' : pictureTitle(place.pictureId) ?? 'Gallery'), 'gallery', (place, tabId) => (
    <Suspense key={place.pictureId ?? 'gallery'} fallback={null}>
      <GalleryTab pictureId={place.pictureId} tabId={tabId} />
    </Suspense>
  )),
  huddle: {
    strip: (_, detail) => ({ title: huddleTabTitle(detail), icon: 'headphones' }),
    label: (place) => huddleTabTitle(topicDetailOf(mainTopicOf(place.channelId))),
    page: (place, tabId) => (
      <Suspense key={`huddle:${place.channelId}`} fallback={null}>
        <HuddleTab channelId={place.channelId} tabId={tabId} />
      </Suspense>
    ),
  },
}

/** The entry for a place's kind. */
export const tabKindOf = (place: Place): TabKind<Place> => tabKinds[place.kind] as TabKind<Place>
