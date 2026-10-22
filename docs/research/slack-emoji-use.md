# Slack emoji usage preference

Checked 2026-10-22, read-only. Only the field shape is recorded; no account's emoji names or counts were saved.

`users.prefs.get` returns `prefs.emoji_use` as a JSON string. Parsing it produces an object whose keys are Slack emoji names and whose values are numeric use counts. A live read of only this pref returned HTTP 200 and `ok: true`; every sampled value was a finite nonnegative number. The sampled keys had no surrounding colons. The fake Slack starts with empty prefs and returns its `workspace.prefs` unchanged, so tests must seed an invented JSON string. The recorded API fixture redacts this field and cannot establish its shape.

Static evidence comes from the cached desktop web bundle `gantry-v2-shared-client.b302cf999efc4a84.min.js`, SHA-256 `d9c406cf1a5328743d9218e422bbd0ed35e9ab5e82fb51624f186cc6be8f6cd6`, retained under `/Volumes/AgentWork/forward-re/js/`. REA CLI 6.4.0 analyzed an isolated copy: Evidence `ev_35a31af0f486e1c10437119ace1171dec5a322a1966a30ce661827910d78d979`. Its expanded relationship graph exceeded the result budget; complete static file facts were retained. The following behavior was confirmed by direct reading of module `NebS`, not by executing Slack:

- `getUsedEmojiFromPref` reads the parsed `emoji_use` object. It strips the suffix after `::` through `stripSkinTone`, resolves the remaining name, skips unrecognized names, and sums counts under the resolved name. Thus skin-tone variants and aliases share a rank. No skin-tone key occurred in the live sample, so its syntax here is static evidence.
- It sorts by descending combined count, then ascending name for equal counts. Custom names go through the same resolver. A non-default locale can also exclude names that do not match its localized spelling.
- `getFrequentlyUsedEmoji` can use Slack's frecency model or autocomplete ranking first. The usage-pref ranking is a fallback, with Slack's own minimum list. Therefore `emoji_use` alone does not prove the exact order of every Slack picker.

Juno uses the count ranking requested for its picker, with local picks first and its own quick reactions last. It reads the existing `team.prefs_json` cache; startup already calls `users.prefs.get`, and `pref_change` updates that cache and invalidates `team`. No extra Slack call or write is needed. Juno resolves against its standard catalog and current workspace emoji, skips missing images and deleted names, and ignores invalid or nonpositive counts.
