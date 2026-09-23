const express = require("express");
const http = require("node:http");
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const { Server } = require("socket.io");
const { Simulation, MAP, STEP } = require("../shared/simulation");
const { LEGACY_MAPS, getMap, MAP_ROTATION } = require("../shared/maps");
const { RankingStore } = require("./rankings");
const { Metrics } = require("./metrics");
const { CommunityQueue, verifySignature, verifyToken, clean, guardPublicText } = require("./community");
const { FiderReconciler } = require("./community-fider");
const { Insights } = require("./insights");

// The GitHub PR shape the worker is allowed to report back. Exact repository and
// path, so a worker cannot point the receipt at a fork, another repository, or a
// pull request it does not own.
const PR_URL = /^https:\/\/github\.com\/menezmethod\/saucerjam\/pull\/\d+$/;
// Explicit compatibility switch for existing fixtures that predate leases. It is
// OFF unless set, and it only relaxes the lease requirement for the
// state-changing worker completions below — never for the terminal Fider path.
const LEGACY_ACTIONS = String(process.env.COMMUNITY_LEGACY_ACTIONS || "") === "true";

// Fider's webhook content is a Go template edited by hand in its admin UI, so it
// drifts. A missing field renders as the literal `<no value>`, which is invalid
// JSON, and a dropped brace breaks the whole body. Salvage the fields we can
// from the raw text instead of rejecting the request: a non-2xx response makes
// Fider silently auto-disable the webhook (status 1 -> 3). Unquoted `<no value>`
// is treated as an empty string, never an error; unknown/malformed fields are
// ignored. Returns a flat post-shaped object (CommunityQueue.ingest validates).
function parseTolerantWebhook(raw) {
  const text = typeof raw === "string" ? raw : "";
  const intField = (name) => {
    const match = new RegExp(`"${name}"\\s*:\\s*(-?\\d+)`).exec(text);
    return match ? Number(match[1]) : undefined;
  };
  const strField = (name) => {
    const quoted = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
    if (quoted) return quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    // Go template emitted the field without a value; accept it as absent.
    if (new RegExp(`"${name}"\\s*:\\s*<no\\s*value>`).test(text)) return "";
    return undefined;
  };
  return {
    id: intField("post_id") ?? intField("id"),
    number: intField("post_number") ?? intField("number"),
    title: strField("post_title") ?? strField("title"),
    description: strField("post_description") ?? strField("description"),
    url: strField("post_url") ?? strField("url"),
    votes: intField("post_votes") ?? intField("votes"),
  };
}

function createGameServer({
  staticDir = path.join(__dirname, "../dist"),
  tick = true,
  rankingsFile = null,
  reconnectGraceMs = 30000,
  allowLegacyMaps = false,
  supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, ""),
  supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "",
  fiderBaseUrl = String(process.env.FIDER_BASE_URL || "").replace(/\/$/, ""),
  fiderApiKey = String(process.env.FIDER_API_KEY || ""),
  fiderWebhookSecret = String(process.env.FIDER_WEBHOOK_SECRET || ""),
  fiderWebhookToken = String(process.env.FIDER_WEBHOOK_TOKEN || ""),
  communityActionToken = String(process.env.COMMUNITY_ACTION_TOKEN || ""),
  // Production points this at mounted storage (server/data by default, mounted
  // at deploy time by the operator). Tests pass null and stay in memory.
  // `stateFile: undefined` means "use the production default"; an explicit null
  // means "keep this instance in memory", which is what every test does. Only
  // the real entrypoint (below) installs the default, so importing the server
  // from a test can never write into the repository's data directory.
  communityStateFile = process.env.COMMUNITY_QUEUE_FILE || null,
  communityReconcile = String(process.env.COMMUNITY_RECONCILE || "") === "true",
  maxRooms = Math.max(1, Math.min(100, Number(process.env.MAX_ROOMS) || 8)),
  maxPlayersPerRoom = Math.max(1, Math.min(128, Number(process.env.MAX_ROOM_PLAYERS) || 32)),
  maxConnections = Math.max(8, Math.min(1000, Number(process.env.MAX_CONNECTIONS) || 96)),
  maxConnectionsPerIp = Math.max(2, Math.min(maxConnections, Number(process.env.MAX_CONNECTIONS_PER_IP) || maxConnections)),
  joinAttemptsPerIp = Math.max(30, Math.min(1000, Number(process.env.JOIN_ATTEMPTS_PER_IP) || 120)),
} = {}) {
  const app = express(),
    server = http.createServer(app);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (req.secure || req.get("x-forwarded-proto") === "https")
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });
  const trustProxy = process.env.TRUST_PROXY === "true";
  const clientAddress = (request) => {
    if (trustProxy) {
      const forwarded = request.headers["x-forwarded-for"];
      if (typeof forwarded === "string" && forwarded.split(",")[0].trim()) return forwarded.split(",")[0].trim();
    }
    return request.socket?.remoteAddress || request.address || "unknown";
  };
  const limiter = (limit, windowMs = 60_000) => {
    const buckets = new Map();
    return (key) => {
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket || now - bucket.startedAt >= windowMs) {
        bucket = { startedAt: now, count: 0 };
        buckets.set(key, bucket);
      }
      bucket.count++;
      if (buckets.size > 4096)
        for (const [candidate, value] of buckets) if (now - value.startedAt >= windowMs) buckets.delete(candidate);
      return bucket.count <= limit;
    };
  };
  const httpLimiter = limiter(120);
  const healthLimiter = limiter(30);
  const connectionLimiter = limiter(60);
  const joinLimiter = limiter(joinAttemptsPerIp);
  const configuredOrigins = String(process.env.CLIENT_URL || "").split(",").map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean);
  const originAllowed = (request) => {
    const origin = request.headers.origin;
    if (!origin) return true;
    if (configuredOrigins.length) return configuredOrigins.includes(origin.replace(/\/$/, ""));
    try {
      const parsed = new URL(origin);
      return parsed.host === request.headers.host && ["http:", "https:"].includes(parsed.protocol);
    } catch {
      return false;
    }
  };
  const io = new Server(server, {
    maxHttpBufferSize: 8192,
    pingTimeout: 20_000,
    pingInterval: 25_000,
    allowRequest: (request, callback) => {
      const allowed = originAllowed(request);
      callback(allowed ? null : new Error("Origin not allowed."), allowed);
    },
    ...(configuredOrigins.length ? { cors: { origin: configuredOrigins } } : {}),
  });
  // ponytail: verify once per socket via Supabase Auth; add cached JWKS verification only when reconnect traffic warrants it.
  const verifySupabaseToken = async (token) => {
    if (!token) return null;
    if (!supabaseUrl || !supabasePublishableKey) throw new Error("Supabase authentication is not configured.");
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabasePublishableKey, authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Invalid Supabase session.");
    const user = await response.json();
    return typeof user?.id === "string" ? user : null;
  };
  const activeByIp = new Map();
  const releaseIp = (socket) => {
    const key = socket.data.clientAddress;
    if (!key) return;
    const count = activeByIp.get(key) || 0;
    if (count <= 1) activeByIp.delete(key);
    else activeByIp.set(key, count - 1);
  };
  io.use((socket, next) => {
    const key = clientAddress(socket.handshake);
    if (io.engine.clientsCount >= maxConnections)
      return next(new Error("Server is full. Please try again shortly."));
    if (!connectionLimiter(key)) return next(new Error("Too many connection attempts. Please try again shortly."));
    const active = activeByIp.get(key) || 0;
    if (active >= maxConnectionsPerIp) return next(new Error("Too many pilots from this network. Please try again shortly."));
    activeByIp.set(key, active + 1);
    socket.data.clientAddress = key;
    next();
  });
  io.use((socket, next) => {
    const token = typeof socket.handshake.auth?.accessToken === "string" ? socket.handshake.auth.accessToken : "";
    if (!token) return next();
    verifySupabaseToken(token).then((user) => { socket.data.authUser = user; next(); }).catch(() => { releaseIp(socket); next(new Error("Sign-in expired. Please sign in again.")); });
  });
  const rooms = new Map();
  const metrics = new Metrics();
  const mJoins = metrics.counter("saucerjam_joins_total", "Successful room joins", "counter");
  const mJoinFailures = metrics.counter("saucerjam_join_failures_total", "Rejected joins by reason", "counter");
  const mLeaves = metrics.counter("saucerjam_leaves_total", "Room departures by cause", "counter");
  const mRounds = metrics.counter("saucerjam_rounds_completed_total", "Completed rounds by map", "counter");
  const mEvents = metrics.counter("saucerjam_game_events_total", "Authoritative game events by type", "counter");
  const mChat = metrics.counter("saucerjam_chat_messages_total", "Accepted chat messages", "counter");
  const mRateLimited = metrics.counter("saucerjam_rate_limited_total", "Requests rejected by a limiter", "counter");
  const mHttp = metrics.counter("saucerjam_http_requests_total", "HTTP requests by route and status", "counter");
  const mConnections = metrics.counter("saucerjam_connections_total", "Websocket connections by outcome", "counter");
  const mRankingErrors = metrics.counter("saucerjam_ranking_save_errors_total", "Round result persistence failures", "counter");
  const gRooms = metrics.gauge("saucerjam_rooms", "Active rooms");
  const gPlayers = metrics.gauge("saucerjam_players", "Connected human pilots");
  const gBots = metrics.gauge("saucerjam_bots", "Active bots");
  const gCapacity = metrics.gauge("saucerjam_capacity_ratio", "Human pilots / maxPlayersPerRoom saturation");
  const gTokenBytes = metrics.gauge("saucerjam_fider_last_error", "1 when the most recent Fider call failed");
  const sendSnapshots = (room) => {
    for (const id of room.humans)
      io.sockets.sockets.get(id)?.emit("state", room.sim.snapshotFor(id));
  };
  const sendEvents = (room, events) => {
    for (const id of room.humans) {
      const visible = room.sim.eventsFor(id, events);
      if (visible.length) io.sockets.sockets.get(id)?.emit("events", visible);
    }
  };
  const rankings = new RankingStore({filePath:rankingsFile});
  const pendingSaves = new Set();
  let rankingError = null;
  const profileKey = token => typeof token === "string" && /^[a-zA-Z0-9_-]{20,128}$/.test(token) ? createHash("sha256").update(token).digest("hex") : null;
  const cleanChatText = (value) => typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 160)
    : "";
  // Instrument every response with a route label and duration for SRE dashboards.
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      // Only a matched route TEMPLATE is safe as a metric label. For an
      // unmatched request req.route is undefined, and falling back to req.path
      // let any anonymous client mint a permanent counter/histogram series per
      // unique URL it invented. That is unbounded cardinality on a shared
      // process, reachable without a credential and before the rate limiter,
      // and a scrape re-expands every series. Collapse them into one label.
      // Middleware that rejects before routing (the /api limiter) sets
      // res.locals.route so a 429 still names a route instead of "unmatched",
      // which is what the alert annotation tells the operator to read.
      const route = req.route?.path || res.locals.route || "unmatched";
      const labels = { method: req.method, route, status: String(res.statusCode) };
      mHttp.add(labels);
      metrics.httpDuration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
      if (res.statusCode === 429) mRateLimited.add({ route });
    });
    next();
  });
  // The /api limiter is deliberately registered AFTER the webhook route below.
  // Fider permanently disables a webhook on the first non-2xx it sees and never
  // retries, so a 429 on that one path would silently drop every future report.
  // Ordering by registration beats matching on the URL string: Express routes
  // "/api/community/webhook/" and case variants to the same handler, while a
  // string compare misses them and quietly restores the 429 and the 413.
  // The Fider webhook needs the exact raw bytes for HMAC, so it must be
  // declared BEFORE the JSON body parser (or the signature never validates).
  const community = new CommunityQueue({ stateFile: communityStateFile });
  // Read-only reconciliation. Fider is the content and status source; this only
  // ever reads it, and it stays off unless the operator configured credentials
  // AND turned it on. It is the only place the server reads Fider's post list.
  const reconciler = new FiderReconciler({ baseUrl: fiderBaseUrl, apiKey: fiderApiKey });
  // Reconciliation stays off unless the operator turned it on AND configured
  // Fider. `reconciler.configured()` is the real gate; the flag is the opt-in.
  if (communityReconcile && reconciler.configured()) reconciler.start(community);
  const insights = new Insights();
  const mCommunityIngest = metrics.counter("saucerjam_community_ingest_total", "Fider webhook items ingested by kind", "counter");
  const mCommunityRejected = metrics.counter("saucerjam_community_webhook_rejected_total", "Fider webhooks rejected by reason", "counter");
  const mCommunityActions = metrics.counter("saucerjam_community_actions_total", "AI actions recorded by type", "counter");
  // Bounded, label-free community health. No report text or post ids become
  // metric labels: those fields are unbounded and attacker-controlled, and a
  // scrape re-expands every series it has ever seen.
  const mCommunityClaims = metrics.counter("saucerjam_community_claims_total", "Worker claims by outcome", "counter");
  const mCommunityExhausted = metrics.counter("saucerjam_community_triage_exhausted_total", "Queue items parked after exhausting attempts", "counter");
  const mCommunityConflicts = metrics.counter("saucerjam_community_conflicts_total", "Worker completions rejected as stale or conflicting", "counter");
  const mCommunityReconcile = metrics.counter("saucerjam_community_reconcile_total", "Fider reconciliation passes and failures", "counter");
  const gCommunityQueue = metrics.gauge("saucerjam_community_queue_size", "Queue records held");
  const gCommunityBacklog = metrics.gauge("saucerjam_community_queue_backlog", "Non-terminal queue records");
  const gCommunityExhausted = metrics.gauge("saucerjam_community_queue_exhausted", "Dead-lettered queue records");
  const gCommunityHealthy = metrics.gauge("saucerjam_community_queue_healthy", "1 when the durable store loaded cleanly and has not failed a write");
  const gCommunityOldest = metrics.gauge("saucerjam_community_queue_oldest_due_timestamp_seconds", "Unix time of the oldest claimable item; 0 when none");
  const gCommunityReconcileAge = metrics.gauge("saucerjam_community_reconcile_age_seconds", "Seconds since the last Fider reconciliation pass; -1 when none has run");
  const gCommunityReconcileOk = metrics.gauge("saucerjam_community_reconcile_ok", "1 when the most recent reconciliation pass completed; -1 when none has run");
  // A dedicated meter for the webhook. It must never answer 429 — that is the
  // non-2xx that permanently kills the webhook — so an over-limit request is
  // accepted and dropped with 202 plus a counter. Its real job is to bound how
  // much body an anonymous client can make this process buffer.
  const webhookLimiter = limiter(600);
  app.post(
    "/api/community/webhook",
    (req, res, next) => {
      if (!webhookLimiter(clientAddress(req))) {
        mCommunityRejected.add({ reason: "rate_limited" });
        return res.status(202).json({ ok: false });
      }
      return next();
    },
    // A credential carried in a header can be rejected before the body is read,
    // so an honest sender with a stale token is rejected cheaply. This is NOT a
    // bound on a hostile caller: hasSignature only tests header PRESENCE, so
    // adding any junk x-signature header skips this check and still buys the
    // full body read. The real ingress bound is the meter above times the body
    // cap. It short-circuits only when no HMAC is offered at all, because a
    // valid signature must still open the gate on its own — the two credentials
    // are evaluated independently, never either/or.
    (req, res, next) => {
      const authorization = req.get("authorization") || "";
      const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
      const presented = (bearer ? bearer[1].trim() : "") || req.get("x-fider-token") || "";
      const hasSignature = Boolean(req.get("x-fider-signature") || req.get("x-signature"));
      // Only short-circuit when a token is actually configured: with no
      // credential set at all the handler must still answer 503, and a wrong
      // bearer must never mask that misconfiguration.
      if (fiderWebhookToken && presented && !hasSignature) {
        let ok = false;
        try { ok = verifyToken(fiderWebhookToken, presented); } catch { ok = false; }
        if (!ok) {
          mCommunityRejected.add({ reason: "bad_credential" });
          return res.status(401).json({ error: "Invalid webhook credential." });
        }
      }
      return next();
    },
    // 128kb covers any realistic post (Fider caps the title at 100 chars; the
    // description is what can be long) while keeping the worst-case buffered
    // bytes small on a path an unauthenticated caller can reach. Anything
    // larger is dropped with a counted 202 rather than a parser 413.
    express.raw({ type: "*/*", limit: "128kb" }),
    (req, res) => {
    if (!fiderWebhookSecret && !fiderWebhookToken) return res.status(503).json({ error: "Community webhooks are not configured." });
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const signature = req.get("x-fider-signature") || req.get("x-signature") || "";
    // Fider cannot HMAC-sign, so it authenticates with a shared bearer token
    // (Authorization: Bearer <token>, or x-fider-token). The HMAC path stays
    // for any sender that can produce it. Never log or echo the credential.
    const authorization = req.get("authorization") || "";
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    const token = (bearer ? bearer[1].trim() : "") || req.get("x-fider-token") || "";
    // Evaluate both credentials independently: a throw or failure in one must
    // never short-circuit the other. A valid credential of either type opens
    // the gate; an internal error fails closed and is counted, never a 500.
    let signatureOk = false;
    let tokenOk = false;
    let verificationError = false;
    try { signatureOk = verifySignature(fiderWebhookSecret, raw, signature); } catch { verificationError = true; }
    try { tokenOk = verifyToken(fiderWebhookToken, token); } catch { verificationError = true; }
    if (!signatureOk && !tokenOk) {
      mCommunityRejected.add({ reason: verificationError ? "verification_error" : "bad_credential" });
      return res.status(401).json({ error: "Invalid webhook credential." });
    }
    let payload;
    let degraded = false;
    try {
      payload = JSON.parse(raw || "{}");
    } catch {
      // A non-2xx here makes Fider silently auto-disable this webhook, so a
      // malformed template must degrade, not fail. Salvage what we can.
      payload = parseTolerantWebhook(raw);
      degraded = true;
    }
    // Fider templates emit flat keys (post_number, post_title, ...) via the
    // Go-template webhook content; accept both flat and nested shapes.
    const post = payload?.post || payload?.data?.post || payload || {};
    // Distinguish a first delivery from a replay so the counter reports items
    // accepted rather than webhook calls received.
    // ingest() stores under the GUARDED id, so the lookup has to apply the same
    // guard: an id carrying bidi, zero-width characters, or more than 40 chars
    // would otherwise never match and every replay would count as a new item.
    const incomingId = guardPublicText(String(post.post_id ?? post.id ?? post.post_number ?? post.number ?? ""), { limit: 40 });
    const existed = incomingId !== "" && community.get(incomingId) != null;
    const item = community.ingest({
      id: post.post_id ?? post.id ?? post.post_number ?? post.number,
      number: post.post_number ?? post.number,
      title: post.post_title ?? post.title,
      description: post.post_description ?? post.description,
      url: post.post_url ?? post.url,
      votes: post.post_votes ?? post.votesCount ?? post.votes,
    });
    if (!item) {
      mCommunityRejected.add({ reason: "unusable_item" });
      // WHY 202 for a body with nothing usable: Fider auto-disables the webhook
      // on any non-2xx and the failure is silent. Observability lives in the
      // metrics counter above, not in the HTTP status.
      return res.status(202).json({ ok: false });
    }
    if (degraded) mCommunityRejected.add({ reason: "degraded_parse" });
    if (!existed) mCommunityIngest.add({ kind: item.kind, proposal: item.proposal });
    return res.status(202).json({ ok: true, id: item.id, proposal: item.proposal });
    },
    // Route-scoped, so the router matches it rather than a URL string compare.
    // express.raw rejects an oversized or malformed body BEFORE the handler
    // runs, and Fider disables a webhook permanently on the first non-2xx, so
    // those rejections must surface as a counted 202 instead of a parser 413.
    (err, req, res, next) => {
      // Branch on the actual error. A client that drops mid-upload raises
      // `request aborted`, not a size error, and labelling both body_rejected
      // sends the operator hunting for an oversized post that never existed.
      // Anything unexpected still answers 202 — a non-2xx here permanently
      // disables the webhook — but is counted separately so it stays visible
      // rather than being silently filed as a size problem.
      mCommunityRejected.add({ reason: err?.type === "entity.too.large" ? "body_rejected" : "body_error" });
      return res.status(202).json({ ok: false });
    },
  );
  app.use("/api", (req, res, next) => {
    // Registered after the webhook route on purpose: a 429 on that path would
    // permanently disable the Fider webhook. res.locals.route keeps limiter
    // rejections labelled for the alert annotation that reads it.
    res.locals.route = "/api";
    if (!httpLimiter(clientAddress(req))) return res.status(429).json({ error: "Too many requests. Please try again shortly." });
    next();
  });
  app.use("/api", express.json({ limit: "12kb", strict: true }));
  // Public, non-PII population signal for the landing page: how many pilots are
  // online right now and how many rounds have been played. No auth required.
  app.get("/api/statistics", (_req, res) => {
    let online = 0;
    for (const room of rooms.values()) online += room.humans.size;
    res.set("Cache-Control", "public, max-age=15");
    res.json({ online, rooms: rooms.size, maxRoomPlayers: maxPlayersPerRoom });
  });
  // Behavioural friction ingest. Fire-and-forget, allow-listed event names,
  // coarse device/platform buckets, no identifiers or free text.
  const insightLimiter = limiter(120, 60_000);
  app.post("/api/insights", (req, res) => {
    if (!insightLimiter(clientAddress(req))) return res.status(429).end();
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 20) : [];
    for (const event of events) insights.track({ event, device: req.body?.device, platform: req.body?.platform });
    return res.status(204).end();
  });
  app.get("/api/config", (_req, res) => res.json({
    authEnabled: Boolean(supabaseUrl && supabasePublishableKey),
    authProviders: String(process.env.SUPABASE_AUTH_PROVIDERS || "google").split(",").map(provider => provider.trim().toLowerCase()).filter(Boolean),
    supabaseUrl: supabaseUrl || "",
    supabasePublishableKey: supabasePublishableKey || "",
  }));
  app.get("/api/leaderboard", async (req,res) => {
    try { res.json({rows:await rankings.getLeaderboard({mapId:req.query.mapId || undefined,limit:50}),scope:req.query.mapId || "overall",error:rankingError}); } catch { res.status(503).json({error:"Flight records are temporarily unavailable."}); }
  });
  app.get("/api/profile", async (req,res) => {
    let id = profileKey(req.get("x-pilot-token"));
    const authorization = req.get("authorization") || "";
    if (/^Bearer\s+/i.test(authorization)) {
      try { id = (await verifySupabaseToken(authorization.replace(/^Bearer\s+/i, "").trim()))?.id || null; }
      catch { return res.status(401).json({error:"Your account session has expired."}); }
    }
    if(!id) return res.status(400).json({error:"A pilot identity is required."});
    try {res.json({playerId:id,profile:await rankings.getProfile(id),error:rankingError});} catch {res.status(503).json({error:"Flight records are temporarily unavailable."});}
  });
  const reportUserLimiter = limiter(1, 10 * 60_000);
  const reportDailyLimiter = limiter(5, 24 * 60 * 60_000);
  const reportIpLimiter = limiter(20, 60 * 60_000);
  const cleanFeedback = (value, limit) => typeof value === "string"
    ? value
      .replace(/https?:\/\/\S+/gi, "[link removed]")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/[<>`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit)
    : "";
  const fiderRequest = async (endpoint, options = {}) => {
    const response = await fetch(`${fiderBaseUrl}/api/v1${endpoint}`, {
      ...options,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${fiderApiKey}`,
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`Fider request failed (${response.status})`);
    return response.json();
  };
  app.post("/api/community/report", async (req, res) => {
    if (!fiderBaseUrl || !fiderApiKey) return res.status(503).json({ error: "Community reports are not configured yet." });
    const authorization = req.get("authorization") || "";
    if (!/^Bearer\s+/i.test(authorization)) return res.status(401).json({ error: "Sign in with a verified account to report feedback." });
    let user;
    try {
      user = await verifySupabaseToken(authorization.replace(/^Bearer\s+/i, "").trim());
    } catch {
      return res.status(401).json({ error: "Your account session has expired. Sign in again." });
    }
    if (!user?.id) return res.status(401).json({ error: "Sign in with a verified account to report feedback." });
    if (!(user.email_confirmed_at || user.confirmed_at)) return res.status(403).json({ error: "Confirm your email before sending feedback." });
    const userKey = `report:${user.id}`;
    const ipKey = `report:${clientAddress(req)}`;
    if (!reportUserLimiter(userKey) || !reportDailyLimiter(userKey) || !reportIpLimiter(ipKey))
      return res.status(429).json({ error: "Feedback is cooling down. Please try again later." });
    const kind = ["bug", "feature", "balance", "question"].includes(req.body?.kind) ? req.body.kind : "bug";
    const title = cleanFeedback(req.body?.title, 120);
    const description = cleanFeedback(req.body?.description, 4000);
    if (title.length < 4 || description.length < 10)
      return res.status(400).json({ error: "Add a short title and a few details so the report is useful." });
    const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
    const contextLine = (label, value, limit = 48) => {
      const cleaned = cleanFeedback(value, limit);
      return cleaned ? `${label}: ${cleaned}` : "";
    };
    const details = [
      description,
      "",
      "— SaucerJam context —",
      contextLine("Build", process.env.APP_VERSION || "web"),
      contextLine("Mode", context.mode),
      contextLine("Map", context.mapId),
      contextLine("Device", context.device, 80),
    ].filter(Boolean).join("\n");
    try {
      const fiderUser = await fiderRequest("/users", {
        method: "POST",
        body: JSON.stringify({
          name: cleanFeedback(user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "SaucerJam pilot", 80),
          email: user.email,
          reference: `supabase:${user.id}`,
        }),
      });
      const post = await fiderRequest("/posts", {
        method: "POST",
        headers: { "x-fider-userid": String(fiderUser.id) },
        body: JSON.stringify({ title: `[${kind}] ${title}`, description: details }),
      });
      const postUrl = post?.number ? `${fiderBaseUrl}/posts/${post.number}` : fiderBaseUrl;
      return res.status(201).json({ ok: true, url: postUrl, number: post?.number || null });
    } catch (error) {
      console.error("Fider report failed:", error.message);
      return res.status(502).json({ error: "The community portal is unavailable. Please try again later." });
    }
  });
  // Prometheus scrape target (no auth: exposes only aggregate, non-PII counts).
  app.get("/metrics", (req, res) => {
    if (!healthLimiter(clientAddress(req))) return res.status(429).end();
    communityGauges();
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(metrics.render({ extraGauges: [ ...roomGauges(), insights.render(), ...["ok","degraded"].map(s => `saucerjam_rankings_status{status="${s}"} ${(rankingError?"degraded":"ok")===s?1:0}`) ] }));
  });
  // Community freshness, backlog and exhaustion. Label-free on purpose: post
  // ids and report text are unbounded, so they must never become series.
  function communityGauges() {
    const health = community.status();
    gCommunityQueue.set({}, health.size);
    gCommunityBacklog.set({}, health.backlog);
    gCommunityExhausted.set({}, health.exhausted);
    gCommunityHealthy.set({}, health.healthy ? 1 : 0);
    gCommunityOldest.set({}, health.oldestDueAt ? Math.floor(Date.parse(health.oldestDueAt) / 1000) : 0);
    const last = reconciler.health().lastPass;
    gCommunityReconcileAge.set({}, last ? Math.max(0, (Date.now() - Date.parse(last.at)) / 1000) : -1);
    gCommunityReconcileOk.set({}, last ? (last.ok ? 1 : 0) : -1);
    return [];
  }
  function roomGauges() {
    let humans = 0, bots = 0, maxStage = 3;
    for (const room of rooms.values()) {
      humans += room.humans.size;
      bots += [...room.sim.players.values()].filter((p) => p.bot).length;
    }
    gRooms.set({}, rooms.size);
    gPlayers.set({}, humans);
    gBots.set({}, bots);
    gCapacity.set({}, maxPlayersPerRoom ? humans / (rooms.size * maxPlayersPerRoom || maxPlayersPerRoom) : 0);
    return [];
  }
  // Restricted action surface used by Hermes after it has drafted a change.
  // Opening a PR/branch is allowed; merging or closing is not (see docs/AUTOMATION.md).
  app.get("/api/community/queue", (req, res) => {
    if (!communityActionToken || req.get("x-community-token") !== communityActionToken)
      return res.status(401).json({ error: "Community action token required." });
    // A queue read from a store that did not load cleanly would report "no work"
    // while the real journal is sitting unusable on disk. That is the exact
    // false-green the audit found, so it answers non-200 instead.
    const health = community.status();
    if (!health.healthy) return res.status(503).json({ error: "Community queue store is unavailable.", ...health });
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    return res.json({ items: community.list({ status }) });
  });

  // Claim one eligible item. This is the leased entry point the worker uses:
  // the lease is persisted before the token is returned, so two workers can
  // never hold the same item, and an abandoned lease becomes a failed attempt.
  app.post("/api/community/claim", (req, res) => {
    if (!communityActionToken || req.get("x-community-token") !== communityActionToken)
      return res.status(401).json({ error: "Community action token required." });
    const workerId = clean(req.body?.workerId, 64);
    if (!workerId) return res.status(400).json({ error: "workerId is required." });
    const claimed = community.claim({ workerId });
    mCommunityClaims.add({ outcome: claimed.status === "claimed" ? "claimed" : claimed.status });
    if (claimed.status === "unavailable")
      return res.status(503).json({ error: "Community queue store is unavailable.", reason: claimed.reason });
    // No work is the common case: answer cheaply, with no lease and no model call.
    if (claimed.status !== "claimed") return res.json({ item: null });
    return res.json({
      item: claimed.item,
      leaseToken: claimed.leaseToken,
      inputHash: claimed.inputHash,
      attempt: claimed.attempt,
      leaseExpiresAt: claimed.expiresAt,
    });
  });

  app.post("/api/community/action", (req, res) => {
    if (!communityActionToken || req.get("x-community-token") !== communityActionToken)
      return res.status(401).json({ error: "Community action token required." });
    const { id, action, detail, leaseToken, inputHash } = req.body || {};
    if (!CommunityQueue.allowedActions().includes(action)) {
      mCommunityRejected.add({ reason: "disallowed_action" });
      return res.status(400).json({ error: `Action must be one of: ${CommunityQueue.allowedActions().join(", ")}` });
    }
    const known = community.get(id);
    if (!known) return res.status(404).json({ error: "Unknown community item." });
    // Map the worker's vocabulary onto the journal's transitions. `fix-pr` and
    // `prototype-pr` are receipts that a PR was opened; they are NOT done, and a
    // comment is not a fix. Nothing here can mark an item terminal.
    const completion =
      action === "request-info" ? "request_info"
      : action === "open-fix-pr" || action === "open-prototype-pr" ? "actioned"
      : action === "comment" || action === "flag-duplicate" ? "comment"
      : null;
    if (completion === null) {
      mCommunityRejected.add({ reason: "disallowed_action" });
      return res.status(400).json({ error: `Action must be one of: ${CommunityQueue.allowedActions().join(", ")}` });
    }
    const durable = community.status().healthy;
    // A state-changing completion needs the lease the claim handed out. Without
    // it any caller holding the shared token could mark unrelated work done, and
    // two workers racing the same item would both "succeed". The legacy switch
    // exists only for fixtures written against the pre-lease surface.
    const needsLease = completion !== "comment";
    if (needsLease && !leaseToken && !LEGACY_ACTIONS)
      return res.status(428).json({ error: "A leaseToken from /api/community/claim is required." });
    if (needsLease && leaseToken) {
      const verdict = community.complete({ id, action: completion, leaseToken, inputHash });
      if (verdict.status === "unavailable")
        return res.status(503).json({ error: "Community queue store is unavailable.", reason: verdict.reason });
      if (verdict.status === "expired_lease" || verdict.status === "no_lease" || verdict.status === "bad_lease")
        { mCommunityConflicts.add({ reason: verdict.status }); return res.status(409).json({ error: "This lease is no longer valid. Claim the item again.", reason: verdict.status }); }
      if (verdict.status === "stale_input")
        { mCommunityConflicts.add({ reason: "stale_input" }); return res.status(409).json({ error: "The report changed since this lease was issued.", reason: "stale_input" }); }
      if (verdict.status === "terminal")
        { mCommunityConflicts.add({ reason: "terminal" }); return res.status(409).json({ error: "This item already reached a terminal state.", reason: "terminal" }); }
      if (verdict.status === "replayed") {
        mCommunityActions.add({ action: completion });
        return res.json({ ok: true, replayed: true, item: verdict.item });
      }
      if (verdict.status === "accepted" && completion === "actioned") {
        // A `fix-pr` receipt may only cite an exact PR in this repository. A
        // receipt is not release evidence: it records that a PR was opened.
        const detailText = clean(detail, 500);
        if (!PR_URL.test(detailText))
          return res.status(400).json({ error: "detail must be a https://github.com/menezmethod/saucerjam/pull/<number> URL." });
        const item = community.record(id, "actioned", { detail: detailText, inputHash });
        mCommunityActions.add({ action: completion });
        return res.json({ ok: true, item });
      }
      if (verdict.status === "accepted" && completion === "request_info") {
        const item = community.record(id, "request_info", { detail: clean(detail, 500), inputHash });
        mCommunityActions.add({ action: completion });
        return res.json({ ok: true, item });
      }
      if (verdict.status === "accepted" && !durable) {
        // No store configured: the in-memory journal cannot bound attempts, so a
        // completion is refused rather than accepted and lost on restart.
        return res.status(503).json({ error: "Community queue store is not configured." });
      }
    }
    const item = community.record(id, completion, { detail: clean(detail, 500), inputHash });
    if (!item) return res.status(404).json({ error: "Unknown community item." });
    if (item.status === "dead_letter") mCommunityExhausted.add({});
    mCommunityActions.add({ action: completion });
    return res.json({ ok: true, item, acknowledged: completion === "comment" ? true : undefined });
  });

  // An explicit failed attempt. Guarded by the same lease, so a worker cannot
  // burn another worker's attempt or reset an item it does not hold.
  app.post("/api/community/fail", (req, res) => {
    if (!communityActionToken || req.get("x-community-token") !== communityActionToken)
      return res.status(401).json({ error: "Community action token required." });
    const { id, detail, leaseToken, inputHash } = req.body || {};
    const known = community.get(id);
    if (!known) return res.status(404).json({ error: "Unknown community item." });
    const verdict = community.complete({ id, action: "fail", leaseToken, inputHash });
    if (verdict.status === "unavailable")
      return res.status(503).json({ error: "Community queue store is unavailable.", reason: verdict.reason });
    if (["no_lease", "bad_lease", "expired_lease"].includes(verdict.status))
      { mCommunityConflicts.add({ reason: verdict.status }); return res.status(409).json({ error: "This lease is no longer valid. Claim the item again.", reason: verdict.status }); }
    if (verdict.status === "stale_input")
      { mCommunityConflicts.add({ reason: "stale_input" }); return res.status(409).json({ error: "The report changed since this lease was issued.", reason: "stale_input" }); }
    if (verdict.status === "terminal")
      { mCommunityConflicts.add({ reason: "terminal" }); return res.status(409).json({ error: "This item already reached a terminal state.", reason: "terminal" }); }
    const item = community.record(id, "fail", { detail: clean(detail, 500) });
    if (item?.status === "dead_letter") mCommunityExhausted.add({});
    return res.json({ ok: true, item });
  });
  app.use(express.static(staticDir));
  app.get("/health", (req, res) => {
    if (!healthLimiter(clientAddress(req))) return res.status(429).json({ error: "Too many health checks. Please try again shortly." });
    const payload = {
      status: "ok",
      rankings:rankingError?"degraded":"ok",
      community: communityHealth(),
      rooms: rooms.size,
      players: [...rooms.values()].reduce((n, r) => n + r.humans.size, 0),
    };
    return res.json(payload);
  });
  // Community readiness. A store that failed to load, or a reconciliation
  // credential that is configured but whose last pass failed, is a real
  // degradation of the loop. Missing optional integration credentials are NOT:
  // a standalone game with no Fider configured is healthy, and reporting it
  // unhealthy would break every deployment that does not run the loop.
  function communityHealth() {
    const queue = community.status();
    const reconcile = reconciler.health();
    const issues = [];
    if (!queue.healthy) issues.push(queue.loadError || "state_unhealthy");
    if (queue.persistError) issues.push(queue.persistError);
    if (reconcile.configured && reconcile.lastPass && !reconcile.lastPass.ok) issues.push("reconcile_failed");
    const status = issues.length ? "degraded" : "ok";
    return {
      status,
      durable: queue.durable,
      backlog: queue.backlog,
      exhausted: queue.exhausted,
      size: queue.size,
      oldestDueAt: queue.oldestDueAt,
      reconcile: {
        configured: reconcile.configured,
        running: reconcile.running,
        lastPassAt: reconcile.lastPass?.at || null,
        lastPassOk: reconcile.lastPass ? reconcile.lastPass.ok : null,
        excludedPosts: reconcile.excludedPosts,
      },
      issues,
    };
  }
  const makeRoom = (code, bots, mapId = "classic", rotate = false) => {
    const room = { code, bots, sim: new Simulation({map:getMap(mapId),mapRotation:rotate?MAP_ROTATION.map(getMap):[]}), humans: new Set(),matchId:randomBytes(12).toString("hex") };
    rooms.set(code, room);
    return room;
  };
  function fillBots(room) {
    const desired = room.bots ? Math.max(0, 4 - room.humans.size) : 0;
    const bots = [...room.sim.players.values()].filter((p) => p.bot);
    while (bots.length > desired) room.sim.removePlayer(bots.pop().id);
    const names = ["Vector", "Nova", "Echo", "Flux"];
    for (let i = 0; bots.length < desired; i++) {
      const id = `bot-${i}`;
      if (room.sim.players.has(id)) continue;
      bots.push(room.sim.addPlayer(id, names[i % names.length], true));
    }
  }
  function leave(socket, transportLoss = false) {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    room.humans.delete(socket.id);
    room.sim.removePlayer(socket.id);
    socket.leave(room.code);
    socket.data.room = null;
    mLeaves.add({ cause: transportLoss ? "transport" : "client" });
    if (!room.humans.size) {
      if(transportLoss){
        clearTimeout(room.expiry);
        room.expiry=setTimeout(()=>{if(!room.humans.size)rooms.delete(room.code);},reconnectGraceMs);
        room.expiry.unref?.();
      }else{clearTimeout(room.expiry);rooms.delete(room.code);}
    } else fillBots(room);
  }
  io.on("connection", (socket) => {
    let windowStart = Date.now(),
      packets = 0,
      lastJoin = 0,
      chatWindowStart = Date.now(),
      chatPackets = 0,
      lastChat = 0;
    socket.on("join", (request, ack) => {
      if (typeof ack !== "function") return;
      if (!joinLimiter(socket.data.clientAddress)) { mJoinFailures.add({ reason: "rate_limited" }); return ack({ error: "Too many join attempts. Please wait a moment." }); }
      const now = Date.now();
      if (now - lastJoin < 400) {
        mJoinFailures.add({ reason: "debounced" });
        return ack({ error: "Please wait a moment before joining again." });
      }
      lastJoin = now;
      if (!request || typeof request !== "object") {
        mJoinFailures.add({ reason: "invalid_request" });
        return ack({ error: "Invalid room request." });
      }
      const profileId = socket.data.authUser?.id || profileKey(request.profileToken) || createHash("sha256").update(socket.id).digest("hex");
      if(socket.data.profileId && socket.data.profileId!==profileId)return ack({error:"Reconnect before changing pilot identity."});
      const mode = request.mode;
      const requestedMap = typeof request.mapId === "string" && allowLegacyMaps && LEGACY_MAPS.some(map=>map.id===request.mapId) ? request.mapId : allowLegacyMaps ? "classic" : "confluence";
      let room;
      if (mode === "quick") {
        room = [...rooms.values()].find(
          (r) => r.code.startsWith("PUBLIC") && r.humans.size < maxPlayersPerRoom && r.sim.map.id === getMap(requestedMap).id,
        );
        if (!room) {
          if (rooms.size >= maxRooms) { mJoinFailures.add({ reason: "rooms_full" }); return ack({
              error: "All arenas are busy. Please try again shortly.",
            }); }
          room = makeRoom(
            `PUBLIC-${randomBytes(3).toString("hex").toUpperCase()}`,
            true, requestedMap, request.rotate === true,
          );
        }
      } else if (mode === "create") {
        if (rooms.size >= maxRooms) { mJoinFailures.add({ reason: "rooms_full" }); return ack({
            error: "All arenas are busy. Please try again shortly.",
          }); }
        let code;
        do {
          code = randomBytes(3).toString("hex").toUpperCase();
        } while (rooms.has(code));
        room = makeRoom(code, request.bots !== false, requestedMap, request.rotate === true);
      } else if (mode === "join") {
        const code =
          typeof request.code === "string"
            ? request.code.trim().toUpperCase()
            : "";
        room = rooms.get(code);
        if (!room) {
          mJoinFailures.add({ reason: "room_not_found" });
          return ack({
            error: "Room not found. Check the code or create a new room.",
          });
        }
      } else {
        mJoinFailures.add({ reason: "bad_mode" });
        return ack({ error: "Choose quick play, create room, or join room." });
      }
      if (room.humans.size >= maxPlayersPerRoom && !room.humans.has(socket.id)) { mJoinFailures.add({ reason: "room_full" }); return ack({ error: `This room is full (${maxPlayersPerRoom} pilots).` }); }
      if ([...room.sim.players.values()].some(p=>p.profileId===profileId && p.id!==socket.id)) return ack({error:"This pilot is already flying in this room. Use a different browser profile for another pilot."});
      if (socket.data.room !== room.code) leave(socket);
      socket.join(room.code);
      socket.data.room = room.code;
      socket.data.profileId = profileId;
      clearTimeout(room.expiry);room.expiry=null;
      room.humans.add(socket.id);
      mJoins.add({ mode: mode === "quick" || mode === "create" || mode === "join" ? mode : "unknown", map: getMap(requestedMap).id });
      if (request.profileToken) metrics.seeToken(request.profileToken);
      // Remove a filling bot before choosing a color and a safe player spawn.
      fillBots(room);
      const prior=[...room.sim.departed.values()].find(p=>p.profileId===profileId);
      const player = room.sim.addPlayer(socket.id, request.name, false, !room.sim.restartAt?prior:null);
      player.profileId=profileId;
      if(prior && !room.sim.restartAt)room.sim.departed.delete(prior.id);
      fillBots(room);
      ack({
        playerId: socket.id,
        profileId,
        code: room.code,
        map: room.sim.map,
        state: room.sim.snapshotFor(socket.id),
      });
    });
    socket.on("input", (input) => {
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        packets = 0;
      }
      if (++packets > 120) return;
      const room = rooms.get(socket.data.room);
      if (room) room.sim.setInput(socket.id, input);
    });
    socket.on("chat", (payload, ack) => {
      const room = rooms.get(socket.data.room);
      const text = cleanChatText(payload?.text);
      if (!room || !text) return typeof ack === "function" && ack({ error: "Join an arena and enter a message first." });
      const now = Date.now();
      if (now - chatWindowStart >= 10_000) {
        chatWindowStart = now;
        chatPackets = 0;
      }
      if (now - lastChat < 650 || ++chatPackets > 8) { mRateLimited.add({ route: "chat" }); return typeof ack === "function" && ack({ error: "Chat is cooling down. Try again in a moment." }); }
      lastChat = now;
      const pilot = room.sim.players.get(socket.id);
      const message = {
        id: randomBytes(6).toString("hex"),
        senderId: socket.data.profileId,
        name: pilot?.name || "Pilot",
        text,
        at: now,
      };
      mChat.add({});
      io.to(room.code).emit("chat", message);
      if (typeof ack === "function") ack({ ok: true });
    });
    socket.on("pingCheck", (ack) => {
      if (typeof ack === "function") ack();
    });
    socket.on("leave", () => leave(socket));
    socket.on("disconnect", reason => { releaseIp(socket); leave(socket, reason !== "client namespace disconnect" && reason !== "server namespace disconnect"); });
  });
  let previous = performance.now(),
    accumulator = 0;
  function advance() {
    const now = performance.now();
    accumulator += Math.min((now - previous) / 1000, 0.25);
    previous = now;
    while (accumulator >= STEP) {
      for (const room of rooms.values()) {
        if(!room.humans.size)continue;
        room.sim.step();
        const events = room.sim.drainEvents();
        for (const event of events) {
          mEvents.add({ type: event.type });
          if (event.type === "mapChanged") io.to(room.code).emit("map", event.map);
          if (event.type === "roundEnd") {
            mRounds.add({ map: room.sim.map.id });
            event.recap.recordId=room.matchId+":"+room.sim.round;
            const record={id:event.recap.recordId,mapId:room.sim.map.id,players:event.recap.players,winnerId:event.recap.winnerId};
            const save=Promise.resolve().then(()=>rankings.recordRound(record)).then(()=>{rankingError=null;io.to(room.code).emit("careerUpdated");}).catch(error=>{rankingError="Last round records could not be saved.";mRankingErrors.add({});console.error("Ranking save failed:",error.message);io.to(room.code).emit("rankingsError",rankingError);}).finally(()=>pendingSaves.delete(save));
            pendingSaves.add(save);
          }
        }
        if (events.length) sendEvents(room, events);
        // ponytail: radial AOI scans this zone's players; replace with a spatial
        // grid only if the 128-pilot socket measurement makes it necessary.
        if (room.sim.tick % 3 === 0) sendSnapshots(room);
      }
      accumulator -= STEP;
    }
  }
  const interval = tick ? setInterval(advance, 1000 / 60) : null;
  async function close() {
    clearInterval(interval);
    // The reconcile timer must not outlive the server: a leaked interval keeps
    // reading Fider (and holding the process open) after close.
    reconciler.stop();
    for(const room of rooms.values())clearTimeout(room.expiry);
    await new Promise((resolve) => io.close(resolve));
    await Promise.all([...pendingSaves]);
    // Flush the journal before the process goes away. Without the store the
    // write is already synchronous, so this only matters for the durable path.
    community.write();
    await rankings.close();
  }
  return { app, server, io, rooms, rankings, close };
}
if (require.main === module) {
  const game = createGameServer({
      rankingsFile: process.env.RANKINGS_FILE || path.join(__dirname, "data/rankings.json"),
      // The durable journal lives on mounted storage in production. Without an
      // explicit path the queue stays in memory and /health reports it.
      communityStateFile: process.env.COMMUNITY_QUEUE_FILE || path.join(__dirname, "data/community.json"),
      communityReconcile: process.env.COMMUNITY_RECONCILE === undefined ? true : String(process.env.COMMUNITY_RECONCILE) === "true",
    }),
    port = Number(process.env.PORT || 8080);
  game.server.listen(port, "0.0.0.0", () => {
    console.log(`SaucerJam is ready: http://localhost:${port}`);
    const interfaces = require("node:os").networkInterfaces();
    for (const entries of Object.values(interfaces))
      for (const net of entries || [])
        if (net.family === "IPv4" && !net.internal)
          console.log(`LAN play: http://${net.address}:${port}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => game.close().then(() => process.exit(0)));
}
module.exports = { createGameServer };
