# Today In Sports

A static, single-page sports dashboard for Phoenix, AZ (Arizona time, no DST). Shows only today's scheduled games across MLB, NBA, NFL, MLS, NCAAF, and NCAAB, plus tabs for live scores, news, injuries, and game-day weather.

Live site: _add your Railway URL here once deployed_

## What's inside

- **Games** — today's schedule only, filterable by league, with original team-color badges and venue-type icons (ballpark, dome, arena, gridiron, pitch)
- **Live** — auto-filters to games currently in progress
- **News** — league headlines with links back to the original source
- **Injuries** — current injury/availability notes by league
- **Weather** — live conditions for Phoenix plus every host city playing today

Everything is a single self-contained `index.html` — no build step, no dependencies, no backend. Fonts load from Google Fonts CDN; everything else (CSS, JS, SVG graphics) is inline.

## ⚠️ Static snapshot, not a live feed

The game times, scores, news, and injury notes are hand-loaded data, accurate as of when this file was last generated — they will **not** auto-update. To make it live, you'd need a small backend (or scheduled rebuild) pulling from a real sports data API (MLB Stats API, a paid odds/scores feed, etc.) instead of the hardcoded JS objects near the top of the `<script>` tag.

## Deploying on Railway

Railway auto-detects a static HTML file and serves it — no Dockerfile or build config needed.

1. Push this repo to GitHub (see below if you haven't yet).
2. Go to [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo**.
3. Select this repo. Railway detects `index.html` and deploys it automatically.
4. Once the build finishes, go to **Settings → Networking** and click **Generate Domain** to get a public `*.up.railway.app` URL.
5. (Optional) Add a custom domain under the same Networking settings.

Every future push to `main` auto-redeploys.

## Pushing this repo to GitHub (if not done yet)

```bash
git init
git add index.html README.md
git commit -m "Initial commit — Today In Sports dashboard"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## Updating content

All data lives near the top of the `<script>` block in `index.html`:

- `games` — today's schedule per league
- `offday` — the "no games today" copy for leagues that aren't playing
- `news` / `injuries` — headline and injury-report entries with source links
- `wxCities` — weather per host city

Edit those objects, commit, and push — Railway redeploys automatically.

## License

Personal, non-commercial project. No affiliation with MLB, NBA, NFL, MLS, NCAA, or any team or league. All team/league graphics are original artwork (colors only, no trademarked logos).
