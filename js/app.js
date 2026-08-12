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
  const tickerWrap = tickerTrack ? tickerTrack.closest(".ticker-wrap") : null;
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
  const settingsTickerEl = $("settings-ticker");
  const tickerWrapRef = tickerWrap;

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

  // ---------- ticker speed ----------
  // Maps user-facing speed label → CSS animation duration. "off" freezes
  // the marquee entirely (no animation, no duplicate items needed).
  const TICKER_DURATIONS = {
    verySlow: "120s",
    slow: "75s",
    normal: "45s",
    fast: "20s",
  };
  const TICKER_LABELS = {
    verySlow: { title: "Very Slow", hint: "120s loop" },
    slow:      { title: "Slow",     hint: "75s loop" },
    normal:    { title: "Normal",   hint: "45s loop" },
    fast:      { title: "Fast",     hint: "20s loop" },
    off:       { title: "Off",      hint: "no scroll" },
  };
  function applyTickerSpeed() {
    const speed = Store.getSettings().tickerSpeed || "normal";
    if (!tickerWrapRef) return;
    if (speed === "off") {
      tickerWrapRef.classList.add("ticker-static");
      tickerWrapRef.style.removeProperty("--ticker-duration");
    } else {
      tickerWrapRef.classList.remove("ticker-static");
      tickerWrapRef.style.setProperty("--ticker-duration", TICKER_DURATIONS[speed] || TICKER_DURATIONS.normal);
    }
  }
  applyTickerSpeed();

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
    if (id === "news" && !$("newsContainer").dataset.rendered) renderNews();
    if (id === "weather" && !$("weatherContainer").dataset.rendered) renderWeather();
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
    // Mirror to footer status pill
    const fd = $("footerStatusDot");
    const ft = $("footerStatusText");
    if (fd) fd.className = "status-dot " + (state || "");
    if (ft) ft.textContent = text;
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

  // ---------- News (Around the Leagues cards, headlines only) ----------
  async function renderNews() {
    const container = $("newsContainer");
    if (!container) return;
    container.innerHTML = '<div class="empty-note">Loading headlines…</div>';
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
    const grid = document.createElement("div");
    grid.className = "around-grid";
    filtered.forEach((league) => {
      const newsRes = newsByLeague[league.id] || { ok: false };
      const newsItems = newsRes.ok && Array.isArray(newsRes.data.articles) ? newsRes.data.articles.slice(0, 5) : [];
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
          '</div>' +
          '<div class="around-body">' + itemsHtml + '</div>' +
        '</div>');
    });
    container.innerHTML = "";
    container.appendChild(grid);
    container.dataset.rendered = "1";
  }

  // ---------- Weather (UX-enhanced venue cards with site-wide summary) ----------
  // Maps ESPN conditionId keywords → unicode glyph + CSS class for tinting.
  function wxIcon(conditionId) {
    const s = String(conditionId || "").toLowerCase();
    if (s.includes("clear") || s.includes("sunny")) return { glyph: "☀️", cls: "wx-clear" };
    if (s.includes("partly")) return { glyph: "⛅", cls: "wx-partly" };
    if (s.includes("cloud") && s.includes("most")) return { glyph: "☁️", cls: "wx-mostly" };
    if (s.includes("cloud")) return { glyph: "☁️", cls: "wx-cloud" };
    if (s.includes("rain") || s.includes("shower")) return { glyph: "🌧️", cls: "wx-rain" };
    if (s.includes("thunder") || s.includes("storm")) return { glyph: "⛈️", cls: "wx-storm" };
    if (s.includes("snow") || s.includes("flurr")) return { glyph: "🌨️", cls: "wx-snow" };
    if (s.includes("fog") || s.includes("haze") || s.includes("mist")) return { glyph: "🌫️", cls: "wx-fog" };
    if (s.includes("wind")) return { glyph: "💨", cls: "wx-wind" };
    return { glyph: "🌤️", cls: "wx-mild" };
  }
  function bandFromTemp(tempStr) {
    const n = parseInt(String(tempStr).replace(/[^\d-]/g, ""), 10);
    if (Number.isNaN(n)) return "mild";
    if (n >= 85) return "hot";
    if (n >= 70) return "mild";
    return "cool";
  }

  function renderWeather() {
    const container = $("weatherContainer");
    if (!container) return;
    container.innerHTML = '<div class="empty-note">Loading venue weather…</div>';
    const filtered = enabledLeagues();
    if (!filtered.length) {
      container.innerHTML = '<div class="empty-note">All leagues disabled — open Settings to enable some.</div>';
      container.dataset.rendered = "1";
      return;
    }
    const sections = [];
    const allVenues = [];
    filtered.forEach((league) => {
      const result = lastResults.find((r) => r.league.id === league.id);
      if (!result) return;
      const events = (result.scoreboardData && result.scoreboardData.events) || [];
      const venues = [];
      events.forEach((ev) => {
        const w = Render.extractWeather(ev);
        const c = (ev.competitions && ev.competitions[0]) || {};
        const venueName = (c.venue && c.venue.fullName) || "";
        const venueId = (c.venue && c.venue.id) || null;
        // Some games have no weather data yet (dome venues, far-future games,
        // or temporary venues like Sutter Health Park that ESPN doesn't track
        // weather for). Still show them so the venue count matches the game
        // count — render a "no weather" placeholder with the venue + matchup.
        const isNoWx = !w && !!venueId;
        const wx = w || (isNoWx ? { temp: "—", detail: "No weather data", glyph: "—", cls: "wx-indoor" } : null);
        if (!w && !isNoWx) return; // skip events with neither weather nor venue
        const v = {
          wx,
          matchup: ev.shortName || ev.name || "",
          venue: venueName,
          startTime: ev.date || "",
          eventId: ev.id,
        };
        venues.push(v);
        allVenues.push(v);
      });
      if (venues.length) {
        venues.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
        sections.push({ league, venues });
      }
    });
    if (!sections.length) {
      container.innerHTML =
        '<div class="weather-empty-hero">' +
          '<div class="weather-empty-glyph">☁️</div>' +
          '<div class="big">No outdoor games with weather data today</div>' +
          '<p>Today\'s slate is all dome / indoor games. Check back tomorrow — outdoor sports return when the leagues restart outdoor play.</p>' +
        '</div>';
      container.dataset.rendered = "1";
      return;
    }
    // Site-wide summary
    const outdoorVenues = allVenues.filter((v) => v.wx.cls !== "wx-indoor");
    const indoorCount = allVenues.length - outdoorVenues.length;
    const temps = outdoorVenues.map((v) => parseInt(String(v.wx.temp).replace(/[^\d-]/g, ""), 10)).filter((n) => !Number.isNaN(n));
    const avgTemp = temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null;
    const maxTemp = temps.length ? Math.max.apply(null, temps) : null;
    const minTemp = temps.length ? Math.min.apply(null, temps) : null;
    const conditionCounts = {};
    outdoorVenues.forEach((v) => {
      const key = String(v.wx.detail || "Unknown").replace(/\s*gusts.*$/i, "").trim();
      conditionCounts[key] = (conditionCounts[key] || 0) + 1;
    });
    const topCondition = Object.entries(conditionCounts).sort((a, b) => b[1] - a[1])[0];
    const venueLabel = outdoorVenues.length === 1 ? "Outdoor Venue" : "Outdoor Venues";
    const summaryHtml =
      '<div class="weather-summary">' +
        '<div class="ws-stat"><span class="ws-num">' + outdoorVenues.length + '</span><span class="ws-label">' + venueLabel + '</span></div>' +
        (indoorCount ? '<div class="ws-sep"></div><div class="ws-stat"><span class="ws-num">' + indoorCount + '</span><span class="ws-label">No wx</span></div>' : '') +
        '<div class="ws-sep"></div>' +
        (avgTemp !== null ? '<div class="ws-stat"><span class="ws-num">' + avgTemp + '°F</span><span class="ws-label">Avg Temp</span></div><div class="ws-sep"></div>' : '') +
        (maxTemp !== null ? '<div class="ws-stat"><span class="ws-num">' + maxTemp + '°F</span><span class="ws-label">High</span></div><div class="ws-sep"></div>' : '') +
        (minTemp !== null ? '<div class="ws-stat"><span class="ws-num">' + minTemp + '°F</span><span class="ws-label">Low</span></div><div class="ws-sep"></div>' : '') +
        (topCondition ? '<div class="ws-stat"><span class="ws-num wx-cond">' + wxIcon(topCondition[0]).glyph + '</span><span class="ws-label">' + escapeHtml(topCondition[0]) + '</span></div>' : '') +
      '</div>';

    const grid = document.createElement("div");
    grid.className = "around-grid";
    sections.forEach(({ league, venues }) => {
      const logo = league.logo ? '<img src="' + escapeHtml(league.logo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : "";
      const lOutdoor = venues.filter((v) => v.wx.cls !== "wx-indoor");
      const lTemps = lOutdoor.map((v) => parseInt(String(v.wx.temp).replace(/[^\d-]/g, ""), 10)).filter((n) => !Number.isNaN(n));
      const lAvg = lOutdoor.length ? Math.round(lTemps.reduce((a, b) => a + b, 0) / lOutdoor.length) : null;
      const leagueStat = lAvg !== null
        ? '<span class="weather-league-avg">' + lAvg + '°F avg · ' + venues.length + ' game' + (venues.length === 1 ? "" : "s") + '</span>'
        : '<span class="weather-league-avg">' + venues.length + ' game' + (venues.length === 1 ? "" : "s") + '</span>';
      const venueCards = venues.map((v) => {
        const isNoWx = v.wx.cls === "wx-indoor";
        const icon = isNoWx ? { glyph: "—", cls: "wx-indoor" } : wxIcon(v.wx.detail);
        const band = isNoWx ? "" : "band-" + bandFromTemp(v.wx.temp);
        const time = v.startTime ? new Date(v.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";
        const dateStr = v.startTime ? new Date(v.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
        return '<div class="weather-venue-card ' + band + ' ' + icon.cls + '">' +
          '<div class="wx-row-top">' +
            '<span class="wx-glyph">' + icon.glyph + '</span>' +
            '<span class="wx-temp-lg">' + escapeHtml(v.wx.temp || "—") + '</span>' +
          '</div>' +
          '<div class="wx-condition">' + escapeHtml(v.wx.detail || "conditions at kickoff") + '</div>' +
          '<div class="wx-matchup">' + escapeHtml(v.matchup) + '</div>' +
          (v.venue ? '<div class="wx-venue">📍 ' + escapeHtml(v.venue) + '</div>' : "") +
          (time ? '<div class="wx-time"><span class="wx-time-icon">🕐</span> ' + escapeHtml(time) + (dateStr ? " · " + escapeHtml(dateStr) : "") + '</div>' : "") +
        '</div>';
      }).join("");
      grid.insertAdjacentHTML("beforeend",
        '<div class="around-card weather-league-card">' +
          '<div class="around-head">' +
            '<span class="league-id">' + logo + '<span>' + escapeHtml(league.label) + '</span></span>' +
            '<span class="weather-league-stat">' + leagueStat + '</span>' +
          '</div>' +
          '<div class="around-body weather-venue-grid">' + venueCards + '</div>' +
        '</div>');
    });
    container.innerHTML = "";
    container.insertAdjacentHTML("beforeend", summaryHtml);
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
    // Render ticker-speed radios
    settingsTickerEl.innerHTML = Store.TICKER_SPEEDS.map((sp) => {
      const isOn = (s.tickerSpeed || "normal") === sp;
      const meta = TICKER_LABELS[sp];
      return '<button type="button" role="radio" class="settings-ticker-option ' + (isOn ? "on" : "") + '" data-speed="' + sp + '" aria-checked="' + isOn + '" tabindex="' + (isOn ? "0" : "-1") + '">' +
        '<span class="speed-title">' + escapeHtml(meta.title) + '</span>' +
        '<span class="speed-hint">' + escapeHtml(meta.hint) + '</span>' +
      '</button>';
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
  // Footer-mirrored settings button
  const footerSettingsBtn = $("footerSettingsBtn");
  if (footerSettingsBtn) footerSettingsBtn.addEventListener("click", openSettings);
  // Footer year + tab-jump shortcuts
  const copyYearEl = $("copyYear");
  if (copyYearEl) copyYearEl.textContent = String(new Date().getFullYear());
  document.querySelectorAll(".sf-link[data-jump]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      selectTab(a.dataset.jump);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !settingsOverlay.hidden) closeSettings(); });

  settingsTz.addEventListener("change", () => {
    Store.setSetting("timezone", settingsTz.value);
    updateClock();
  });
  settingsLocation.addEventListener("input", () => {
    Store.setSetting("location", settingsLocation.value);
    updateClock();
  });
  settingsTickerEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".settings-ticker-option");
    if (!btn) return;
    const speed = btn.dataset.speed;
    Store.setSetting("tickerSpeed", speed);
    applyTickerSpeed();
    // Update only the radio button states in-place (don't re-render whole modal)
    Array.from(settingsTickerEl.children).forEach((c) => {
      const isOn = c.dataset.speed === speed;
      c.classList.toggle("on", isOn);
      c.setAttribute("aria-checked", String(isOn));
      c.setAttribute("tabindex", isOn ? "0" : "-1");
    });
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
      renderNews();
    }
    if (activeTab === "weather") {
      $("weatherContainer").dataset.rendered = "";
      renderWeather();
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
      if (activeTab === "news") { $("newsContainer").dataset.rendered = ""; renderNews(); }
      if (activeTab === "weather") { $("weatherContainer").dataset.rendered = ""; renderWeather(); }
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
