# Littlebird adapter (WP18)

Littlebird uses WP17's existing HTTP/OAuth manager at
`https://mcp.littlebird.ai/mcp`, and the same discovery as every connection:
`find_tools({ server: 'littlebird' })` lists its tools one line each, and
`find_tools({ server: 'littlebird', tool })` gives one tool's schema
(`../mcp/discovery.ts`). `call_tool` validates against that schema. Reads run
without a card; other calls go through the auto-review. All results taint the
run as untrusted connection content.

There are no invented Littlebird tool aliases. The WP17 preset's guessed read
names were removed, and the code's read list is empty. Since the auto-review
(10-16), a tool Littlebird marks read-only the first time Juno sees it is a
read while its schema is unchanged; every other tool goes through the
auto-review (`../../README.md`, "Auto-review"), which runs a call the owner
asked for in so many words that can be undone and asks for anything else. A
read-only mark that appears later grants nothing. A preset's read list comes
from the code at every start, not from the stored row, so an older build's
guessed names are cleared.

The plan asks for a default read list matched to published names, but S8 did
not authenticate and no published names were verified. Until the owner
confirms the hosted list, there is no sound way to infer read authority from
arbitrary names or server descriptions. Do not silently promote tools from
annotations, names such as `get_*`, or a model's classification.

Owner live check: sign in, inspect the complete discovered tool list, identify
meeting/context/routine-report/account reads, review their input and output
schemas, and add the confirmed reads to the code's read list. Exercise one synthetic lookup
and one approved write in owner-selected test material. Record the verified
names and schema hashes before adding defaults. Confirm schema-change
notifications, token refresh and write error behaviour. WP18 accessed no
live account and assumes no write deduplication or safe automatic retry.
