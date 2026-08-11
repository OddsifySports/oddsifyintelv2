/**
 * V2 bootstrap: drives v2's visual shell (header, clock, tabs, ticker, panels)
 * using v1's data layer (Api, Render, Store).
 */
(async function () {
  const $ = (id) => document.getElementById(id);
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDate(d, tz) {
    return d.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  function shortTz(tz) {
    if (!tz) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date());
      return (parts.find((p) => p.type === "timeZoneName") || {}).value || "";
    } catch { return ""; }
  }
  function safeState(ev) {
    try { return ev && ev.status && ev.status.type && ev.status.type.state; } catch { return null; }
  }
  function leagueLogoHtml(l) {
    return l.logo ? '<img class="league-chip-logo" src="' + escapeHtml(l.logo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : "";
  }

  const tabsEl = $("tabbar");
  const tickerTrack = $("tickerTrack");
  const statusDot = $("statusDot");
  const statusText = $("statusText");
  const lastUpdatedEl = $("lastUpdated");
  const refreshBtn = $("refreshBtn");
  const settingsBtn = $("settingsBtn");
  const clockPlace = $("clockPlace");
  const clockTimeEl = $("clockTime");
  const clockDateEl = $("clockDate");
  const leagueFilterEl = $("leagueFilter");
  const settingsOverlay = $("settings-overlay");
  const settingsClose = $("settings-close");
  const settingsDone = $("settings-done");
  const settingsTz = $("settings-tz");
  const settingsLocation = $("settings-location");
  const settingsLeagues = $("settings-leagues");
  const settingsAllBtn = $("settings-all");
  const settingsNoneBtn = $("settings-none");

  function updateClock() {
    const s = Store.getSettings();
    const tz = s.timezone || "America/Phoenix";
    const now = new Date();
    clockTimeEl.textContent = now.toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
    clockDateEl.textContent = fmtDate(now, tz);
    const abbrev = shortTz(tz);
    const loc = s.location || "Phoenix, AZ";
    clockPlace.textContent = abbrev ? loc + " · " + abbrev : loc;
  }
  updateClock();
  setInterval(updateClock, 1000);

  function enabledLeagues() {
    const s = Store.getSettings();
    const enabled = new Set(s.enabledLeagues || LEAGUES.map((l) => l.id));
    return LEAGUES.filter((l) => enabled.has(l.id));
  }

  function renderLeagueFilter() {
    const s = Store.getSettings();
    const enabled = new Set(s.enabledLeagues || LEAGUES.map((l) => l.id));
    leagueFilterEl.innerHTML = LEAGUES.map((l) => {
      const isOn = enabled.has(l.id);
      return '<button type="button" class="league-chip ' + (isOn ? "on" : "") + '" data-league="' + escapeHtml(l.id) + '" aria-pressed="' + isOn + '">' + leagueLogoHtml(l) + '<span>' + escapeHtml(l.label) + '</span></button>';
    }).join("");
  }
  leagueFilterEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".league-chip");
    if (!chip) return;
    Store.toggleLeague(chip.dataset.league);
    reRenderFromFilterChange();
  });

  let activeTab = "games";
  function selectTab(id) {
    activeTab = id;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
    document.querySelectorAll(".panel-view").forEach((p) => p.classList.toggle("active", p.id === "view-" + id));
    if (id === "news" && !$("newsContainer").dataset.rendered) renderNewsAndWeather();
    if (id === "injuries" && !$("injuriesContainer").dataset.rendered) renderInjuries();
  }
  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    selectTab(btn.dataset.tab);
  });

  function setStatus(state, text) {
    statusDot.className = "status-dot " + (state || "");
    statusText.textContent = text;
  }

  let lastResults = [];
  const newsCache = new Map();
  async function loadLeague(league) {
    const scoreRes = await Api.getScoreboard(league);
    return {
      league,
      games: scoreRes.ok ? (scoreRes.data.events || []).map(Render.normalizeEvent).filter(Boolean) : [],
      scoreboardData: scoreRes.ok ? scoreRes.data : null,
    };
  }
  function onWatchlistChange() { Render.buildTicker(tickerTrack, lastResults, true); }

  function renderGames() {
    const container = $("gamesContainer");
    if (!container) return;
    container.innerHTML = "";
    const filtered = enabledLeagues();
    if (!filtered.length) {
      container.innerHTML = '<div class="empty-note">All leagues disabled — open Settings to enable some.</div>';
      return;
    }
    let anyRendered = false;
    filtered.forEach((league) => {
      // enabledLeagues() returns bare LEAGUES entries (no scoreboardData);
      // join back to lastResults by id to get the events.
      const result = lastResults.find((r) => r.league.id === league.id);
      if (!result) return;
      const events = (result.scoreboardData && result.scoreboardData.events) || [];
      if (!events.length) return;
      anyRendered = true;
      const section = document.createElement("div");
      section.className = "league-section";
      section.innerHTML = '<div class="league-section-head"><span class="league-badge"><span class="league-badge-label">' + escapeHtml(league.label) + '</span></span></div><div class="games-list" id="games-' + league.id + '-inline"></div>';
      container.appendChild(section);
      Render.gameList($("games-" + league.id + "-inline"), events, league, onWatchlistChange, openGameDetails);
    });
    if (!anyRendered) container.innerHTML = '<div class="empty-note">No games scheduled today across your selected leagues.</div>';
  }

  function renderLive() {
    const container = $("liveContainer");
    if (!container) return;
    container.innerHTML = "";
    const filtered = enabledLeagues();
    const liveResults = filtered
      .map((league) => {
        const result = lastResults.find((r) => r.league.id === league.id);
        if (!result) return null;
        const events = ((result.scoreboardData && result.scoreboardData.events) || []).filter((e) => safeState(e) === "in");
        return { league, events };
      })
      .filter(Boolean)
      .filter((r) => r.events.length);
    if (!liveResults.length) {
      container.innerHTML = '<div class="live-empty"><div class="big">Nothing live right now</div>Check the Games tab for today\'s full schedule.</div>';
      return;
    }
    liveResults.forEach(({ league, events }) => {
      const grid = document.createElement("div");
      grid.className = "games-list";
      container.appendChild(grid);
      Render.gameList(grid, events, league, onWatchlistChange, openGameDetails);
    });
  }

  // ---------- News + Weather combined ("Around the Leagues") ----------
  async function renderNewsAndWeather() {
    const container = $("newsContainer");
    if (!container) return;
    container.innerHTML = '<div class="empty-note">Loading headlines and venue weather…</div>';
    const filtered = enabledLeagues();
    if (!filtered.length) {
      container.innerHTML = '<div class="empty-note">All leagues disabled — open Settings to enable some.</div>';
      container.dataset.rendered = "1";
      return;
    }
    const newsByLeague = {};
    await Promise.all(filtered.map(async (league) => {
      if (!newsCache.has(league.id)) newsCache.set(league.id, await Api.getNews(league));
      newsByLeague[league.id] = newsCache.get(league.id);
    }));
    const wxByLeague = {};
    lastResults.forEach(({ league, scoreboardData }) => {
      const events = (scoreboardData && scoreboardData.events) || [];
      const wx = [];
      events.forEach((ev) => {
        const w = Render.extractWeather(ev);
        if (w) wx.push(w);
      });
      wxByLeague[league.id] = wx.length ? wx[0] : null;
    });
    const grid = document.createElement("div");
    grid.className = "around-grid";
    filtered.forEach((league) => {
      const wx = wxByLeague[league.id];
      const newsRes = newsByLeague[league.id] || { ok: false };
      const newsItems = newsRes.ok && Array.isArray(newsRes.data.articles) ? newsRes.data.articles.slice(0, 5) : [];
      const wxPill = wx
        ? '<span class="weather-pill"><span class="wx-temp">' + escapeHtml(wx.temp || "") + '</span><span>' + escapeHtml(wx.detail || "") + '</span></span>'
        : '<span class="weather-pill none">dome / no wx</span>';
      const itemsHtml = newsItems.length
        ? newsItems.map((a) => {
            const url = (a.links && a.links.api && a.links.api.href) || (a.links && a.links.web && a.links.web.href) || "#";
            const src = (a.source && a.source.name) || "ESPN";
            const dateStr = a.published ? new Date(a.published).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
            return '<a class="news-item-large" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' +
              '<div class="headline">' + escapeHtml(a.headline || a.title || "Untitled") + '</div>' +
              '<div class="meta"><span class="src">' + escapeHtml(src) + '</span>' + (dateStr ? '<span>·</span><span>' + escapeHtml(dateStr) + '</span>' : '') + '</div>' +
              '</a>';
          }).join("")
        : '<div class="news-empty">No headlines on the wire right now.</div>';
      const logo = league.logo ? '<img src="' + escapeHtml(league.logo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : "";
      grid.insertAdjacentHTML("beforeend",
        '<div class="around-card">' +
          '<div class="around-head">' +
            '<span class="league-id">' + logo + '<span>' + escapeHtml(league.label) + '</span></span>' +
            wxPill +
          '</div>' +
          '<div class="around-body">' + itemsHtml + '</div>' +
        '</div>');
    });
    container.innerHTML = "";
    container.appendChild(grid);
    container.dataset.rendered = "1";
  }

  // ---------- Injuries (honest empty state + ESPN deep links) ----------
  async function renderInjuries() {
    const container = $("injuriesContainer");
    if (!container) return;
    container.innerHTML = '<div class="empty-note">Loading injury reports…</div>';
    const filtered = enabledLeagues();
    if (!filtered.length) {
      container.innerHTML = '<div class="empty-note">All leagues disabled — open Settings to enable some.</div>';
      container.dataset.rendered = "1";
      return;
    }
    const injByLeague = {};
    lastResults.forEach(({ league, scoreboardData }) => {
      const events = (scoreboardData && scoreboardData.events) || [];
      const total = [];
      events.forEach((ev) => {
        const items = Render.extractInjuries(ev);
        if (items && items.length) total.push(...items);
      });
      injByLeague[league.id] = total;
    });
    const hasAnyData = filtered.some((l) => (injByLeague[l.id] || []).length > 0);
    if (!hasAnyData) {
      const linksHtml = filtered.map((l) => {
        const url = "https://www.espn.com/" + l.sport + "/injuries";
        return '<a class="injury-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' +
          '<img src="' + escapeHtml(l.logo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
          '<span>' + escapeHtml(l.label) + ' injuries</span>' +
          '<span class="arrow">→</span>' +
          '</a>';
      }).join("");
      container.innerHTML =
        '<div class="injuries-empty">' +
          '<div class="big">No injuries in the live scoreboard feed</div>' +
          '<p>ESPN\'s public scoreboard payload doesn\'t include injury data for today\'s games. We use that endpoint because it\'s fast, free, and reliable. The deeper per-game /summary endpoint carries injuries but is slow + frequently 404s for live events.</p>' +
          '<p class="sub">For the full report, ESPN maintains dedicated injury pages for every league:</p>' +
          '<div class="injury-links">' + linksHtml + '</div>' +
        '</div>';
      container.dataset.rendered = "1";
      return;
    }
    const grid = document.createElement("div");
    filtered.forEach((league) => {
      const items = injByLeague[league.id] || [];
      if (!items.length) return;
      const section = document.createElement("div");
      section.className = "league-section";
      section.innerHTML = '<div class="league-section-head"><span class="league-badge"><span class="league-badge-label">' + escapeHtml(league.label) + '</span></span></div>';
      items.forEach((team) => {
        const block = document.createElement("div");
        block.className = "injury-game-card";
        block.innerHTML = '<div class="weather-card-matchup">' + escapeHtml(team.teamName || "Team") + '</div>';
        (team.items || []).forEach((p) => {
          block.insertAdjacentHTML("beforeend",
            '<div class="injury-row">' +
              '<span class="injury-name">' + escapeHtml(p.name) + '</span>' +
              '<span class="injury-status">' + escapeHtml(p.status || "—") + '</span>' +
              (p.detail ? '<div class="injury-detail">' + escapeHtml(p.detail) + '</div>' : '') +
            '</div>');
        });
        section.appendChild(block);
      });
      grid.appendChild(section);
    });
    container.innerHTML = "";
    container.appendChild(grid);
    container.dataset.rendered = "1";
  }

  // ---------- game detail modal ----------
  const modalOverlay = $("modal-overlay");
  const modalBody = $("modal-body");
  const modalClose = $("modal-close");
  async function openGameDetails(game, league) {
    modalBody.innerHTML = '<p class="empty-note">Loading game details…</p>';
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
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeGameDetails(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modalOverlay.hidden) closeGameDetails(); });

  // ---------- settings modal ----------
  function openSettings() {
    const s = Store.getSettings();
    settingsTz.innerHTML = "";
    Store.COMMON_TIMEZONES.forEach((tz) => {
      const opt = document.createElement("option");
      opt.value = tz;
      opt.textContent = tz + (tz === s.timezone ? "  (current)" : "");
      settingsTz.appendChild(opt);
    });
    settingsTz.value = s.timezone || "America/Phoenix";
    settingsLocation.value = s.location || "Phoenix, AZ";
    settingsLeagues.innerHTML = LEAGUES.map((l) => {
      const isOn = (s.enabledLeagues || LEAGUES.map((x) => x.id)).includes(l.id);
      const logo = l.logo ? '<img class="settings-league-logo" src="' + escapeHtml(l.logo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : "";
      return '<div role="button" tabindex="0" class="settings-league-toggle ' + (isOn ? "on" : "") + '" data-league="' + escapeHtml(l.id) + '" aria-pressed="' + isOn + '">' + logo + '<span>' + escapeHtml(l.label) + '</span></div>';
    }).join("");
    settingsOverlay.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeSettings() {
    settingsOverlay.hidden = true;
    document.body.style.overflow = "";
    updateClock();
    renderLeagueFilter();
  }
  settingsBtn.addEventListener("click", openSettings);
  settingsClose.addEventListener("click", closeSettings);
  settingsDone.addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) closeSettings(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !settingsOverlay.hidden) closeSettings(); });

  settingsTz.addEventListener("change", () => {
    Store.setSetting("timezone", settingsTz.value);
    updateClock();
  });
  settingsLocation.addEventListener("input", () => {
    Store.setSetting("location", settingsLocation.value);
    updateClock();
  });
  settingsLeagues.addEventListener("click", (e) => {
    const tog = e.target.closest(".settings-league-toggle");
    if (!tog) return;
    Store.toggleLeague(tog.dataset.league);
    reRenderFromFilterChange();
    openSettings(); // re-render the modal to reflect new state
  });
  settingsLeagues.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const tog = e.target.closest(".settings-league-toggle");
    if (!tog) return;
    e.preventDefault();
    Store.toggleLeague(tog.dataset.league);
    reRenderFromFilterChange();
    openSettings();
  });
  settingsAllBtn.addEventListener("click", () => {
    Store.setEnabledLeagues(LEAGUES.map((l) => l.id));
    reRenderFromFilterChange();
    openSettings();
  });
  settingsNoneBtn.addEventListener("click", () => {
    Store.setEnabledLeagues([]);
    reRenderFromFilterChange();
    openSettings();
  });

  // Re-render every panel that depends on the league filter.
  // Used by both the chip row (visible) and the settings modal (hidden).
  function reRenderFromFilterChange() {
    renderLeagueFilter();
    renderGames();
    renderLive();
    if (activeTab === "news") {
      $("newsContainer").dataset.rendered = "";
      renderNewsAndWeather();
    }
    if (activeTab === "injuries") {
      $("injuriesContainer").dataset.rendered = "";
      renderInjuries();
    }
    // Ticker only shows games for enabled leagues
    Render.buildTicker(tickerTrack, lastResults.filter((r) => Store.isLeagueEnabled(r.league.id)), true);
  }

  // ---------- full refresh cycle ----------
  async function refreshAll(isManual) {
    refreshBtn.disabled = true;
    setStatus("", isManual ? "refreshing…" : "syncing…");
    try {
      lastResults = await Promise.all(LEAGUES.map(loadLeague));
      // Refresh ticker so disabled leagues drop off
      Render.buildTicker(tickerTrack, enabledLeagues().map((league) => lastResults.find((r) => r.league.id === league.id)).filter(Boolean), true);
      renderGames();
      renderLive();
      if (activeTab === "news") { $("newsContainer").dataset.rendered = ""; renderNewsAndWeather(); }
      if (activeTab === "injuries") { $("injuriesContainer").dataset.rendered = ""; renderInjuries(); }

      const filtered = enabledLeagues();
      const totals = filtered.map((league) => lastResults.find((r) => r.league.id === league.id)).filter(Boolean);
      const totalGames = totals.reduce((n, r) => n + r.games.length, 0);
      const failedCount = totals.filter((r) => r.games.length === 0).length;
      const anyLive = totals.some((r) => r.games.some((g) => g.state === "in"));
      if (filtered.length === 0) {
        setStatus("", "no leagues selected");
      } else if (failedCount === totals.length) {
        statusDot.className = "status-dot error";
        statusText.textContent = totalGames === 0 ? "no games on the slate" : "feed error — no data";
      } else {
        statusDot.className = "status-dot" + (anyLive ? " live" : "");
        statusText.textContent = anyLive ? "live games in progress" : "up to date";
      }
      lastUpdatedEl.textContent = "updated " + new Date().toLocaleTimeString();
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

  // ---------- SW registration ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  // ---------- kick off ----------
  renderLeagueFilter();
  refreshAll(false);
  setInterval(() => refreshAll(false), REFRESH_INTERVAL_MS);
})();
