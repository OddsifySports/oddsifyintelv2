/**
 * League registry.
 *
 * `sport` + `slug` map to ESPN's public site API:
 *   https://site.api.espn.com/apis/site/v2/sports/{sport}/{slug}/scoreboard
 *   https://site.api.espn.com/apis/site/v2/sports/{sport}/{slug}/standings
 *
 * These are unauthenticated, unofficial endpoints ESPN serves for its own
 * site — no API key, but also no uptime guarantee or rate-limit SLA.
 * If a league ever 404s or changes shape, check the current slug at
 * https://gist.github.com/akeaswaran/b48b02f1c94f873c6655e7129910fc3b
 * (a widely-used community reference) and update the entry below.
 *
 * `hasOdds`: whether this league's scoreboard typically carries an
 * `odds` block (spread/over-under) in the ESPN feed. Set false to skip
 * rendering an odds row entirely rather than showing "no odds" noise.
 *
 * `logo`: a best-effort ESPN CDN league badge URL (the same CDN that
 * serves team logos embedded in the scoreboard feed). These aren't
 * returned by the API itself, so the exact filename can drift — every
 * <img> that uses this in the app has an onerror handler that just
 * hides the badge rather than showing a broken-image icon, so a stale
 * URL degrades gracefully instead of looking broken.
 */
const LEAGUES = [
  {
    id: "mlb",
    label: "MLB",
    sport: "baseball",
    slug: "mlb",
    hasOdds: true,
    standingsGroupBy: "division",
    logo: "https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png",
  },
  {
    id: "nba",
    label: "NBA",
    sport: "basketball",
    slug: "nba",
    hasOdds: true,
    standingsGroupBy: "conference",
    logo: "https://a.espncdn.com/i/teamlogos/leagues/500/nba.png",
  },
  {
    id: "ncaab",
    label: "NCAAB",
    sport: "basketball",
    slug: "mens-college-basketball",
    hasOdds: false,
    standingsGroupBy: "conference",
    logo: "https://a.espncdn.com/i/teamlogos/leagues/500/ncaam.png",
  },
  {
    id: "epl",
    label: "Premier League",
    sport: "soccer",
    slug: "eng.1",
    hasOdds: true,
    standingsGroupBy: null,
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png",
  },
  {
    id: "ucl",
    label: "Champions League",
    sport: "soccer",
    slug: "uefa.champions",
    hasOdds: false,
    standingsGroupBy: null,
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png",
  },
  {
    id: "mls",
    label: "MLS",
    sport: "soccer",
    slug: "usa.1",
    hasOdds: true,
    standingsGroupBy: "group",
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/19.png",
  },
  {
    id: "uslc",
    label: "USL Champ.",
    sport: "soccer",
    slug: "usa.usl.1",
    hasOdds: false,
    standingsGroupBy: "group",
    logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/1004.png",
  },
];

// Route every data fetch through the Node proxy (server.js) so ESPN/Akamai
// bot-mitigation only has to deal with ONE egress IP (Railway) sending a
// real-browser UA, not every visitor's browser. Also keeps the SW cache
// honest — proxy responses are short-lived (15s) so a stale 403 doesn't
// pin a user's dashboard to "no games" for the full SW cache lifetime.
const API_BASE = "/api/espn";

// How often the dashboard silently re-fetches, in milliseconds.
const REFRESH_INTERVAL_MS = 60_000;
