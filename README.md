<img src="assets/icon.svg" width="64" height="64" alt="">

# Juno

A Slack client for Mac that turns every thread, channel and DM into a topic in one list, and decides which messages are worth a notification.

Created in [T3 Code](https://t3.codes).

<!-- Trailer poster goes here, linking to the video. Until then, the screenshot below. -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/topic-release-dark.png">
  <img src="docs/readme/topic-release-light.png" width="100%" alt="The Juno window. On the left, one list of topics with titles, the latest message, unread counts and @ marks. On the right, an open thread from #eng at its 2 new divider.">
</picture>

Slack is organised by channel, and threads sit inside them. Its notification settings are per channel: everything, mentions, or nothing. Juno shows one list of topics sorted by what happened last, and decides message by message whether to notify you, with a reason you can read.

## What you get

### Topics, not channels

<p>
  <img src="docs/readme/topic-design-mocks-light.png" width="49%" alt="A thread from #design open beside the topic list, light theme.">
  <img src="docs/readme/topic-design-mocks-dark.png" width="49%" alt="The same thread and topic list in the dark theme.">
</p>

A topic is a Slack thread, or the unthreaded messages of a channel or DM (its Main). The sidebar is one list of topics, newest activity first. Each row shows the title, the latest message, its channel or person, and what is unread. A topic that goes quiet leaves the list after a few days, and a reply brings it back marked Reopened.

With an AI key, Juno names each thread from its messages and draws a small picture for its row. A title leaves out pay, health and other sensitive details.

### Notifications decided for you

<img src="docs/readme/settings-notification-instructions-light.png" width="100%" alt="Settings, Notifications: four instructions in plain words, each set to Notify me or Don't notify, and the list of how Auto decides.">

Each message either notifies you or stays in Juno. Your notification hours and your Always and Never settings per person, channel and thread decide first. Then a few rules: a "thanks" after your own message stays, a message addressed to someone else stays, a reply soon after your own message notifies. For what is left, Juno reads the message against your instructions in your own words ("Production incidents", "Lunch and social plans") and decides what it needs from you. With AI off, only direct messages and mentions notify.

<img src="docs/readme/notification-decisions-light.png" width="100%" alt="Today's notifications: each message with Notified or In Juno and the reason, such as Mentions always notify, Naomi asks you something, or An update with nothing asked of you.">

Every decision is kept with its reason. Settings › Notifications shows today's count and the list, and each row has a button to say it should have gone the other way, which proposes an instruction. Your notification hours are written to Slack's own schedule, so your phone goes quiet at the same time.

### Home

<p>
  <img src="docs/readme/home-light.png" width="49%" alt="Home in the light theme: a greeting and three rows, a question for you, a follow-up you promised, and two topics that look settled.">
  <img src="docs/readme/home-dark.png" width="49%" alt="Home in the dark theme with the same three rows.">
</p>

Home shows at most three things that want you: a question you have not answered, something you said you would do, topics that look settled. Each row has a button to act on it. When nothing wants you, Home shows a painting, print or photograph from a bundled set, with one line about it.

### ⌘K and Search

<img src="docs/readme/cmdk-query-light.png" width="100%" alt="The ⌘K palette with the query recurring: matching topics and messages with the word marked.">

⌘K opens any conversation, topic, message or command from what is already on this Mac, so it never waits for the network. A misspelt name still finds the person, and it takes plain sentences such as "tell maya the wednesday slot works" or "resolve pricing".

<img src="docs/readme/search-with-topic-light.png" width="100%" alt="The Search tab: results for recurring as cards on the left, and the selected result's topic open on the right at the matching message.">

The Search tab searches Slack with filters for sender, place, date and attachments. Each result is one message, and selecting it opens its topic beside the results at that message.

### Write in the right place

<img src="docs/readme/main-stream-wrong-place-check-light.png" width="100%" alt="Typing in #design's Main. Above the composer, a bar reads Looks like a reply to Week or three-day calendar by default, with Post in thread and Send to Main.">

The pill in the header always says where a message will go, tinted by kind: grey for a public channel, amber for a private one, blue for a DM. When you type in a channel's Main and the message reads like a reply to one of its open threads, Juno offers to post it in that thread. Enter never waits for this check. After a message is sent, small text fixes show under it with Review and Dismiss. Nothing checks your text before you press Enter.

### Resolve and undo

<img src="docs/readme/resolve-undo-toast-light.png" width="100%" alt="A topic just resolved: its row has left the list and a toast at the bottom left reads Resolved with an Undo button.">

Resolve clears a topic from the list and marks it read. A toast offers Undo, and so does ⌘Z. If someone replies later, the topic comes back marked Reopened. Nothing is deleted.

### Peek

<img src="docs/readme/topic-peek-light.png" width="100%" alt="Holding Option over a sidebar row: the topic shows in a popover beside the list.">

Hold ⌥ over a row to read the topic in a popover. The topic is not opened and not marked read, and the popover is gone when you let go. Space can be the key instead, from Settings.

### Privacy mode

Hide message text (⌃⌘H) blurs message previews and plain titles in the sidebar. It turns on by itself when another app starts sharing or recording your screen, and off when that ends. While it is on, notification banners say "Message hidden" instead of the message.

### Ask Juno

Juno is one chat with one assistant, in its own tab or beside the topic you are reading (⌘J). Ask it to catch you up on a topic, and each claim links to the message it came from. Ask it to draft a reply, resolve topics, catch you up on a channel every weekday at 9, or tell you if someone has not replied by Thursday. Anything that leaves Juno, a message or a resolve, is a card with one button, and nothing is sent until you press it. The Activity page lists every run, what it read and what you decided.

### Huddles

Join and start Slack huddles from Juno, with audio and screen sharing. A bar at the top of the sidebar shows who is talking, with Mute, Share screen and Leave. An incoming huddle rings and shows a card with Join and Dismiss.

### Also

- Tabs like a browser: ⌘T, ⌘W, ⌘⇧T to reopen, pin and drag, and back and forward per tab.
- Views: your own sets of channels and DMs, and an Automated view Juno fills with bot and alert channels, kept out of All.
- All topics: every topic, open, resolved, quiet or unfollowed, in a table with filters.
- Web links open in a panel beside the topic.
- Light and dark themes, a choice of accent colours, and compact or comfortable density.

## Getting started

Juno runs on Apple Silicon Macs. Download the file ending in `-arm64.dmg` from the [latest release](https://github.com/triptu/juno-releases/releases/latest), then drag Juno to Applications.

The app is not notarized, so macOS blocks the first open. Open System Settings › Privacy & Security and choose Open Anyway, or run:

```
xattr -d com.apple.quarantine /Applications/Juno.app
```

Sign in to the Slack desktop app on this Mac first. Juno uses its session, and macOS asks for your password once to allow that.

For topic titles and art, Home's wording, notification reading and the assistant, add an OpenRouter key or an OpenAI-compatible endpoint in Settings › Juno. Everything else works without one.

## Credits

The pictures Home shows when you are caught up come from museums and archives that publish them as public domain or CC0. Each picture shows its credit, with a link to the source.
