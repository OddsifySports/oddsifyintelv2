/**
 * All client-side persistence lives here, behind localStorage. This is
 * a real deployed site (not a sandboxed artifact), so localStorage is
 * the right tool — it survives refreshes and needs no backend.
 *
 * Three independent stores:
 *   - watchlist:      array of "league:teamAbbr" strings
 *   - odds history:   per game id -> { opening, previous, current, ts }
 *   - results log:    capped array of completed games w/ closing line
 */
const Store = (() => {
  const WATCHLIST_KEY = "oi:watchlist";
  const ODDS_HISTORY_KEY = "oi:oddsHistory";
  const RESULTS_LOG_KEY = "oi:resultsLog";
  const MAX_LOG_ENTRIES = 300;

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or unavailable — fail silently, app still works */
    }
  }

  /* ---------------- watchlist ---------------- */
  function teamKey(leagueId, teamAbbr) {
    return `${leagueId}:${teamAbbr || "?"}`;
  }
  function getWatchlist() {
    return readJSON(WATCHLIST_KEY, []);
  }
  function isWatchlisted(leagueId, teamAbbr) {
    return getWatchlist().includes(teamKey(leagueId, teamAbbr));
  }
  function toggleWatchlist(leagueId, teamAbbr, teamName) {
    const key = teamKey(leagueId, teamAbbr);
    const list = getWatchlist();
    const idx = list.findIndex((k) => k === key);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push(key);
    }
    writeJSON(WATCHLIST_KEY, list);
    // keep a parallel name map so the Watchlist tab can show real names
    const names = readJSON(WATCHLIST_KEY + ":names", {});
    names[key] = teamName || key;
    writeJSON(WATCHLIST_KEY + ":names", names);
    return isWatchlisted(leagueId, teamAbbr);
  }
  function watchlistDisplayName(leagueId, teamAbbr) {
    const names = readJSON(WATCHLIST_KEY + ":names", {});
    return names[teamKey(leagueId, teamAbbr)] || teamAbbr;
  }

  /* ---------------- odds movement ---------------- */
  function parseLine(oddsText) {
    if (!oddsText) return null;
    const match = oddsText.match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
  }

  /**
   * Call once per poll per game. Returns movement info for rendering:
   * { opening, current, delta, direction: 'up'|'down'|'flat'|null }
   */
  function recordOdds(gameId, oddsText) {
    const num = parseLine(oddsText);
    const all = readJSON(ODDS_HISTORY_KEY, {});
    const prior = all[gameId];

    if (num === null) {
      return prior ? { opening: prior.opening, current: prior.current, delta: 0, direction: null } : null;
    }

    if (!prior) {
      all[gameId] = { opening: num, current: num, ts: Date.now() };
      writeJSON(ODDS_HISTORY_KEY, all);
      return { opening: num, current: num, delta: 0, direction: "flat" };
    }

    const delta = +(num - prior.opening).toFixed(1);
    all[gameId] = { opening: prior.opening, current: num, ts: Date.now() };
    writeJSON(ODDS_HISTORY_KEY, all);

    return {
      opening: prior.opening,
      current: num,
      delta,
      direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    };
  }

  /* ---------------- results log ---------------- */
  function logIfCompleted(leagueId, game) {
    if (!game.completed) return;
    const log = readJSON(RESULTS_LOG_KEY, []);
    if (log.some((e) => e.id === game.id && e.leagueId === leagueId)) return; // already logged

    const history = readJSON(ODDS_HISTORY_KEY, {});
    const closing = history[game.id] ? history[game.id].current : null;

    log.unshift({
      id: game.id,
      leagueId,
      ts: Date.now(),
      away: { name: game.away.name, score: game.away.score, logo: game.away.logo || null, winner: game.away.winner },
      home: { name: game.home.name, score: game.home.score, logo: game.home.logo || null, winner: game.home.winner },
      closingLine: closing,
    });

    writeJSON(RESULTS_LOG_KEY, log.slice(0, MAX_LOG_ENTRIES));
  }
  function getLog() {
    return readJSON(RESULTS_LOG_KEY, []);
  }

  /* ---------------- settings ---------------- */
  const SETTINGS_KEY = "oi:settings";
  const DEFAULT_SETTINGS = { tickerEnabled: true, tickerSpeed: "normal" };

  function getSettings() {
    return { ...DEFAULT_SETTINGS, ...readJSON(SETTINGS_KEY, {}) };
  }
  function setSetting(key, value) {
    const s = getSettings();
    s[key] = value;
    writeJSON(SETTINGS_KEY, s);
    return s;
  }

  return {
    getWatchlist,
    isWatchlisted,
    toggleWatchlist,
    watchlistDisplayName,
    recordOdds,
    logIfCompleted,
    getLog,
    getSettings,
    setSetting,
  };
})();
