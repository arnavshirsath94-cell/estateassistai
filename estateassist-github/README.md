# EstateAssist AI — GitHub package

This package contains the public website files and the original local Node.js prototype source. It does not include local database records, backups, or credentials.

## Deploy with your current Cloudflare Worker command

The `wrangler.jsonc` file configures Wrangler to publish the static files in `docs/`. Keep the deploy command as:

```sh
npx wrangler deploy
```

In your Git-connected build settings, use the repository root as the project root and keep the deploy command above. Wrangler reads `wrangler.jsonc` from the repository root and serves `docs/index.html` and its CSS/JavaScript as static assets.

## Or deploy as Cloudflare Pages

If you choose Pages instead of Workers, set the build output directory to `docs` and use no build command (or `exit 0`). Do not use `npx wrangler deploy` as the Pages build command.

## GitHub Pages

For GitHub Pages, choose the `docs` folder as the publishing source in **Settings → Pages**. The site itself is static.

## What works on static hosting

The page design and guided sample conversation are included. Features that call the local server—AI-backed answers, saving contact requests, saved enquiries, admin queue, and agency workspace—need a separate backend and will not operate on static hosting alone. Do not collect real personal information through this static demo.

## Run the original prototype locally

The source is in `local-source/`. Copy those files into one folder, then from that folder run:

```powershell
node server.js
```

Open `http://127.0.0.1:4174/`. Node.js 18 or newer is required. The server creates fresh local data files on first run. The local admin and agency pages have no authentication; keep them on your own computer and do not expose this server publicly.

## Package contents

- `docs/` — static website assets for publishing.
- `local-source/` — original website, admin/agency UI and local Node server source.
- `wrangler.jsonc` — Wrangler static asset configuration for `npx wrangler deploy`.

The `data/` records, backups, and test scripts from the working project are intentionally excluded. No D1 binding or migration config is included because this project has no D1 migrations or database ID.
