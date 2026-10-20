# Home's picture files

The catalog (`packages/pictures`) is bundled in the app. Only the image files are downloaded, from the public, read-only Cloudflare R2 bucket `juno-art` (decision home-picture-hosting). Each picture has two files:

- `<id>-small.webp`: fitted in Home's box at 2x (640 by 432), under about 60 KB.
- `<id>-large.webp`: 2400 px on the long edge, for the picture page, under about 900 KB.

## Making the files

```sh
brew install webp            # cwebp; sips comes with macOS
pnpm pictures:build
```

It downloads each original from `sources.json` into `<out>/originals` (once), writes the two WebP files to `<out>` (`/Volumes/AgentWork/pictures` when that volume is mounted, else `scripts/pictures/.out`), prints each picture's sizes and width over height, and fails when the catalog's `ratio` is off. `--only id1,id2` builds a few.

## Uploading

```sh
pnpm dlx wrangler login      # once, in the browser
pnpm pictures:upload
```

It creates the bucket `juno-art` if it is missing, turns on its public r2.dev URL (read-only: anyone can GET a file, only the account can write), uploads the files the bucket lacks or that changed (`<out>/uploaded.json` keeps their hashes) with `content-type: image/webp` and a year's `cache-control`, and prints the public URL. It touches no other bucket or Cloudflare resource. `--dry-run` prints the wrangler commands instead.

Then set `PICTURES_URL` in `packages/engine/src/pictures/cache.ts` to the printed URL. Until it is set, the engine downloads nothing and Home shows its scene.

## In tests

The fake Slack serves `/pictures/<name>` with one small public-domain WebP for every name, and the engine uses it whenever it runs against the fake, so no test reaches the network.
