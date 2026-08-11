/**
 * Thin fetch layer with retry logic, caching, and pruning.
 * Every function resolves to { ok: true, data } or { ok: false, error }.
 * 
 * IMPROVEMENTS (Phase 1):
 * - Exponential backoff retry (max 3 attempts)
 * - Dynamic TTL based on game state
 * - LRU cache with max size + periodic pruning
 */
const Api = (() => {
  // LRU Cache with max size
  const MAX_CACHE_SIZE = 100;
  const cache = new Map(); // key -> { data, ts, ttl }
  
  // Dynamic TTL defaults (ms)
  const TTL_LIVE = 5_000;      // Live games: 5s
  const TTL_UPCOMING = 30_000; // Upcoming: 30s
  const TTL_FINISHED = 60_000; // Finished: 60s
  const TTL_DEFAULT = 20_000;  // Default: 20s
  
  // Retry config
  const MAX_RETRIES = 3;
  const BASE_DELAY = 1000; // 1s base delay
  
  /**
   * Sleep helper for retry delays
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Prune old cache entries (older than 5min or beyond max size)
   */
  function pruneCache() {
    const now = Date.now();
    const maxAge = 5 * 60_000; // 5 minutes
    
    // Remove old entries
    for (const [key, value] of cache.entries()) {
      if (now - value.ts > maxAge) {
        cache.delete(key);
      }
    }
    
    // If still too large, remove oldest entries (LRU)
    if (cache.size > MAX_CACHE_SIZE) {
      const entries = Array.from(cache.entries())
        .sort((a, b) => a[1].ts - b[1].ts); // Sort by timestamp (oldest first)
      
      const toRemove = cache.size - MAX_CACHE_SIZE;
      for (let i = 0; i < toRemove; i++) {
        cache.delete(entries[i][0]);
      }
    }
  }
  
  // Prune cache every minute
  setInterval(pruneCache, 60_000);
  
  /**
   * Get TTL based on game state
   */
  function getTTL(gameData) {
    if (!gameData) return TTL_DEFAULT;
    
    const events = gameData.events || [];
    const hasLiveGame = events.some(e => {
      const state = e.status?.type?.state;
      return state === "in";
    });
    
    if (hasLiveGame) return TTL_LIVE;
    
    const hasUpcomingGame = events.some(e => {
      const state = e.status?.type?.state;
      return state === "pre";
    });
    
    if (hasUpcomingGame) return TTL_UPCOMING;
    
    return TTL_FINISHED;
  }
  
  /**
   * Fetch with retry logic (exponential backoff)
   */
  async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
    let lastError;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, options);
        
        // Handle rate limiting (429)
        if (res.status === 429) {
          const delay = BASE_DELAY * Math.pow(2, attempt - 1);
          console.warn(`[API] Rate limited (429), retrying in ${delay}ms (attempt ${attempt}/${retries})`);
          await sleep(delay);
          continue;
        }
        
        // Handle other errors
        if (!res.ok) {
          return { ok: false, error: `HTTP ${res.status}`, status: res.status };
        }
        
        const data = await res.json();
        return { ok: true, data, status: res.status };
        
      } catch (err) {
        lastError = err;
        
        // Network error - retry with backoff
        if (attempt < retries) {
          const delay = BASE_DELAY * Math.pow(2, attempt - 1);
          console.warn(`[API] Network error, retrying in ${delay}ms (attempt ${attempt}/${retries})`);
          await sleep(delay);
        }
      }
    }
    
    return { 
      ok: false, 
      error: lastError?.message || "Max retries exceeded",
      status: 0
    };
  }
  
  /**
   * Core fetch wrapper with caching
   */
  async function getJSON(url, gameData = null) {
    const cached = cache.get(url);
    const now = Date.now();
    
    // Check cache with dynamic TTL
    if (cached) {
      const ttl = cached.ttl || TTL_DEFAULT;
      if (now - cached.ts < ttl) {
        return { ok: true, data: cached.data, fromCache: true, age: now - cached.ts };
      }
      // Cache expired, remove it
      cache.delete(url);
    }
    
    // Fetch from network
    const result = await fetchWithRetry(url, {
      headers: { Accept: "application/json" }
    });
    
    if (result.ok) {
      // Store with dynamic TTL
      const ttl = getTTL(result.data);
      cache.set(url, { data: result.data, ts: now, ttl });
      
      // Prune if cache is getting large
      if (cache.size > MAX_CACHE_SIZE * 0.8) {
        pruneCache();
      }
    }
    
    return result;
  }
  
  // URL builders
  function scoreboardUrl(league) {
    return `${API_BASE}/${league.sport}/${league.slug}/scoreboard`;
  }
  
  function standingsUrl(league) {
    return `${API_BASE}/${league.sport}/${league.slug}/standings`;
  }
  
  function summaryUrl(league, eventId) {
    return `${API_BASE}/${league.sport}/${league.slug}/summary?event=${eventId}`;
  }
  
  function newsUrl(league) {
    return `${API_BASE}/${league.sport}/${league.slug}/news`;
  }
  
  function scheduleUrl(league, teamId) {
    // NEW: Team schedule endpoint for recent form
    return `${API_BASE}/${league.sport}/${league.slug}/teams/${teamId}/schedule`;
  }
  
  return {
    getScoreboard: (league) => getJSON(scoreboardUrl(league)),
    getStandings: (league) => getJSON(standingsUrl(league)),
    getSummary: (league, eventId) => getJSON(summaryUrl(league, eventId)),
    getNews: (league) => getJSON(newsUrl(league)),
    getSchedule: (league, teamId) => getJSON(scheduleUrl(league, teamId)),
    clearCache: () => cache.clear(),
    getCacheSize: () => cache.size,
    getCacheStats: () => ({
      size: cache.size,
      maxSize: MAX_CACHE_SIZE,
      entries: Array.from(cache.keys())
    })
  };
})();
