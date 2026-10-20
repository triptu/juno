# Slack emoji names

Checked 2026-10-20, read-only.

Slack’s [admin emoji documentation](https://docs.slack.dev/reference/methods/admin.emoji.add/) requires lowercase names and lists errors for uppercase names, invalid names and names already taken. Its [custom emoji guide](https://slack.com/help/articles/206870177-Add-custom-emoji-and-aliases-to-your-workspace) says a taken name needs another name, and supports aliases of existing emoji. Neither page specifies an exhaustive character alphabet.

A [firsthand upload experiment](https://slack.green/en/blog/how-to-add-custom-emoji-to-slack) reports that lowercase letters, numbers, hyphens and underscores work, while capitals, spaces and most punctuation fail. It explicitly tried `thumbsup` and received `error_name_taken_i18n`, so a standard alias is reserved too. We made no upload or other workspace write.

The existing read-only emoji probe now counts character classes without printing names. `JUNO_LIVE=1 pnpm probe:live -- --only emoji` read 309 entries over one page. Their 3,615 characters were all ASCII lowercase letters, numbers or `+_-`. This sample cannot establish the full allowed alphabet.

Juno’s reaction boundary accepts lowercase Unicode letters, marks and numbers plus `+_-`, instead of restricting names to ASCII. This is a conservative widening for localized names; the public sources and sampled workspace do not verify every Unicode script. Uppercase names, spaces, colons and other punctuation remain invalid. The picker still handles a colliding standard and image name defensively, with distinct keys and the image pick stored by name.
