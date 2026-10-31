<img src="assets/icon.svg" width="64" height="64" alt="">

# Juno

A Slack client for Mac that organises conversations into topics and decides which messages are worth a notification.

<!-- Trailer poster goes here, linking to the video. Until then, the screenshot below. -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/topic-release-dark.png">
  <img src="docs/readme/topic-release-light.png" width="100%" alt="The Juno window. On the left, one list of topics with titles, the latest message, unread counts and @ marks. On the right, an open thread from #eng at its 2 new divider.">
</picture>

[Download Juno for Apple Silicon Macs](https://github.com/triptu/juno-releases/releases/latest). Setup is in [Getting started](#getting-started).

Slack is organised by channel, and threads sit inside them. Juno shows one list of topics sorted by what happened last, and decides message by message whether to notify you, with a reason you can read.

## What you get

### One list of topics

<p>
  <img src="docs/readme/topic-design-mocks-light.png" width="49%" alt="A thread from #design open beside the topic list, light theme.">
  <img src="docs/readme/topic-design-mocks-dark.png" width="49%" alt="The same thread and topic list in the dark theme.">
</p>

A topic is a Slack thread, or the unthreaded messages of a channel or DM (its Main). The sidebar lists the threads you follow, the threads that mention you and Main streams, newest activity first. Each row shows the title, the latest message, its channel or person, and what is unread. A topic with no activity for a few days leaves the list unless it is pinned or unread.

With an AI key, Juno names recent threads from their messages and draws a small picture for each row. A title you write yourself stays. Juno asks the model to keep pay, health and other sensitive details out of titles.

<img src="docs/readme/resolve-undo-toast-light.png" width="100%" alt="A topic just resolved: its row has left the list and a toast at the bottom left reads Resolved with an Undo button.">

Resolve marks a topic read and removes it from the list unless it is pinned. A toast offers Undo, and so does ⌘Z. If someone replies later, the topic comes back marked Reopened. Nothing is deleted.

<img src="docs/readme/topic-peek-light.png" width="100%" alt="Holding Option over a sidebar row: the topic shows in a popover beside the list.">

Hold ⌥ over a row to read the topic in a popover. The topic is not opened and not marked read, and the popover is gone when you let go. Space can be the key instead, from Settings.

### Notifications decided for you

<img src="docs/readme/settings-notification-instructions-light.png" width="100%" alt="Settings, Notifications: four instructions in plain words, each set to Notify me or Don't notify, then Always and Never, then the list of how Auto decides.">

Each message either notifies you or stays in Juno. Your notification hours and your Always and Never settings decide first. Simple rules handle the easy cases, such as a thanks after your own message. For the rest, Juno reads the message with its recent conversation and your instructions in your own words ("Production incidents", "Lunch and social plans"), and decides what it needs from you. With AI off, direct messages and mentions notify.

<img src="docs/readme/notification-decisions-light.png" width="100%" alt="Today's notifications: nine messages, each marked Notified or In Juno with the reason, such as Mentions always notify, Naomi thanked you, or Your instructions: Anything about a candidate with a deadline. The top row is open and offers Should have notified.">

Juno keeps each decision and its reason. Settings › Notifications lists today's decisions. One that Juno's reading made has a button to say it should have gone the other way, and Juno then proposes an instruction. Your notification hours are written to Slack's own schedule, so your phone goes quiet at the same time.

### Home

<p>
  <img src="docs/readme/home-light.png" width="49%" alt="Home in the light theme: a greeting and three rows, a question Ruth asked you, something you said you would do, and two topics that look settled.">
  <img src="docs/readme/home-dark.png" width="49%" alt="Home in the dark theme with the same three rows.">
</p>

Home lists questions you have not answered and things you said you would do, with links to their topics. It also suggests topics to resolve. When you are caught up, it shows a painting, print or photograph from the gallery, with one line about it.

### ⌘K and Search

<img src="docs/readme/cmdk-query-light.png" width="100%" alt="The ⌘K palette with the query recurring: matching topics and messages with the word marked.">

⌘K searches conversations and messages already on this Mac. Conversation search tolerates small spelling mistakes. With AI assist on, it also takes commands such as "resolve pricing" or "tell maya the wednesday slot works".

<img src="docs/readme/search-with-topic-light.png" width="100%" alt="The Search tab: results for recurring as cards on the left, and the selected result's topic open on the right at the matching message.">

The Search tab searches Slack with filters for sender, place, date, and messages with a link, a file, a reaction or a pin. Each result is one message, and selecting it opens its topic beside the results at that message.

### Write in the right place

<img src="docs/readme/main-stream-wrong-place-check-light.png" width="100%" alt="Typing in #design's Main. Above the composer, a bar reads Looks like a reply to Week or three-day calendar by default, with Post in thread and Send to Main.">

The pill in the header always says where a message will go, tinted by kind: grey for a public channel, amber for a private one, blue for a DM. When you type in a channel's Main and the message reads like a reply to one of its open threads, Juno offers to post it in that thread. This check runs while you type. Other text fixes appear under the message after you send it, with Review and Dismiss.

### Ask Juno

Chat with Juno in its own tab or beside the topic you are reading (⌘J). Ask it to catch you up on a topic, and the answer links to the messages it read. Ask it to draft a reply, resolve topics, or check a channel every weekday at 9. Drafted messages and proposed resolutions come as cards, and Juno waits for your click before applying either. The Activity page lists each finished run, what it read and what you decided.

### Also

- Tabs like a browser: ⌘T, ⌘W, ⌘⇧T to reopen, pin and drag, and back and forward per tab.
- Views: your own sets of channels and DMs, and an Automated view Juno fills with bot and alert channels, kept out of All.
- All topics lists open, resolved, quiet and unfollowed topics in a table with filters.
- Huddles: join and start Slack huddles, with audio and screen sharing. An incoming huddle rings according to your notification settings.
- Hide message text (⌃⌘H) blurs message previews and titles copied from messages. A setting turns it on when another app starts sharing your screen.
- Web links open in a panel beside the topic.
- Light and dark themes, a choice of accent colours, and compact or comfortable density.

## Getting started

Juno runs on Apple Silicon Macs. Download the file ending in `-arm64.dmg` from the [latest release](https://github.com/triptu/juno-releases/releases/latest), then drag Juno to Applications.

If macOS blocks the first open, open System Settings › Privacy & Security and choose Open Anyway, or run:

```
xattr -d com.apple.quarantine /Applications/Juno.app
```

Sign in to Slack's desktop app first. In Juno, choose "Use the Slack app's session" and allow the macOS password prompt.

Add an OpenRouter key in Settings › Juno for AI titles, topic art, notification reading, Home suggestions and the message checks. The assistant can use OpenRouter or an OpenAI-compatible endpoint. These features send the relevant Slack text to OpenRouter, or to the endpoint you chose for the assistant.
