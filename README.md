# Oddsify Intel

Free, live sports dashboard covering MLB, NBA, NCAAB, EPL, Champions League, MLS, and USL Championship.

Scores, schedules, standings, news, weather, and injuries — all pulled live from ESPN's public scoreboard & summary APIs through a single Node proxy.

Built as the public funnel into [Oddsify Terminal](https://oddsifysports.com) (paid betting signals). Informational use only — not wagering advice.

## Stack

- **Frontend:** Vanilla HTML/CSS/JS — no build step, no framework. Teko + Inter + JetBrains Mono typography.
- **Backend:** Single Node.js file (`server.js`) — ESPN proxy with SSRF guards, rate limiting, path-traversal protection.
- **Data:** ESPN's public site API (free, unauthenticated) routed through `/api/espn/*`. No paid data sources.
- **PWA:** Service worker + web manifest for offline shell + asset caching.

## Run locally

```bash
npm install
npm start         # serves on PORT (default 8787)
# OR
PORT=8788 node server.js
```

Then open `http://localhost:8787/`.

## Deploy

Configured for Railway (`railway.json`). Drop the repo into a new Railway service, set the custom domain, and it boots.

## Architecture

```
index.html       — visual shell (header, clock, tabs, ticker, panels)
js/config.js     — league registry (sport + slug → ESPN endpoints)
js/storage.js    — localStorage wrapper for watchlist, settings
js/api.js        — fetch layer w/ retry, LRU cache, dynamic TTL
js/render.js     — game cards, weather cards, injuries, news, ticker
js/app.js        — v2 bootstrap: wires Render into v2's chrome
css/styles.css   — design tokens + content area styles
server.js        — Node proxy + static file server
sw.js            — service worker (cache-first static, network-first API)
```

### Data flow

1. `app.js` calls `Api.getScoreboard(league)` for each league in `LEAGUES`
2. Results are cached as `[{league, games, scoreboardData}]`
3. `Render.gameList(container, events, league, ...)` renders the Games tab
4. Weather tab derives cards directly from `scoreboardData.events[*].weather`
5. News tab calls `Api.getNews(league)` (separate `/news` endpoint)
6. Every 60s, the cycle repeats — silent refresh, no flicker

### Why no per-game /summary fetches?

ESPN's per-game `/summary?event=X` endpoint returns 404 for live events. We tried it — the Weather tab hung for 5+ seconds on a 26-call storm that all 404'd. The scoreboard payload already includes weather for ~90% of outdoor games, so we derive cards from there directly and skip the slow `/summary` chain entirely.

## Tabs

- **Games** — every league's slate for today, with live odds & O/U lines
- **Live** — games currently in progress, across all leagues
- **News** — top headlines per league, with source links
- **Injuries** — per-team injury reports from today's feed
- **Weather** — temperature + conditions for every outdoor venue playing today

## Caching

- **API responses:** 5s TTL for live games, 30s for upcoming, 60s for finished. Pruned every 60s, capped at 100 entries.
- **Static assets:** cache-first via service worker. Cache name versioned (`oddsify-static-v4`) so deploys force fresh assets for returning users.
- **API responses via SW:** network-first with cache fallback. 503 + helpful JSON if both fail.

## License

Personal, non-commercial use. ESPN data © ESPN. No warranty on odds accuracy — treat every line as informational, not a wagering recommendation.