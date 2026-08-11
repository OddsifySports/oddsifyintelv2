/**
 * V2 bootstrap: drives v2's visual shell (header, clock, tabs, ticker)
 * using v1's data layer (Api, Render, Store).
 *
 * v1's app.js auto-builds its own tabs + panels in #league-tabs and
 * #board, which conflicts with v2's existing #tabbar / #view-* markup.
 * So v2 doesn't load v1's app.js — instead this file wires v2's panels
 * to v1's render functions.
 *
 * Weather + injuries read from the scoreboard payload first, only
 * fall back to per-game /summary if missing. This was the v1 weather
 * bug we fixed yesterday (ESPN started 404'ing /summary for live events).
 */
(async function () {
  const $ = (id) => document.getElementById(id);

  const tabsEl = $("tabbar");
  const tickerTrack = $("tickerTrack");
  const statusDot = $("statusDot");
  const statusText = $("statusText");
  const lastUpdatedEl = $("lastUpdated");
  const refreshBtn = $("refreshBtn");

  const leagueLabelById = Object.fromEntries(LEAGUES.map((l) => [l.id, l.label]));

  // Tabs are static in v2 — just wire up click handlers.
  let activeTab = "games";
  function selectTab(id) {
    activeTab = id;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
    document.querySelectorAll(".panel-view").forEach((p) => p.classList.toggle("active", p.id === `view-${id}`));
    if (id === "news" && !$("newsContainer").dataset.rendered) renderNews();
    if (id === "injuries" && !$("injuriesContainer").dataset.rendered) renderInjuries();
    if (id === "weather" && !$("weatherContainer").dataset.rendered) renderWeather();
  }
  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    selectTab(btn.dataset.tab);
  });

  function setStatus(state, text) {
    statusDot.className = `status-dot ${state || ""}`;
    statusText.textContent = text;
  }

  // ---------- clock (PHX, no DST) ----------
  function updateClock() {
    const now = new Date();
    const opts = { timeZone: "America/Phoenix", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true };
    const dateOpts = { timeZone: "America/Phoenix", weekday: "long", month: "long", day: "numeric", year: "numeric" };
    $("clockTime").textContent = now.toLocaleTimeString("en-US", opts);
    $("clockDate").textContent = now.toLocaleDateString("en-US", dateOpts);
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ---------- data layer ----------
  let lastResults = []; // [{league, games, scoreboardData}] — matches v1's shape
  const newsCache = new Map();
  const MAX_GAMES_PER_LEAGUE_FOR_DETAILS = 10;

  async function loadLeague(league) {
    const [scoreRes] = await Promise.all([Api.getScoreboard(league)]);
    return {
      league,
      games: scoreRes.ok ? (scoreRes.data.events || []).map(Render.normalizeEvent).filter(Boolean) : [],
      scoreboardData: scoreRes.ok ? scoreRes.data : null,
    };
  }

  function onWatchlistChange() {
    Render.buildTicker(tickerTrack, lastResults, true);
  }

  // Weather + Injuries: derive directly from scoreboard (no per-game fetch).
  // ESPN's /summary endpoint is slow + unreliable; the scoreboard payload
  // already has weather + injuries for nearly every outdoor game, so we
  // skip the fallback chain entirely.
  function gatherDetails(kind) {
    const dataByLeagueId = {};
    lastResults.forEach(({ league, scoreboardData }) => {
      const events = (scoreboardData && scoreboardData.events) || [];
      dataByLeagueId[league.id] = events.map((ev) => {
        const game = Render.normalizeEvent(ev);
        return {
          game,
          weather: kind === "weather" ? Render.extractWeather(ev) : null,
          injuries: kind === "injuries" ? Render.extractInjuries(ev) : [],
        };
      }).filter((e) => e.game);
    });
    return Promise.resolve(dataByLeagueId);
  }

  // ---------- panel renderers ----------
  function renderGames() {
    const container = $("gamesContainer");
    if (!container) return;
    container.innerHTML = "";
    lastResults.forEach(({ league, scoreboardData }) => {
      const events = (scoreboardData && scoreboardData.events) || [];
      if (!events.length) return;
      const section = document.createElement("div");
      section.className = "league-section";
      section.innerHTML = `
        <div class="league-section-head">
          <span class="league-badge"><span class="league-badge-label">${league.label}</span></span>
        </div>
        <div class="games-list" id="games-${league.id}-inline"></div>`;
      container.appendChild(section);
      Render.gameList($(`games-${league.id}-inline`), events, league, onWatchlistChange, openGameDetails);
    });
    if (!container.children.length) {
      container.innerHTML = `<div class="empty-note">No games scheduled today across the tracked leagues.</div>`;
    }
  }

  function renderLive() {
    const container = $("liveContainer");
    if (!container) return;
    container.innerHTML = "";
    const liveResults = lastResults
      .map(({ league, scoreboardData }) => {
        const events = ((scoreboardData && scoreboardData.events) || []).filter((e) => safe(() => e.status.type.state) === "in");
        return { league, events };
      })
      .filter((r) => r.events.length);
    if (!liveResults.length) {
      container.innerHTML = `<div class="live-empty"><div class="big">Nothing live right now</div>Check the Games tab for today's full schedule.</div>`;
      return;
    }
    liveResults.forEach(({ league, events }) => {
      const grid = document.createElement("div");
      grid.className = "games-list";
      container.appendChild(grid);
      Render.gameList(grid, events, league, onWatchlistChange, openGameDetails);
    });
  }

  function safe(fn, fallback) {
    try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; }
  }

  async function renderNews() {
    const container = $("newsContainer");
    if (!container) return;
    container.innerHTML = `<div class="empty-note">Loading headlines…</div>`;
    const newsByLeagueId = {};
    await Promise.all(
      LEAGUES.map(async (league) => {
        if (!newsCache.has(league.id)) newsCache.set(league.id, await Api.getNews(league));
        newsByLeagueId[league.id] = newsCache.get(league.id);
      })
    );
    Render.newsPage(container, LEAGUES, newsByLeagueId);
    container.dataset.rendered = "1";
  }

  async function renderInjuries() {
    const container = $("injuriesContainer");
    if (!container) return;
    container.innerHTML = `<div class="empty-note">Loading injury reports…</div>`;
    const dataByLeagueId = await gatherDetails("injuries");
    Render.injuriesPage(container, LEAGUES, dataByLeagueId);
    container.dataset.rendered = "1";
  }

  async function renderWeather() {
    const container = $("weatherContainer");
    if (!container) return;
    container.innerHTML = `<div class="empty-note">Loading weather for today's games…</div>`;
    try {
      const dataByLeagueId = await gatherDetails("weather");
      Render.weatherPage(container, LEAGUES, dataByLeagueId);
    } catch (e) {
      console.error("[Weather] renderWeather failed:", e);
      container.innerHTML = `<div class="empty-note">Couldn't load weather. Try refreshing.</div>`;
    }
    container.dataset.rendered = "1";
  }

  // ---------- game detail modal ----------
  const modalOverlay = $("modal-overlay");
  const modalBody = $("modal-body");
  const modalClose = $("modal-close");

  async function openGameDetails(game, league) {
    modalBody.innerHTML = `<p class="empty-note">Loading game details…</p>`;
    modalOverlay.hidden = false;
    document.body.style.overflow = "hidden";

    const [summaryRes, newsRes] = await Promise.all([
      Api.getSummary(league, game.id),
      newsCache.has(league.id) ? Promise.resolve(newsCache.get(league.id)) : Api.getNews(league),
    ]);
    if (!newsCache.has(league.id)) newsCache.set(league.id, newsRes);

    Render.gameDetailModal(modalBody, league, game, summaryRes, newsRes);
  }

  function closeGameDetails() {
    modalOverlay.hidden = true;
    document.body.style.overflow = "";
  }

  modalClose.addEventListener("click", closeGameDetails);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeGameDetails();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalOverlay.hidden) closeGameDetails();
  });

  // ---------- full refresh cycle ----------
  async function refreshAll(isManual) {
    refreshBtn.disabled = true;
    setStatus("", isManual ? "refreshing…" : "syncing…");
    try {
      lastResults = await Promise.all(LEAGUES.map(loadLeague));
      Render.buildTicker(tickerTrack, lastResults, true);
      renderGames();
      renderLive();
      // News/injuries/weather are lazy-rendered on tab click, but if user is
      // already on one of those tabs, refresh them now.
      if (activeTab === "news") renderNews();
      if (activeTab === "injuries") {
        $("injuriesContainer").dataset.rendered = "";
        renderInjuries();
      }
      if (activeTab === "weather") {
        $("weatherContainer").dataset.rendered = "";
        renderWeather();
      }

      const totalGames = lastResults.reduce((n, r) => n + r.games.length, 0);
      const failedCount = lastResults.filter((r) => r.games.length === 0).length;
      const anyLive = lastResults.some((r) => r.games.some((g) => g.state === "in"));
      if (failedCount === lastResults.length) {
        statusDot.className = "status-dot error";
        statusText.textContent = totalGames === 0 ? "no games on the slate" : "feed error — no data";
      } else {
        statusDot.className = "status-dot" + (anyLive ? " live" : "");
        statusText.textContent = anyLive ? "live games in progress" : "up to date";
      }
      lastUpdatedEl.textContent = `updated ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      setStatus("error", "feed error");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  refreshBtn.addEventListener("click", () => {
    Api.clearCache();
    refreshAll(true);
  });

  // ---------- SW registration (matches v1) ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  // ---------- kick off ----------
  refreshAll(false);
  setInterval(() => refreshAll(false), REFRESH_INTERVAL_MS);
})();