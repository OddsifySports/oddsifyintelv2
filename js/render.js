/**
 * Pure-ish rendering helpers. Nothing here fetches; everything here
 * takes already-fetched ESPN JSON and returns DOM nodes or strings.
 * ESPN's undocumented feed shape varies a little by sport, so every
 * accessor below is defensive and falls back to "—" rather than throwing.
 */
const Render = (() => {

  function safe(fn, fallback = null) {
    try { return fn(); } catch { return fallback; }
  }

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  /* ---------- normalize a single ESPN scoreboard "event" ---------- */
  function normalizeEvent(event) {
    const comp = safe(() => event.competitions[0]);
    if (!comp) return null;

    const competitors = comp.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
    const away = competitors.find((c) => c.homeAway === "away") || competitors[1];

    const state = safe(() => event.status.type.state, "pre"); // pre | in | post
    const detail = safe(() => event.status.type.shortDetail, "");
    const completed = safe(() => event.status.type.completed, false);

    let oddsText = null;
    let overUnder = null;
    const oddsBlock = safe(() => comp.odds && comp.odds[0]);
    if (oddsBlock) {
      oddsText = oddsBlock.details || null;
      overUnder = oddsBlock.overUnder || null;
    }

    const venueName = safe(() => comp.venue.fullName, null);
    const venueCity = safe(() => comp.venue.address.city, null);
    const broadcast = safe(
      () => comp.broadcasts[0].names.join("/"),
      safe(() => comp.broadcast, null)
    );

    const team = (c) => ({
      name: safe(() => c.team.displayName, safe(() => c.team.name, "TBD")),
      abbr: safe(() => c.team.abbreviation, ""),
      logo: safe(() => c.team.logo, safe(() => c.team.logos[0].href, null)),
      score: c && c.score !== undefined ? c.score : null,
      winner: !!c.winner,
    });

    return {
      id: event.id,
      state,
      detail,
      completed,
      home: team(home || {}),
      away: team(away || {}),
      oddsText,
      overUnder,
      venueName,
      venueCity,
      broadcast,
    };
  }

  /* ---------- ticker ---------- */
  function tickerItemHTML(leagueLabel, game, isPinned) {
    if (!game) return "";
    const scoreStr =
      game.home.score !== null && game.away.score !== null
        ? `<span class="sc">${game.away.abbr || game.away.name} ${game.away.score} — ${game.home.abbr || game.home.name} ${game.home.score}</span>`
        : `<span class="sc">${game.away.abbr || game.away.name} @ ${game.home.abbr || game.home.name}</span>`;
    const liveFlag = game.state === "in" ? `<span class="live-flag">● LIVE</span>` : "";
    const oddsFlag = game.oddsText ? `<span class="odds-flag">${game.oddsText}</span>` : "";
    const pinFlag = isPinned ? `<span class="pin-flag">★</span>` : "";
    return `<span class="ticker-item${isPinned ? " pinned" : ""}">${pinFlag}<span class="lg">${leagueLabel}</span>${scoreStr}${liveFlag}${oddsFlag}</span>`;
  }

  function buildTicker(track, resultsByLeague, scrollEnabled) {
    const pinned = [];
    const rest = [];
    for (const { league, games } of resultsByLeague) {
      if (!games || !games.length) continue;
      games.forEach((g) => {
        const isPinned = Store.isWatchlisted(league.id, g.home.abbr) || Store.isWatchlisted(league.id, g.away.abbr);
        const html = tickerItemHTML(league.label, g, isPinned);
        if (!html) return;
        (isPinned ? pinned : rest).push(html);
      });
    }
    const parts = [...pinned, ...rest.slice(0, 40)];
    if (!parts.length) {
      track.innerHTML = `<span class="ticker-item ticker-loading">No games on the board right now — check back soon.</span>`;
      return;
    }
    // duplicate the sequence so the CSS -50% loop is seamless — but only
    // when actually scrolling, or a static/paused view would show every
    // item twice for no reason.
    track.innerHTML = scrollEnabled ? parts.join("") + parts.join("") : parts.join("");
  }

  /* ---------- game cards ---------- */
  function starButton(leagueId, team, onToggle) {
    const btn = el("button", "star-btn");
    btn.type = "button";
    const pinned = Store.isWatchlisted(leagueId, team.abbr);
    btn.textContent = pinned ? "★" : "☆";
    btn.classList.toggle("pinned", pinned);
    btn.setAttribute("aria-label", `${pinned ? "Remove" : "Add"} ${team.name} ${pinned ? "from" : "to"} watchlist`);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const nowPinned = Store.toggleWatchlist(leagueId, team.abbr, team.name);
      btn.textContent = nowPinned ? "★" : "☆";
      btn.classList.toggle("pinned", nowPinned);
      if (onToggle) onToggle();
    });
    return btn;
  }

  function movementBadge(movement) {
    if (!movement || movement.direction === null || movement.delta === 0) return "";
    const arrow = movement.direction === "up" ? "▲" : "▼";
    const cls = movement.direction === "up" ? "up" : "down";
    return `<span class="movement ${cls}">${arrow} ${Math.abs(movement.delta)} <span class="was">(open ${movement.opening > 0 ? "+" : ""}${movement.opening})</span></span>`;
  }

  function teamLogoImg(t) {
    if (!t.logo) return "";
    return `<img class="team-logo" src="${t.logo}" alt="" loading="lazy" onerror="this.style.display='none'">`;
  }

  function leagueBadge(league) {
    const logoImg = league.logo
      ? `<img class="league-badge-logo" src="${league.logo}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : "";
    return `<div class="league-badge">${logoImg}<span>${league.label}</span></div>`;
  }

  function gameCard(game, league, onWatchlistChange, onOpenDetails) {
    const card = el("div", "game-card");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open details for ${game.away.name} at ${game.home.name}`);
    if (Store.isWatchlisted(league.id, game.home.abbr) || Store.isWatchlisted(league.id, game.away.abbr)) {
      card.classList.add("is-pinned");
    }
    if (onOpenDetails) {
      card.classList.add("clickable");
      card.addEventListener("click", () => onOpenDetails(game, league));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetails(game, league);
        }
      });
    }

    card.insertAdjacentHTML("beforeend", leagueBadge(league));

    const row = el("div", "game-row");
    const teams = el("div", "game-teams");

    [game.away, game.home].forEach((t) => {
      const line = el(
        "div",
        `team-line ${game.completed ? (t.winner ? "winner" : "loser") : ""}`
      );
      line.appendChild(starButton(league.id, t, onWatchlistChange));
      line.insertAdjacentHTML("beforeend", teamLogoImg(t));
      line.appendChild(el("span", "team-name", t.name));
      line.appendChild(el("span", "team-score", t.score ?? ""));
      teams.appendChild(line);
    });
    row.appendChild(teams);

    const meta = el("div", "game-meta");
    if (game.state === "in") {
      meta.innerHTML = `<span class="live">● ${game.detail || "LIVE"}</span>`;
    } else {
      meta.textContent = game.detail || "";
    }
    row.appendChild(meta);
    card.appendChild(row);

    // venue / broadcast context chip
    if (game.venueName || game.broadcast) {
      const ctx = el("div", "game-context");
      const bits = [];
      if (game.venueName) bits.push(`${game.venueName}${game.venueCity ? ` · ${game.venueCity}` : ""}`);
      if (game.broadcast) bits.push(`📺 ${game.broadcast}`);
      ctx.textContent = bits.join("  ·  ");
      card.appendChild(ctx);
    }

    if (league.hasOdds) {
      const movement = Store.recordOdds(game.id, game.oddsText);
      const odds = el("div", "game-odds");
      if (game.oddsText || game.overUnder) {
        if (game.oddsText) odds.appendChild(el("span", null, `Line: ${game.oddsText}`));
        if (game.overUnder) odds.appendChild(el("span", null, `O/U: ${game.overUnder}`));
        const badgeHTML = movementBadge(movement);
        if (badgeHTML) odds.insertAdjacentHTML("beforeend", badgeHTML);
      } else {
        odds.appendChild(el("span", "no-odds", "Odds not yet posted"));
      }
      card.appendChild(odds);
    }

    Store.logIfCompleted(league.id, game);

    return card;
  }

  function gameList(container, events, league, onWatchlistChange, onOpenDetails) {
    container.innerHTML = "";
    const games = (events || []).map(normalizeEvent).filter(Boolean);
    if (!games.length) {
      container.appendChild(el("div", "empty-note", "No games scheduled in the current window."));
      return;
    }
    // pinned teams first, then live, then upcoming, then finished
    const rank = (g) => (g.state === "in" ? 0 : g.state === "pre" ? 1 : 2);
    games.sort((a, b) => {
      const aPinned = Store.isWatchlisted(league.id, a.home.abbr) || Store.isWatchlisted(league.id, a.away.abbr);
      const bPinned = Store.isWatchlisted(league.id, b.home.abbr) || Store.isWatchlisted(league.id, b.away.abbr);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return rank(a) - rank(b);
    });
    games.forEach((g) => container.appendChild(gameCard(g, league, onWatchlistChange, onOpenDetails)));
  }

  /* ---------- watchlist tab ---------- */
  function watchlistPanel(container, resultsByLeague, onWatchlistChange, onOpenDetails) {
    container.innerHTML = "";
    const pins = Store.getWatchlist(); // "leagueId:abbr"
    if (!pins.length) {
      container.appendChild(
        el("div", "empty-note", "No teams pinned yet — click the ☆ next to any team to add it here.")
      );
      return;
    }
    const matches = [];
    resultsByLeague.forEach(({ league, games }) => {
      (games || []).forEach((g) => {
        const key = (abbr) => `${league.id}:${abbr}`;
        if (pins.includes(key(g.home.abbr)) || pins.includes(key(g.away.abbr))) {
          matches.push({ game: g, league });
        }
      });
    });
    if (!matches.length) {
      container.appendChild(el("div", "empty-note", "Your pinned teams have no games in the current window."));
      return;
    }
    matches.forEach(({ game, league }) => container.appendChild(gameCard(game, league, onWatchlistChange, onOpenDetails)));
  }

  /* ---------- history tab ---------- */
  function teamCellText(t) {
    if (typeof t === "string") return t; // legacy entries logged before structured team data
    return `${t.name}${t.score !== null && t.score !== undefined ? ` ${t.score}` : ""}`;
  }

  function historyPanel(container, leagueLabelById) {
    container.innerHTML = "";
    const log = Store.getLog();
    if (!log.length) {
      container.appendChild(
        el("div", "empty-note", "No completed games logged yet — this fills in as games finish while the dashboard is open.")
      );
      return;
    }
    const table = el("table", "standings-table");
    table.appendChild(
      el("thead", null, `<tr><th>League</th><th>Matchup</th><th>Closing line</th><th>Logged</th></tr>`)
    );
    const tbody = el("tbody");
    log.forEach((entry) => {
      const when = new Date(entry.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      tbody.appendChild(
        el(
          "tr",
          null,
          `<td>${leagueLabelById[entry.leagueId] || entry.leagueId}</td><td>${teamCellText(entry.away)} vs ${teamCellText(entry.home)}</td><td>${entry.closingLine ?? "—"}</td><td>${when}</td>`
        )
      );
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  /* ---------- standings ---------- */
  function statValue(entry, names) {
    const stats = safe(() => entry.stats, []);
    for (const n of names) {
      const hit = stats.find(
        (s) => s.name === n || s.shortDisplayName === n || s.abbreviation === n
      );
      if (hit) return hit.displayValue ?? hit.value ?? "—";
    }
    return "—";
  }

  function collectGroups(node, groups, nameStack) {
    if (!node) return;
    const entries = safe(() => node.standings.entries);
    if (entries && entries.length) {
      groups.push({ name: nameStack.filter(Boolean).join(" — ") || "Standings", entries });
    }
    const children = node.children;
    if (Array.isArray(children)) {
      children.forEach((child) => collectGroups(child, groups, [...nameStack, child.name]));
    }
  }

  function standingsTable(container, standingsData) {
    container.innerHTML = "";
    const root = safe(() => standingsData.children ? standingsData : { children: [standingsData] });
    const groups = [];
    collectGroups(root, groups, []);

    if (!groups.length) {
      container.appendChild(el("div", "empty-note", "Standings feed didn't return a table for this league yet."));
      return;
    }

    const table = el("table", "standings-table");
    const thead = el(
      "thead",
      null,
      `<tr><th></th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">Pts / Pct</th></tr>`
    );
    table.appendChild(thead);
    const tbody = el("tbody");

    groups.forEach((group) => {
      if (groups.length > 1) {
        const groupRow = el("tr", "grp-row", `<td colspan="6">${group.name}</td>`);
        tbody.appendChild(groupRow);
      }
      group.entries.forEach((entry, i) => {
        const name = safe(() => entry.team.displayName, safe(() => entry.team.shortDisplayName, "—"));
        const w = statValue(entry, ["wins"]);
        const l = statValue(entry, ["losses"]);
        const t = statValue(entry, ["ties", "draws"]);
        const pts = statValue(entry, ["points", "winPercent"]);
        const row = el(
          "tr",
          null,
          `<td class="rank">${i + 1}</td><td>${name}</td><td class="num">${w}</td><td class="num">${l}</td><td class="num">${t}</td><td class="num">${pts}</td>`
        );
        tbody.appendChild(row);
      });
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  /* ---------- game detail modal ---------- */
  function extractWeather(summaryData) {
    const w = safe(() => summaryData.weather);
    if (!w || (w.temperature === undefined && !w.displayValue)) return null;
    const temp = w.temperature !== undefined ? `${w.temperature}°F` : w.displayValue;
    const bits = [];
    // ESPN's weather object has BOTH a temperature (numeric, e.g. 76) AND a
    // displayValue (which on the scoreboard endpoint is a numeric wind-speed
    // or similar metric, NOT a description). Use conditionId as the human
    // description. If neither is present, fall back to a generic note.
    if (w.conditionId && typeof w.conditionId === "string") bits.push(w.conditionId);
    if (w.gust) bits.push(`gusts ${w.gust}mph`);
    return { temp, detail: bits.join(" · ") || "conditions at kickoff" };
  }

  function weatherSection(summaryData) {
    const w = extractWeather(summaryData);
    if (!w) return "";
    return `
      <div class="modal-section">
        <p class="modal-section-title">Weather at the venue</p>
        <div class="weather-row">
          <span class="weather-temp">${w.temp}</span>
          <span class="weather-detail">${w.detail}</span>
        </div>
      </div>
    `;
  }

  function injuryStatusClass(status) {
    return (status || "").toLowerCase().replace(/\s+/g, "-");
  }

  function extractInjuries(summaryData) {
    const teams = safe(() => summaryData.injuries, []) || [];
    return teams
      .filter((t) => safe(() => t.injuries.length, 0) > 0)
      .map((t) => ({
        teamName: safe(() => t.team.displayName, "Team"),
        items: t.injuries.map((inj) => ({
          name: safe(() => inj.athlete.displayName, "Player"),
          status: safe(() => inj.status, "—"),
          detail: safe(() => inj.details.detail, safe(() => inj.shortComment, "")),
        })),
      }));
  }

  function injuriesSection(summaryData) {
    const withEntries = extractInjuries(summaryData);
    if (!withEntries.length) {
      return `
        <div class="modal-section">
          <p class="modal-section-title">Injuries</p>
          <p class="empty-note">No injuries reported on this feed for either team.</p>
        </div>
      `;
    }
    const body = withEntries
      .map((t) => {
        const rows = t.items
          .map(
            (inj) =>
              `<div class="injury-row"><span>${inj.name}${inj.detail ? ` <span class="dim">— ${inj.detail}</span>` : ""}</span><span class="injury-status ${injuryStatusClass(inj.status)}">${inj.status}</span></div>`
          )
          .join("");
        return `<p class="injury-team-name">${t.teamName}</p>${rows}`;
      })
      .join("");
    return `<div class="modal-section"><p class="modal-section-title">Injuries</p>${body}</div>`;
  }

  function newsSection(newsData, game) {
    const articles = safe(() => newsData.articles, []);
    if (!articles.length) {
      return `
        <div class="modal-section">
          <p class="modal-section-title">Related news</p>
          <p class="empty-note">No league news available right now.</p>
        </div>
      `;
    }
    const needles = [game.home.name, game.away.name, game.home.abbr, game.away.abbr]
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    const matches = articles.filter((a) => {
      const text = `${a.headline || ""} ${a.description || ""}`.toLowerCase();
      return needles.some((n) => n && text.includes(n));
    });
    const shown = (matches.length ? matches : articles).slice(0, 4);
    const relevanceNote = matches.length
      ? ""
      : `<p class="empty-note">Nothing team-specific yet — showing recent league headlines instead.</p>`;
    const items = shown
      .map((a) => {
        const href = safe(() => a.links.web.href, "#");
        const when = a.published ? new Date(a.published).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
        return `<a class="news-item" href="${href}" target="_blank" rel="noopener">
          <div class="news-headline">${a.headline || "Untitled"}</div>
          <div class="news-meta">${when}</div>
        </a>`;
      })
      .join("");
    return `<div class="modal-section"><p class="modal-section-title">Related news</p>${relevanceNote}${items}</div>`;
  }

  function gameDetailModal(container, league, game, summaryRes, newsRes) {
    const scoreLine =
      game.home.score !== null
        ? `${game.away.name} ${game.away.score} — ${game.home.name} ${game.home.score}`
        : `${game.away.name} at ${game.home.name}`;
    const venueLine = [game.venueName, game.venueCity].filter(Boolean).join(" · ");

    let html = `
      <div class="modal-title-row" id="modal-title">${scoreLine}</div>
      <div class="modal-subtitle">${league.label}${game.detail ? ` · ${game.detail}` : ""}${venueLine ? ` · ${venueLine}` : ""}${game.broadcast ? ` · 📺 ${game.broadcast}` : ""}</div>
    `;

    if (summaryRes && summaryRes.ok) {
      html += weatherSection(summaryRes.data);
      html += injuriesSection(summaryRes.data);
    } else {
      html += `<div class="modal-section"><p class="modal-section-title">Weather &amp; injuries</p><p class="empty-note">Couldn't load extended details for this game${summaryRes ? ` (${summaryRes.error})` : ""}.</p></div>`;
    }

    if (newsRes && newsRes.ok) {
      html += newsSection(newsRes.data, game);
    } else {
      html += `<div class="modal-section"><p class="modal-section-title">Related news</p><p class="empty-note">Couldn't load news right now.</p></div>`;
    }

    container.innerHTML = html;
  }

  /* ---------- weather / injuries / news pages (grouped by league) ---------- */
  function leagueSectionHeader(league) {
    const logo = league.logo
      ? `<img class="league-badge-logo" src="${league.logo}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : "";
    return `<div class="league-section-head">${logo}<span>${league.label}</span></div>`;
  }

  function weatherPage(container, leagues, dataByLeagueId) {
    container.innerHTML = "";
    leagues.forEach((league) => {
      const entries = dataByLeagueId[league.id] || [];
      const section = el("div", "league-section");
      section.insertAdjacentHTML("beforeend", leagueSectionHeader(league));

      const withWeather = entries.filter((e) => e.weather);
      if (!entries.length) {
        section.appendChild(el("div", "empty-note", "No games today."));
      } else if (!withWeather.length) {
        section.appendChild(el("div", "empty-note", "No outdoor weather data for today's games (indoor venue, or not published yet)."));
      } else {
        const grid = el("div", "weather-grid");
        withWeather.forEach(({ game, weather }) => {
          grid.appendChild(
            el(
              "div",
              "weather-card",
              `<div class="weather-card-matchup">${game.away.name} @ ${game.home.name}</div>
               <div class="weather-row"><span class="weather-temp">${weather.temp}</span><span class="weather-detail">${weather.detail}</span></div>`
            )
          );
        });
        section.appendChild(grid);
      }
      container.appendChild(section);
    });
  }

  function injuriesPage(container, leagues, dataByLeagueId) {
    container.innerHTML = "";
    leagues.forEach((league) => {
      const entries = dataByLeagueId[league.id] || [];
      const section = el("div", "league-section");
      section.insertAdjacentHTML("beforeend", leagueSectionHeader(league));

      const withInjuries = entries.filter((e) => e.injuries && e.injuries.length);
      if (!entries.length) {
        section.appendChild(el("div", "empty-note", "No games today."));
      } else if (!withInjuries.length) {
        section.appendChild(el("div", "empty-note", "No injuries reported for today's games on this feed."));
      } else {
        withInjuries.forEach(({ game, injuries }) => {
          const card = el("div", "injury-game-card");
          card.insertAdjacentHTML(
            "beforeend",
            `<div class="weather-card-matchup">${game.away.name} @ ${game.home.name}</div>`
          );
          injuries.forEach((t) => {
            const rows = t.items
              .map(
                (inj) =>
                  `<div class="injury-row"><span>${inj.name}${inj.detail ? ` <span class="dim">— ${inj.detail}</span>` : ""}</span><span class="injury-status ${injuryStatusClass(inj.status)}">${inj.status}</span></div>`
              )
              .join("");
            card.insertAdjacentHTML("beforeend", `<p class="injury-team-name">${t.teamName}</p>${rows}`);
          });
          section.appendChild(card);
        });
      }
      container.appendChild(section);
    });
  }

  function newsPage(container, leagues, newsByLeagueId) {
    container.innerHTML = "";
    leagues.forEach((league) => {
      const res = newsByLeagueId[league.id];
      const section = el("div", "league-section");
      section.insertAdjacentHTML("beforeend", leagueSectionHeader(league));

      const articles = res && res.ok ? (res.data.articles || []) : [];
      if (!res || !res.ok) {
        section.appendChild(el("div", "error-note", `Couldn't load news${res ? ` (${res.error})` : ""}.`));
      } else if (!articles.length) {
        section.appendChild(el("div", "empty-note", "No recent headlines for this league."));
      } else {
        const grid = el("div", "news-grid");
        articles.slice(0, 6).forEach((a) => {
          const href = safe(() => a.links.web.href, "#");
          const when = a.published ? new Date(a.published).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
          grid.insertAdjacentHTML(
            "beforeend",
            `<a class="news-item news-card" href="${href}" target="_blank" rel="noopener">
              <div class="news-headline">${a.headline || "Untitled"}</div>
              <div class="news-meta">${when}</div>
            </a>`
          );
        });
        section.appendChild(grid);
      }
      container.appendChild(section);
    });
  }

  /* ---------- home dashboard ---------- */
  function statTile(value, label) {
    return `<div class="stat-tile"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
  }

  function featuredGames(resultsByLeague, limit) {
    const all = [];
    resultsByLeague.forEach(({ league, games }) => {
      (games || []).forEach((g) => all.push({ game: g, league }));
    });
    const pinned = (x) => Store.isWatchlisted(x.league.id, x.game.home.abbr) || Store.isWatchlisted(x.league.id, x.game.away.abbr);
    const score = (x) => {
      if (pinned(x)) return 0;
      if (x.game.state === "in") return 1;
      if (x.game.oddsText) return 2;
      if (x.game.state === "pre") return 3;
      return 4;
    };
    return all.sort((a, b) => score(a) - score(b)).slice(0, limit);
  }

  function homePanel(container, resultsByLeague, leagues, leagueLabelById, callbacks) {
    container.innerHTML = "";
    const { onSelectLeague, onOpenDetails, onWatchlistChange } = callbacks;

    if (!resultsByLeague.length) {
      container.appendChild(el("div", "empty-note", "Loading today's slate…"));
      return;
    }

    const allGames = resultsByLeague.flatMap((r) => r.games || []);
    const liveCount = allGames.filter((g) => g.state === "in").length;
    const todayCount = allGames.length;
    const pinnedCount = Store.getWatchlist().length;

    // --- stat row ---
    const stats = el(
      "div",
      "stat-row",
      statTile(liveCount, "live now") +
        statTile(todayCount, "games on the board") +
        statTile(leagues.length, "leagues tracked") +
        statTile(pinnedCount, "teams pinned")
    );
    container.appendChild(stats);

    // --- featured games ---
    const featured = featuredGames(resultsByLeague, 6);
    container.appendChild(el("p", "section-label", "Featured right now"));
    const featuredList = el("div", "game-list");
    if (!featured.length) {
      featuredList.appendChild(el("div", "empty-note", "Nothing on the board across any league right now."));
    } else {
      featured.forEach(({ game, league }) => featuredList.appendChild(gameCard(game, league, onWatchlistChange, onOpenDetails)));
    }
    container.appendChild(featuredList);

    // --- league quick nav ---
    container.appendChild(el("p", "section-label", "Jump to a league"));
    const navGrid = el("div", "quick-nav-grid");
    leagues.forEach((league) => {
      const found = resultsByLeague.find((r) => r.league.id === league.id);
      const games = (found && found.games) || [];
      const live = games.filter((g) => g.state === "in").length;
      const card = el(
        "button",
        "quick-nav-card",
        `<div class="quick-nav-label">${league.logo ? `<img class="quick-nav-logo" src="${league.logo}" alt="" loading="lazy" onerror="this.style.display='none'">` : ""}${league.label}</div>
         <div class="quick-nav-meta">${games.length} game${games.length === 1 ? "" : "s"}${live ? ` · <span class="live">${live} live</span>` : ""}</div>`
      );
      card.type = "button";
      card.addEventListener("click", () => onSelectLeague(league.id));
      navGrid.appendChild(card);
    });
    container.appendChild(navGrid);

    // --- recent history preview ---
    const log = Store.getLog().slice(0, 10);
    if (log.length) {
      container.appendChild(el("p", "section-label", "Recently finished"));
      const recent = el("div", "recent-grid");
      log.forEach((entry) => recent.appendChild(recentCard(entry, leagueLabelById)));
      container.appendChild(recent);
    }
  }

  function recentCard(entry, leagueLabelById) {
    const teamRow = (t) => {
      const isObj = typeof t === "object" && t !== null;
      const name = isObj ? t.name : t;
      const score = isObj ? t.score : null;
      const logo = isObj ? t.logo : null;
      const winnerClass = isObj && t.winner ? " winner" : isObj && t.winner === false ? " loser" : "";
      return `<div class="recent-team${winnerClass}">
        ${logo ? `<img class="team-logo" src="${logo}" alt="" loading="lazy" onerror="this.style.display='none'">` : ""}
        <span class="recent-team-name">${name}</span>
        <span class="recent-team-score">${score ?? ""}</span>
      </div>`;
    };
    return el(
      "div",
      "recent-card",
      `<div class="league-badge"><span>${leagueLabelById[entry.leagueId] || entry.leagueId}</span></div>
       ${teamRow(entry.away)}
       ${teamRow(entry.home)}
       <div class="recent-card-foot">Closing: ${entry.closingLine ?? "—"}</div>`
    );
  }

  function settingsPanel(container, onChange) {
    container.innerHTML = "";
    const settings = Store.getSettings();

    const group = el("div", "settings-group");

    // ticker on/off
    const row1 = el("div", "settings-row");
    const label1 = el(
      "div",
      null,
      `<div class="settings-row-label">Ticker scrolling</div><div class="settings-row-desc">When off, the ticker still shows every game — it just stops auto-scrolling so you can read it or scroll it yourself.</div>`
    );
    const toggle = el("button", `toggle-switch${settings.tickerEnabled ? " on" : ""}`);
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(settings.tickerEnabled));
    toggle.setAttribute("aria-label", "Toggle ticker scrolling");
    toggle.addEventListener("click", () => {
      const s = Store.setSetting("tickerEnabled", !Store.getSettings().tickerEnabled);
      toggle.classList.toggle("on", s.tickerEnabled);
      toggle.setAttribute("aria-checked", String(s.tickerEnabled));
      speedGroup.querySelectorAll(".speed-btn").forEach((b) => (b.disabled = !s.tickerEnabled));
      if (onChange) onChange(s);
    });
    row1.appendChild(label1);
    row1.appendChild(toggle);
    group.appendChild(row1);

    // speed
    const row2 = el("div", "settings-row");
    const label2 = el(
      "div",
      null,
      `<div class="settings-row-label">Scroll speed</div><div class="settings-row-desc">How fast the ticker moves when scrolling is on.</div>`
    );
    const speedGroup = el("div", "speed-group");
    [
      ["slow", "Slow"],
      ["normal", "Normal"],
      ["fast", "Fast"],
    ].forEach(([value, text]) => {
      const btn = el("button", `speed-btn${settings.tickerSpeed === value ? " active" : ""}`, text);
      btn.type = "button";
      btn.disabled = !settings.tickerEnabled;
      btn.addEventListener("click", () => {
        const s = Store.setSetting("tickerSpeed", value);
        speedGroup.querySelectorAll(".speed-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        if (onChange) onChange(s);
      });
      speedGroup.appendChild(btn);
    });
    row2.appendChild(label2);
    row2.appendChild(speedGroup);
    group.appendChild(row2);

    container.appendChild(group);
  }

  return {
    normalizeEvent,
    buildTicker,
    gameList,
    standingsTable,
    watchlistPanel,
    historyPanel,
    settingsPanel,
    gameDetailModal,
    homePanel,
    extractWeather,
    extractInjuries,
    weatherPage,
    injuriesPage,
    newsPage,
  };
})();
