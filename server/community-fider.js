// Read-only Fider reconciliation. This module owns every community-facing
// network read. Fider stays the content and status source; the local journal
// only remembers attempts, leases, and receipts.
//
// A partial or unreadable snapshot is a failure, never an empty list. Treating
// a failed fetch as "Fider has no work" is what let the old loop look healthy
// while twelve posts sat unreconciled, and it is also what would let a
// transient 500 terminalize live work in the caller's eyes.
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_INTERVAL_MS = 5 * 60_000;

// Documented smoke posts. These exercise the plumbing; they are deliberately not
// expected to converge. Configurable because the operator may retire them.
const DEFAULT_EXCLUDED = [9, 10];

// Views that together cover every non-archived post. `all` is the default view
// name for "not closed"; the declined/duplicate views are added so a post that
// Fider closed that way can still terminalize locally.
const VIEWS = ["all", "declined", "duplicate"];

function parseExcluded(value, fallback = DEFAULT_EXCLUDED) {
  if (value === undefined || value === null || value === "") return new Set(fallback);
  return new Set(String(value).split(",").map((entry) => Number(entry.trim())).filter(Number.isInteger));
}

function normalizeStatus(post) {
  const status = post?.status;
  if (typeof status === "string") return status.toLowerCase();
  // Fider's API has returned the status both as a slug and as an object.
  if (status && typeof status === "object" && typeof status.slug === "string") return status.slug.toLowerCase();
  return "open";
}

function normalizePost(post = {}) {
  return {
    id: post.id,
    number: Number(post.number),
    title: typeof post.title === "string" ? post.title : "",
    description: typeof post.description === "string" ? post.description : "",
    createdAt: typeof post.createdAt === "string" ? post.createdAt : null,
    status: normalizeStatus(post),
    url: Number.isInteger(Number(post.number)) ? `/posts/${Number(post.number)}` : null,
  };
}

class FiderReconciler {
  constructor({
    baseUrl = "",
    apiKey = "",
    excluded = parseExcluded(process.env.COMMUNITY_RECONCILE_EXCLUDE),
    intervalMs = Number(process.env.COMMUNITY_RECONCILE_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
    timeoutMs = Number(process.env.COMMUNITY_RECONCILE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    logger = console,
  } = {}) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.excluded = excluded;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.lastPass = null;
  }

  configured() {
    return Boolean(this.baseUrl && this.apiKey);
  }

  // Read one page, or throw. A non-2xx or an unparsable body is not "no posts".
  async fetchPage(view) {
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/posts?view=${view}&limit=all`, {
      headers: { accept: "application/json", authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`fider_${view}_status_${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error(`fider_${view}_not_an_array`);
    return payload;
  }

  // Bounded by timeoutMs per request, and a partial failure fails the whole
  // snapshot so the caller never reconciles against half a view.
  async fetchSnapshot() {
    if (!this.configured()) return { ok: false, reason: "not_configured", posts: [] };
    const seen = new Map();
    try {
      for (const view of VIEWS) {
        for (const post of await this.fetchPage(view)) {
          const normalized = normalizePost(post);
          if (!Number.isInteger(normalized.number) || normalized.number <= 0) continue;
          // A post that appears in two views keeps the first (broadest) view's
          // content; status is identical across views for the same post.
          if (!seen.has(normalized.number)) seen.set(normalized.number, normalized);
        }
      }
    } catch (error) {
      return { ok: false, reason: error?.message || "fetch_failed", posts: [] };
    }
    const posts = [...seen.values()]
      .filter((post) => !this.excluded.has(post.number))
      .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
    return { ok: true, posts, fetchedAt: new Date().toISOString() };
  }

  async pass(queue) {
    const snapshot = await this.fetchSnapshot();
    if (!snapshot.ok) {
      this.lastPass = { at: new Date().toISOString(), ok: false, reason: snapshot.reason };
      // The queue is deliberately untouched here: a partial snapshot must not
      // terminalize, reopen, or reset anything.
      return { ...this.lastPass, applied: 0 };
    }
    const result = queue.reconcile(snapshot.posts);
    this.lastPass = { at: new Date().toISOString(), ok: true, posts: snapshot.posts.length, applied: result.applied };
    return this.lastPass;
  }

  // Repeated passes and restarts are safe: reconcile only applies Fider state.
  // `running` ignores a tick that fires while the previous pass is still in
  // flight, so a slow Fider can never stack overlapping passes.
  start(queue) {
    if (this.timer || !this.configured()) return false;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const result = await this.pass(queue);
        if (!result.ok) this.logger.error?.(`community reconcile failed: ${result.reason}`);
      } catch (error) {
        this.lastPass = { at: new Date().toISOString(), ok: false, reason: error?.message || "reconcile_error" };
        this.logger.error?.(`community reconcile error: ${error?.message}`);
      } finally {
        this.running = false;
      }
    };
    // Boot pass first so a restart recovers missed webhooks immediately.
    void tick();
    this.timer = setInterval(() => void tick(), this.intervalMs);
    this.timer.unref?.();
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  health() {
    return {
      configured: this.configured(),
      lastPass: this.lastPass,
      running: this.running,
      intervalMs: this.intervalMs,
      excludedPosts: [...this.excluded].sort((a, b) => a - b),
    };
  }
}

module.exports = { FiderReconciler, VIEWS, DEFAULT_EXCLUDED, normalizePost, parseExcluded };
