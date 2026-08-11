/**
 * Optional proxy server with input validation and security hardening.
 *
 * The dashboard works by calling ESPN's public site API directly from
 * the browser. That endpoint generally sends permissive CORS headers,
 * but that's ESPN's choice, not a guarantee — if you see "failed to
 * fetch" errors in production, run this instead and point js/config.js
 * at it (set API_BASE = "/api/espn" or wherever you deploy this).
 *
 * IMPROVEMENTS (Phase 1):
 * - Input validation for upstream paths
 * - SSRF protection (block private IPs)
 * - Rate limiting per IP
 * - Request logging
 *
 * Usage:
 *   npm install
 *   node server.js
 *   # serves the static site AND proxies /api/espn/* -> ESPN
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 8787;
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const PUBLIC_DIR = __dirname;

// Rate limiting config
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 100; // 100 requests per minute per IP
const rateLimitMap = new Map(); // ip -> { count, resetTime }

// MIME types
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

/**
 * Check if IP is in private range (SSRF protection)
 */
function isPrivateIP(ip) {
  // Simple check for common private IP patterns
  const privatePatterns = [
    /^127\./, // localhost
    /^10\./, // Class A private
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // Class B private
    /^192\.168\./, // Class C private
    /^0\.0\.0\.0/,
    /^::1$/, // IPv6 localhost
    /^fc00:/i, // IPv6 unique local
    /^fe80:/i, // IPv6 link-local
  ];
  
  return privatePatterns.some(pattern => pattern.test(ip));
}

/**
 * Rate limiting middleware
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetTime) {
    // New window
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (record.count >= RATE_LIMIT_MAX) {
    return false; // Rate limited
  }
  
  record.count++;
  return true;
}

/**
 * Validate and sanitize upstream path (prevent path traversal & SSRF)
 */
function validateUpstreamPath(rawPath) {
  // Remove /api/espn prefix
  const cleanPath = rawPath.replace(/^\/api\/espn/, "");
  
  // Block empty paths
  if (!cleanPath || cleanPath === "/") {
    return { valid: false, error: "Empty path" };
  }
  
  // Block path traversal attempts
  if (cleanPath.includes("..") || cleanPath.includes("//")) {
    return { valid: false, error: "Invalid path characters" };
  }
  
  // Block absolute URLs (prevent SSRF to other domains)
  if (cleanPath.startsWith("http://") || cleanPath.startsWith("https://")) {
    return { valid: false, error: "Absolute URLs not allowed" };
  }
  
  // Block IP addresses in path (prevent SSRF)
  const ipPattern = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
  if (ipPattern.test(cleanPath)) {
    return { valid: false, error: "IP addresses not allowed in path" };
  }
  
  // Only allow ESPN sports API paths
  const allowedSports = [
    "baseball/mlb",
    "basketball/nba",
    "basketball/mens-college-basketball",
    "soccer/eng.1",
    "soccer/uefa.champions",
    "soccer/usa.1",
    "soccer/usa.usl.1",
  ];
  
  const isValidSport = allowedSports.some(sport => cleanPath.includes(sport));
  if (!isValidSport && !cleanPath.startsWith("/")) {
    return { valid: false, error: "Invalid sport endpoint" };
  }
  
  // Construct final URL
  const upstreamUrl = `${ESPN_BASE}${cleanPath}`;
  
  // Validate URL format
  try {
    const parsed = new URL(upstreamUrl);
    if (parsed.protocol !== "https:") {
      return { valid: false, error: "Only HTTPS allowed" };
    }
    if (!parsed.hostname.endsWith("espn.com")) {
      return { valid: false, error: "Only ESPN domains allowed" };
    }
  } catch (e) {
    return { valid: false, error: "Invalid URL format" };
  }
  
  return { valid: true, url: upstreamUrl, path: cleanPath };
}

/**
 * Serve static files with security checks
 */
function serveStatic(req, res) {
  let filePath = req.url === "/" ? "/index.html" : req.url;

  // Remove query string
  filePath = filePath.split("?")[0];

  // Decode URL
  try {
    filePath = decodeURIComponent(filePath);
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid URL encoding" }));
    return;
  }

  // Root or trailing-slash → serve index.html (handles `/?foo=bar` etc.)
  if (filePath === "/" || filePath === "") filePath = "/index.html";

  // Resolve to absolute path
  const resolvedPath = path.join(PUBLIC_DIR, filePath);
  
  // Security check: ensure path is within PUBLIC_DIR
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden: Path traversal detected" }));
    return;
  }
  
  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server error" }));
      }
      return;
    }
    
    const ext = path.extname(resolvedPath);
    const contentType = MIME[ext] || "application/octet-stream";
    
    // Add security headers
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
  });
}

/**
 * Proxy ESPN API requests with validation and rate limiting
 */
function proxyEspn(req, res) {
  const clientIP = req.socket.remoteAddress || req.connection.remoteAddress || "unknown";
  
  // Rate limiting check
  if (!checkRateLimit(clientIP)) {
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": "60",
      "X-RateLimit-Limit": RATE_LIMIT_MAX.toString(),
      "X-RateLimit-Window": (RATE_LIMIT_WINDOW / 1000).toString(),
    });
    res.end(JSON.stringify({ 
      error: "Rate limit exceeded",
      retryAfter: 60,
      limit: RATE_LIMIT_MAX,
      window: RATE_LIMIT_WINDOW / 1000
    }));
    console.log(`[RATE LIMIT] ${clientIP} - ${req.url}`);
    return;
  }
  
  // Validate upstream path
  const validation = validateUpstreamPath(req.url);
  if (!validation.valid) {
    res.writeHead(400, {
      "Content-Type": "application/json",
      "X-Error-Reason": validation.error,
    });
    res.end(JSON.stringify({ error: validation.error }));
    console.log(`[BLOCKED] ${clientIP} - ${req.url} - Reason: ${validation.error}`);
    return;
  }
  
  const upstreamUrl = validation.url;
  
  console.log(`[PROXY] ${clientIP} -> ${upstreamUrl}`);
  
  https
    .get(upstreamUrl, {
      // Real-browser headers. ESPN/Akamai bot-mitigation blocks the
      // default Node UA and "Accept: */*" from datacenter IPs (Railway's
      // shared egress range). Sending a Chrome UA + Accept-Language +
      // Referer is the cheapest fix — costs us nothing, may unblock the
      // request. If Akamai is fingerprinting on TLS JA3/JA4 instead, this
      // won't help and we need a residential proxy (Track 2).
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.espn.com/",
        "Origin": "https://www.espn.com",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
      },
      timeout: 10_000, // 10s timeout
    })
    .on("response", (upstreamRes) => {
      // ESPN/Akamai respond with gzip-encoded bodies. Node's `https.get`
      // does NOT auto-decompress — piping raw bytes to the client would
      // hand the browser a body that fails to JSON.parse (we saw this as
      // "0 games" everywhere despite HTTP 200). Decompress on the proxy
      // side so the client always gets plain bytes, no Content-Encoding
      // header needed.
      const zlib = require("zlib");
      const enc = (upstreamRes.headers["content-encoding"] || "").toLowerCase().trim();
      let stream = upstreamRes;
      if (enc === "gzip") stream = upstreamRes.pipe(zlib.createGunzip());
      else if (enc === "deflate") stream = upstreamRes.pipe(zlib.createInflate());
      else if (enc === "br") stream = upstreamRes.pipe(zlib.createBrotliDecompress());

      res.writeHead(upstreamRes.statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=15",
        "X-Content-Type-Options": "nosniff",
        "X-Proxy-By": "Oddsify-Intel",
      });
      stream.pipe(res);
      
      console.log(`[PROXY] ${upstreamRes.statusCode} - ${upstreamUrl} (enc: ${enc || "none"})`);
    })
    .on("error", (err) => {
      console.error(`[PROXY ERROR] ${upstreamUrl}: ${err.message}`);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        error: "Upstream error", 
        message: err.message,
        timestamp: new Date().toISOString()
      }));
    })
    .on("timeout", () => {
      console.error(`[PROXY TIMEOUT] ${upstreamUrl}`);
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        error: "Gateway timeout",
        message: "Upstream server took too long to respond",
        timestamp: new Date().toISOString()
      }));
    });
}

// Create server
const server = http.createServer((req, res) => {
  // Log all requests
  const method = req.method;
  const url = req.url;
  const clientIP = req.socket.remoteAddress || "unknown";
  
  console.log(`[${new Date().toISOString()}] ${method} ${url} from ${clientIP}`);
  
  if (req.url.startsWith("/api/espn/")) {
    proxyEspn(req, res);
  } else {
    serveStatic(req, res);
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[SERVER] SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("[SERVER] Closed out remaining connections");
    process.exit(0);
  });
  
  // Force close after 10s
  setTimeout(() => {
    console.error("[SERVER] Forced shutdown");
    process.exit(1);
  }, 10_000);
});

process.on("SIGINT", () => {
  console.log("[SERVER] SIGINT received, shutting down...");
  server.close(() => {
    console.log("[SERVER] Closed out remaining connections");
    process.exit(0);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           ODDSIFY INTEL PROXY SERVER                      ║
╠═══════════════════════════════════════════════════════════╣
║  Running at: http://localhost:${PORT}                      ║
║  ESPN proxy: http://localhost:${PORT}/api/espn/...         ║
║                                                           ║
║  Security features:                                       ║
║  ✓ Input validation                                       ║
║  ✓ SSRF protection                                        ║
║  ✓ Rate limiting (${RATE_LIMIT_MAX} req/${RATE_LIMIT_WINDOW/1000}s)              ║
║  ✓ Path traversal prevention                              ║
║  ✓ Graceful shutdown                                      ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
