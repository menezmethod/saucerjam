// Durable community work journal: Fider post -> queue record -> leased triage
// action. Nothing here merges, closes, or deploys.
//
// Rules enforced here (docs/COMMUNITY-LOOP-CONTRACT.md):
//   * Fail closed. A corrupt or unreadable file is never replaced with an empty
//     store; every write refuses until the file is repaired by hand, and the
//     unhealthy flag surfaces through /health.
//   * No eviction of unfinished work. Capacity refuses new intake instead.
//   * One writer owns an item at a time. Three real attempts, then dead_letter.
//   * Only Fider-verified terminal state terminalizes a post.
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const { guardPublicText, propose } = require("./community-core");

// Fider status is not a boolean: `open` returns only a subset of posts, and
// treating planned/started as terminal abandons work in progress.
const TERMINAL_STATUSES = new Set(["completed", "declined", "duplicate"]);
const WORKING_STATUSES = new Set(["planned", "started"]);
// `new` is the default Fider status, so the vocabulary has to include it: an
// API snapshot that omits the field must not blank a stored status.
const KNOWN_STATUSES = new Set(["new", "open", "planned", "started", ...TERMINAL_STATUSES]);
const TERMINAL_ACTIONS = new Set(["done", "request_info", "dead_letter"]);
const SCHEMA_VERSION = 1;
const DEFAULT_MAX_ITEMS = 5000;
const MAX_RECEIPTS = 8;

const nowIso = () => new Date().toISOString();
// Every timestamp this module writes goes through the instance clock, so a
// harness can advance time instead of sleeping through a real retry window.
const isoAt = (clock) => new Date(clock()).toISOString();
// `Number(env) || default` silently discards an explicit "0", which makes a
// tunable impossible to disable from the environment.
const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const statusOf = (post) => String(post?.status ?? "open").toLowerCase();
const isTerminalStatus = (status) => TERMINAL_STATUSES.has(String(status || "").toLowerCase());
const text = (value, limit) => guardPublicText(String(value ?? ""), { limit });
const intOrNull = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && Number.isFinite(n) ? n : null;
};

// Fider carries `createdAt` on the API shape; the webhook template does not.
// `receivedAt` stays as the fallback so webhook-only records still order
// sensibly against API-backed ones.
function sourceTime(post, fallback = null) {
  const raw = post?.createdAt ?? post?.created_at ?? null;
  const ms = raw === null ? NaN : Date.parse(raw);
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  const received = Date.parse(post?.receivedAt ?? "");
  return Number.isFinite(received) ? new Date(received).toISOString() : fallback;
}

// Namespaced so two differently-numbered Fider deliveries that share an
// internal post id cannot collide, and so a Fider id of 12 cannot answer a
// lookup for post number 12.
const legacyKey = (rawId) => (rawId ? `fider-id:${guardPublicText(String(rawId), { limit: 40 })}` : null);

// Content hash. This is what invalidates a stale lease when the reporter edits
// the post or a moderator reopens it.
function inputHashFor(post = {}) {
  const fields = [
    post.number ?? post.id ?? "",
    post.title ?? "",
    post.description ?? post.body ?? "",
    post.url ?? "",
    statusOf(post),
  ];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

function normalizeError(error) {
  const code = error?.code || error?.cause?.code || "";
  return `${error?.name || "Error"}${code ? `:${code}` : ""}`;
}

class CommunityQueue {
  constructor({ maxItems = DEFAULT_MAX_ITEMS, stateFile = null, now = () => Date.now() } = {}) {
    this.items = new Map();
    this.maxItems = Math.max(1, Number(maxItems) || DEFAULT_MAX_ITEMS);
    this.stateFile = stateFile ? path.resolve(stateFile) : null;
    this.now = now;
    // An unreadable or corrupt file latches the unhealthy flag instead of
    // throwing, because the synchronous constructors are also used by the
    // standalone game and by fixtures that never configured a store.
    this.healthy = true;
    this.loadError = null;
    this.persistError = null;
    this.dirty = false;
    this.capacityReached = false;
    this.leaseTtlMs = envNumber("COMMUNITY_LEASE_TTL_MS", 15 * 60_000);
    this.retryBaseMs = envNumber("COMMUNITY_RETRY_BASE_MS", 30_000);
    this.retryCapMs = envNumber("COMMUNITY_RETRY_CAP_MS", 60 * 60_000);
    this.maxAttempts = Math.max(1, envNumber("COMMUNITY_MAX_ATTEMPTS", 3));
    if (this.stateFile) this.load();
  }

  // --- persistence ----------------------------------------------------------

  load() {
    let raw;
    try {
      raw = fs.readFileSync(this.stateFile, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        this.items = new Map();
        this.healthy = true;
        return;
      }
      this.healthy = false;
      this.loadError = `unreadable:${normalizeError(error)}`;
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Hand-edited or truncated. Treating this as "empty" would reset attempts
      // and hand finished work back out as new, so it stays corrupt and loud.
      this.healthy = false;
      this.loadError = "corrupt:invalid_json";
      return;
    }
    if (!parsed || typeof parsed !== "object" || parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.items)) {
      this.healthy = false;
      this.loadError = "corrupt:unrecognized_schema";
      return;
    }
    // Validate before adopting: one unparsable record must not adopt a partial
    // store, because the next write would persist that partial view over the
    // operator's file.
    const records = [];
    for (const record of parsed.items) {
      if (!record || typeof record !== "object" || !this.rehydrate(record)) {
        this.healthy = false;
        this.loadError = "corrupt:bad_record";
        return;
      }
      records.push(record);
    }
    const items = new Map();
    for (const record of records) {
      const item = this.rehydrate(record);
      items.set(item.key, item);
      for (const alias of item.legacyKeys) items.set(alias, item);
    }
    this.items = items;
    this.healthy = true;
    this.loadError = null;
    this.leaseTtlMs = Number(parsed.leaseTtlMs) || this.leaseTtlMs;
    this.maxAttempts = Math.max(1, Number(parsed.maxAttempts) || this.maxAttempts);
    this.retryBaseMs = Number(parsed.retryBaseMs) || this.retryBaseMs;
    this.retryCapMs = Number(parsed.retryCapMs) || this.retryCapMs;
  }

  // Rebuild a live record. Missing or mistyped fields are normalized, never
  // trusted: this file is one an operator may repair by hand.
  rehydrate(record) {
    const key = text(record.key ?? record.number ?? record.id, 40);
    if (!key) return null;
    const title = text(record.title, 200);
    if (!title) return null;
    const number = intOrNull(record.number);
    const legacyKeys = (Array.isArray(record.legacyIds) ? record.legacyIds : [])
      .map(legacyKey)
      .filter((alias) => alias && alias !== key)
      .slice(0, 4);
    const attempts = (Array.isArray(record.attempts) ? record.attempts : [])
      .filter((attempt) => attempt && typeof attempt === "object")
      .slice(-MAX_RECEIPTS)
      .map((attempt) => ({
        at: typeof attempt.at === "string" ? attempt.at : nowIso(),
        outcome: text(attempt.outcome, 40) || "unknown",
        workerId: text(attempt.workerId, 64) || null,
      }));
    const actions = (Array.isArray(record.actions) ? record.actions : [])
      .filter((action) => action && typeof action === "object")
      .slice(-MAX_RECEIPTS)
      .map((action) => ({
        action: text(action.action, 40),
        at: typeof action.at === "string" ? action.at : nowIso(),
        detail: text(action.detail, 500) || null,
        inputHash: text(action.inputHash, 64) || null,
      }))
      .filter((action) => action.action);
    const rawLease = record.lease && typeof record.lease === "object" ? record.lease : null;
    return {
      key,
      id: key,
      number,
      legacyKeys,
      title,
      kind: text(record.kind, 24) || "question",
      description: text(record.description, 4000),
      url: /^https?:\/\//i.test(text(record.url, 400)) ? text(record.url, 400) : null,
      reference: text(record.reference, 120) || null,
      votes: Number.isFinite(Number(record.votes)) ? Number(record.votes) : 0,
      acknowledgedAt: typeof record.acknowledgedAt === "string" ? record.acknowledgedAt : null,
      // The legacy single-action shape, kept alongside `actions` so callers and
      // fixtures written against the pre-lease surface still read what happened.
      action: record.action && typeof record.action === "object" ? record.action : null,
      status: text(record.status, 24) || "new",
      fiderStatus: KNOWN_STATUSES.has(text(record.fiderStatus, 24)) ? text(record.fiderStatus, 24) : null,
      proposal: text(record.proposal, 32) || propose({ kind: text(record.kind, 24) || "question", title }),
      terminalReason: text(record.terminalReason, 240) || null,
      deadLetterReason: text(record.deadLetterReason, 240) || null,
      receivedAt: typeof record.receivedAt === "string" ? record.receivedAt : nowIso(),
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : nowIso(),
      sourceUpdatedAt: typeof record.sourceUpdatedAt === "string" ? record.sourceUpdatedAt : null,
      inputHash: text(record.inputHash, 64) || inputHashFor({ number, title, description: text(record.description, 4000), url: text(record.url, 400), status: text(record.fiderStatus, 24) }),
      staleLeaseTokenHash: text(record.staleLeaseTokenHash, 64) || null,
      attempts,
      actions,
      lease: rawLease
        ? {
            tokenHash: text(rawLease.tokenHash, 64) || null,
            workerId: text(rawLease.workerId, 64) || null,
            inputHash: text(rawLease.inputHash, 64) || null,
            attempt: Number(rawLease.attempt) || 1,
            claimedAt: typeof rawLease.claimedAt === "string" ? rawLease.claimedAt : nowIso(),
            expiresAt: typeof rawLease.expiresAt === "string" ? rawLease.expiresAt : nowIso(),
            expiredCountedAt: typeof rawLease.expiredCountedAt === "string" ? rawLease.expiredCountedAt : null,
          }
        : null,
      nextAttemptAt:
        typeof record.nextAttemptAt === "string" && Number.isFinite(Date.parse(record.nextAttemptAt))
          ? record.nextAttemptAt
          : null,
    };
  }

  serialize() {
    const seen = new Set();
    const items = [];
    for (const item of this.items.values()) {
      if (seen.has(item)) continue;
      seen.add(item);
      const { legacyKeys, ...rest } = item;
      items.push({ ...rest, legacyIds: legacyKeys.map((alias) => alias.replace(/^fider-id:/, "")) });
    }
    return {
      version: SCHEMA_VERSION,
      updatedAt: nowIso(),
      leaseTtlMs: this.leaseTtlMs,
      maxAttempts: this.maxAttempts,
      retryBaseMs: this.retryBaseMs,
      retryCapMs: this.retryCapMs,
      items,
    };
  }

  // Atomic temp+rename. The temp file lives beside the target so the rename
  // stays within one filesystem, and a failure is returned rather than thrown
  // so callers can refuse to hand out a lease they could not persist.
  write() {
    if (!this.stateFile) return true;
    if (!this.healthy) {
      this.persistError = `refused:${this.loadError || "store_unhealthy"}`;
      this.dirty = true;
      return false;
    }
    const dir = path.dirname(this.stateFile);
    const tmp = path.join(dir, `.${path.basename(this.stateFile)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const handle = fs.openSync(tmp, "w");
      try {
        fs.writeFileSync(handle, `${JSON.stringify(this.serialize())}\n`);
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(tmp, this.stateFile);
      this.persistError = null;
      this.dirty = false;
      return true;
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch {}
      this.persistError = `write_failed:${normalizeError(error)}`;
      this.dirty = true;
      return false;
    }
  }

  persist() {
    return this.write();
  }

  isHealthy() {
    return this.healthy && this.loadError === null;
  }

  uniqueItems() {
    const seen = new Set();
    const items = [];
    for (const item of this.items.values()) {
      if (seen.has(item)) continue;
      seen.add(item);
      items.push(item);
    }
    return items;
  }

  // --- status ---------------------------------------------------------------

  count({ status } = {}) {
    return this.uniqueItems().filter((item) => !status || item.status === status).length;
  }

  status() {
    let backlog = 0;
    let exhausted = 0;
    let oldestDueMs = null;
    const now = this.now();
    for (const item of this.uniqueItems()) {
      if (!TERMINAL_ACTIONS.has(item.status)) backlog++;
      if (item.status === "dead_letter") exhausted++;
      if (this.isClaimable(item, now)) {
        const at = Date.parse(item.sourceUpdatedAt || item.receivedAt);
        if (Number.isFinite(at) && (oldestDueMs === null || at < oldestDueMs)) oldestDueMs = at;
      }
    }
    return {
      healthy: this.stateFile ? this.isHealthy() : true,
      durable: Boolean(this.stateFile),
      loadError: this.loadError,
      persistError: this.persistError,
      dirty: this.dirty,
      capacityReached: this.capacityReached,
      size: this.uniqueItems().length,
      backlog,
      exhausted,
      oldestDueAt: oldestDueMs === null ? null : new Date(oldestDueMs).toISOString(),
    };
  }

  // --- intake ---------------------------------------------------------------\

  // The post number is the canonical key. The Fider internal post id stays a
  // compatibility alias so a webhook template (or a fixture) that carries only
  // `post_id` still resolves.
  static keyFor(post = {}) {
    const number = intOrNull(post.number ?? post.post_number);
    if (number !== null) return String(number);
    const id = guardPublicText(String(post.id ?? post.post_id ?? ""), { limit: 40 });
    return id || null;
  }

  ingest(post = {}) {
    const number = intOrNull(post.number ?? post.post_number);
    const rawId = guardPublicText(String(post.id ?? post.post_id ?? ""), { limit: 40 });
    const key = number !== null ? String(number) : rawId;
    if (!key) return null;
    const title = text(post.title ?? post.post_title, 200);
    if (!title) return null;
    const description = text(post.description ?? post.body ?? post.post_description, 4000);
    const rawUrl = text(post.url ?? post.post_url, 400);
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
    const fiderStatus = statusOf(post);
    const existing = this.items.get(key) || (rawId ? this.items.get(legacyKey(rawId)) : null);
    if (existing) {
      this.merge(existing, { title, description, url, fiderStatus, rawId, number, post, votes: post.votes });
      this.write();
      return existing;
    }
    const kind =
      (typeof post.kind === "string" && ["bug", "feature", "balance", "question"].includes(post.kind) && post.kind) ||
      (() => {
        const match = title.match(/^\[(bug|feature|balance|question)\]/i);
        return match ? match[1].toLowerCase() : "question";
      })();
    // Capacity refuses new intake; it never evicts. Deleting the oldest item was
    // how the previous implementation silently dropped unfinished work.
    // Finished records are retained as history, so they must not consume the
    // capacity that bounds live work.
    if (this.uniqueItems().filter((entry) => !TERMINAL_ACTIONS.has(entry.status)).length >= this.maxItems) {
      this.capacityReached = true;
      return null;
    }
    this.capacityReached = false;
    const item = {
      key,
      id: key,
      number,
      legacyKeys: rawId && rawId !== key ? [legacyKey(rawId)] : [],
      title,
      kind,
      description,
      url,
      reference: text(post.reference, 120) || null,
      votes: Number.isFinite(Number(post.votes)) ? Number(post.votes) : 0,
      status: "new",
      fiderStatus: KNOWN_STATUSES.has(fiderStatus) ? fiderStatus : null,
      proposal: propose({ kind, title }),
      acknowledgedAt: null,
      action: null,
      terminalReason: null,
      deadLetterReason: null,
      receivedAt: isoAt(this.now),
      updatedAt: isoAt(this.now),
      sourceUpdatedAt: sourceTime(post, null),
      inputHash: inputHashFor({ number, title, description, url, status: fiderStatus }),
      attempts: [],
      actions: [],
      lease: null,
      nextAttemptAt: null,
    };
    this.items.set(key, item);
    for (const alias of item.legacyKeys) this.items.set(alias, item);
    this.write();
    return item;
  }

  // A repeat delivery is a retry or a status-change webhook, not new work. Only
  // fields the delivery actually carried are refreshed, and a decision already
  // taken is never re-derived.
  merge(item, { title, description, url, fiderStatus, rawId, number, post, votes }) {
    item.title = title;
    if (description) item.description = description;
    if (url) item.url = url;
    if (number !== null) item.number = number;
    // Only a genuinely supplied count overwrites. Number(""), Number(null) and
    // Number([]) are all 0 and all finite, so a single Number.isFinite guard let
    // an explicitly empty value zero a real count.
    const votesSupplied =
      typeof votes === "number"
        ? Number.isFinite(votes)
        : typeof votes === "string" && votes.trim() !== "" && Number.isFinite(Number(votes));
    if (votesSupplied) item.votes = Number(votes);
    if (rawId && rawId !== item.key) {
      const alias = legacyKey(rawId);
      if (!item.legacyKeys.includes(alias)) {
        item.legacyKeys.push(alias);
        this.items.set(alias, item);
      }
    }
    if (KNOWN_STATUSES.has(fiderStatus)) item.fiderStatus = fiderStatus;
    const source = sourceTime(post, null);
    if (source) item.sourceUpdatedAt = source;
    item.updatedAt = isoAt(this.now);
    const nextHash = inputHashFor({
      number: item.number,
      title: item.title,
      description: item.description,
      url: item.url,
      status: item.fiderStatus,
    });
    if (nextHash !== item.inputHash) {
      // Content changed under an outstanding lease: drop the lease so the worker
      // holding it gets a conflict instead of silently completing work it never
      // saw. An already-recorded action is history and is kept; the edit is not
      // retroactively new work, and erasing the record is what made an edit look
      // like a fresh item.
      item.staleLeaseTokenHash = item.lease?.tokenHash || null;
      item.lease = null;
      item.inputHash = nextHash;
    }
    if (item.status === "new") item.proposal = propose({ kind: item.kind, title });
  }

  list({ status } = {}) {
    return this.uniqueItems().filter((item) => !status || item.status === status);
  }

  get(id) {
    return this.items.get(String(id)) || null;
  }

  // --- leases ---------------------------------------------------------------\

  attemptsUsed(item) {
    return item.attempts.length;
  }

  leaseActive(item, now = this.now()) {
    return Boolean(item.lease) && Date.parse(item.lease.expiresAt) > now;
  }

  isClaimable(item, now = this.now()) {
    if (TERMINAL_ACTIONS.has(item.status)) return false;
    if (item.lease) return false;
    if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > now) return false;
    return this.attemptsUsed(item) < this.maxAttempts;
  }

  // An expired lease is a failed attempt: the worker never came back, so the
  // item must not sit claimed forever.
  expireLease(item, now = this.now()) {
    if (!item.lease) return false;
    if (Date.parse(item.lease.expiresAt) > now) return false;
    // `expiredCountedAt` is a tombstone that survives in the stored record for
    // transparency. A settled expiry has already re-queued the item and cleared
    // the lease, so this guard only fires for an item that ignored its ceiling.
    if (!item.lease.tokenHash) return false;
    if (item.lease.expiredCountedAt) return false;
    const at = new Date(now).toISOString();
    item.attempts.push({ at, outcome: "lease_expired", workerId: item.lease.workerId });
    this.afterFailure(item, at);
    return true;
  }

  // One writer at a time. The claim is persisted BEFORE the token is returned,
  // so a crash after the response cannot leave an item claimable twice.
  claim({ workerId } = {}) {
    const worker = text(workerId, 64) || "unknown";
    if (!this.healthy) return { status: "unavailable", reason: this.loadError || "store_unhealthy" };
    let expired = false;
    for (const item of this.uniqueItems()) if (this.expireLease(item, this.now())) expired = true;
    // Read the clock after expiring, not before: an expiry that just wrote a
    // fresh backoff deadline would otherwise be compared against a stale `now`
    // and could be claimed in the same pass, defeating the backoff.
    const now = this.now();
    const eligible = this.uniqueItems().filter((item) => this.isClaimable(item, now));
    if (!eligible.length) {
      if (expired) this.write();
      return { status: "empty" };
    }
    // Oldest source time first, using Fider's createdAt when we have it, so a
    // post backfilled after a missed webhook is not served last.
    eligible.sort((a, b) => {
      const at = Date.parse(a.sourceUpdatedAt || a.receivedAt) || 0;
      const bt = Date.parse(b.sourceUpdatedAt || b.receivedAt) || 0;
      return at - bt || a.key.localeCompare(b.key);
    });
    const item = eligible[0];
    const token = randomBytes(32).toString("base64url");
    const attempt = this.attemptsUsed(item) + 1;
    item.lease = {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      workerId: worker,
      inputHash: item.inputHash,
      attempt,
      claimedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.leaseTtlMs).toISOString(),
      expiredCountedAt: null,
    };
    item.status = "in_progress";
    item.updatedAt = new Date(now).toISOString();
    if (!this.write()) {
      // A lease that did not persist must not be handed out: the worker would
      // act on work the journal cannot bound after a restart.
      item.lease = null;
      item.status = "new";
      return { status: "unavailable", reason: this.persistError || "state_write_failed" };
    }
    return { status: "claimed", item, leaseToken: token, inputHash: item.inputHash, attempt, expiresAt: item.lease.expiresAt };
  }

  // Bounded exponential backoff with jitter, or dead_letter at the ceiling.
  afterFailure(item, at) {
    if (this.attemptsUsed(item) >= this.maxAttempts) {
      item.status = "dead_letter";
      item.deadLetterReason = `attempts_exhausted:${this.attemptsUsed(item)}`;
      item.nextAttemptAt = null;
      return;
    }
    const exponent = Math.max(0, this.attemptsUsed(item) - 1);
    const base = Math.min(this.retryBaseMs * 2 ** exponent, this.retryCapMs);
    item.lease = null;
    item.status = "new";
    // Floor the wait at 1s. `Date.now()` has millisecond resolution, so a wait
    // configured down to a millisecond is a wall-clock coin flip that a retry
    // loop can win by busy-spinning.
    const wait = Math.max(1_000, base * (1.15 + Math.random() * 0.25));
    item.nextAttemptAt = new Date(Date.parse(at || isoAt(this.now)) + wait).toISOString();
  }

  // --- worker completion ----------------------------------------------------\

  // Classify a completion without mutating. Idempotent: replaying the exact
  // same completion for the same input is accepted and changes nothing, while a
  // stale, superseded, or terminal item is a conflict.
  complete({ id, action, leaseToken, inputHash } = {}) {
    const item = this.get(id);
    if (!item) return { status: "unknown" };
    if (!this.healthy) return { status: "unavailable", reason: this.loadError || "store_unhealthy" };
    if (!TERMINAL_ACTIONS.has(action) && !["actioned", "comment", "fail", "release"].includes(action))
      return { status: "unknown_action", item };
    // A field acknowledgement is a distinct receipt from a terminal discussion
    // outcome, so it is accepted without a lease: it is not a state change.
    if (action === "comment") {
      const prior = [...item.actions].reverse().find((entry) => entry.action === "comment");
      if (prior && item.lease === null) return { status: "replayed", item };
      return { status: "accepted", item, acknowledged: true };
    }
    if (TERMINAL_ACTIONS.has(item.status) || item.status === "done") return { status: "terminal", item };
    // An exact replay is checked before the lease, because the first completion
    // consumed the lease. Same input hash + same action receipt means the worker
    // is retrying a completion the journal already applied, which is a success.
    const receipt = [...item.actions].reverse().find((entry) => entry.action === action);
    if (receipt && receipt.inputHash && receipt.inputHash === inputHash && inputHash === item.inputHash)
      return { status: "replayed", item };
    if (!item.lease) {
      // A lease that was invalidated by an edit is a stale-input conflict, not a
      // missing lease: the worker did hold one, and telling it "no lease" would
      // send it hunting for a problem that is really a changed report.
      if (leaseToken && item.staleLeaseTokenHash && createHash("sha256").update(leaseToken).digest("hex") === item.staleLeaseTokenHash)
        return { status: "stale_input", item };
      return { status: "no_lease", item };
    }
    if (Date.parse(item.lease.expiresAt) <= this.now()) return { status: "expired_lease", item };
    if (typeof leaseToken !== "string" || !leaseToken) return { status: "no_lease", item };
    const presented = createHash("sha256").update(leaseToken).digest("hex");
    if (presented !== item.lease.tokenHash) return { status: "bad_lease", item };
    if (typeof inputHash === "string" && inputHash && inputHash !== item.lease.inputHash)
      return { status: "stale_input", item };
    if (item.inputHash !== item.lease.inputHash) return { status: "stale_input", item };
    const prior = [...item.actions].reverse().find((entry) => entry.action === action);
    if (prior && prior.inputHash === item.inputHash) return { status: "replayed", item };
    return { status: "accepted", item };
  }

  // Gate: an AI action may open a PR/branch, never merge or close a post.
  static allowedActions() { return ["open-fix-pr", "open-prototype-pr", "comment", "flag-duplicate", "request-info"]; }

  // Apply an accepted completion. `fixed` is deliberately unreachable at this
  // phase: only Fider-verified terminal state terminalizes a post, so a worker
  // assertion of production completion is recorded as actioned, never done.
  //
  // Two call shapes are accepted on purpose. The leased path passes a
  // transition name and an options object; the legacy path passes the worker's
  // action name in an options object (`record(id, { action, detail })`), which
  // existing callers and fixtures use.
  record(id, action, options = {}) {
    const item = this.get(id);
    if (!item) return null;
    if (action && typeof action === "object") {
      const { action: legacyAction, detail: legacyDetail } = action;
      options = { detail: legacyDetail };
      action = legacyAction === "request-info" ? "request_info"
        : legacyAction === "open-fix-pr" || legacyAction === "open-prototype-pr" ? "actioned"
        : legacyAction === "comment" || legacyAction === "flag-duplicate" ? "comment"
        : legacyAction;
    }
    const { detail = null, inputHash = null } = options || {};
    const at = isoAt(this.now);
    const receipt = (kind) => {
      item.actions.push({ action: kind, at, detail: text(detail, 500) || null, inputHash: inputHash || item.inputHash });
      if (item.actions.length > MAX_RECEIPTS) item.actions.splice(0, item.actions.length - MAX_RECEIPTS);
      item.action = { action: kind, detail: text(detail, 500) || null, at };
    };
    if (action === "comment") {
      receipt(action);
      item.acknowledgedAt = item.acknowledgedAt || at;
      item.updatedAt = at;
      this.write();
      return item;
    }
    if (action === "fail" || action === "release") {
      if (item.lease) {
        item.attempts.push({ at, outcome: action === "fail" ? "failed" : "released", workerId: item.lease.workerId });
        item.lease = null;
        this.afterFailure(item, at);
      }
      item.updatedAt = at;
      this.write();
      return item;
    }
    receipt(action);
    item.lease = null;
    item.updatedAt = at;
    if (action === "request_info") {
      item.status = "request_info";
      item.nextAttemptAt = null;
    } else if (action === "actioned" || action === "done" || action === "fixed") {
      // A worker's own claim of success is a receipt, never a terminal state.
      item.status = "actioned";
      item.nextAttemptAt = null;
    } else {
      return item;
    }
    this.write();
    return item;
  }

  actionReceipts(item) {
    return [...item.actions];
  }

  // --- reconciliation -------------------------------------------------------\

  // Derive local state from one Fider snapshot. Terminal is honored, a reopen
  // returns the item to the queue, and an edit invalidates any lease and action
  // taken against the previous content.
  reconcile(posts = []) {
    if (!this.healthy) return { applied: 0, reason: this.loadError || "store_unhealthy" };
    let applied = 0;
    for (const post of posts) {
      if (!CommunityQueue.keyFor(post)) continue;
      applied += 1;
      this.applyPost(post);
    }
    this.write();
    return { applied, total: posts.length };
  }

  applyPost(post) {
    const key = CommunityQueue.keyFor(post);
    const at = isoAt(this.now);
    let item = this.items.get(key);
    if (!item) {
      item = this.ingest(post);
      if (!item) return null;
    } else {
      const before = { title: item.title, description: item.description, url: item.url, fiderStatus: item.fiderStatus };
      this.merge(item, {
        title: text(post.title, 200) || item.title,
        description: text(post.description ?? post.body, 4000),
        url: /^https?:\/\//i.test(text(post.url, 400)) ? text(post.url, 400) : null,
        fiderStatus: statusOf(post),
        rawId: guardPublicText(String(post.id ?? ""), { limit: 40 }),
        number: intOrNull(post.number) ?? item.number,
        post,
      });
      const changed =
        before.title !== item.title ||
        before.description !== item.description ||
        before.url !== item.url ||
        before.fiderStatus !== item.fiderStatus;
      if (changed) {
        item.lease = null;
        item.attempts = [];
        item.deadLetterReason = null;
      }
    }
    const status = String(item.fiderStatus || "").toLowerCase();
    if (isTerminalStatus(status)) {
      // Only Fider's own terminal state closes work.
      item.status = "done";
      item.terminalReason = `fider:${status}`;
      item.lease = null;
      item.nextAttemptAt = null;
      item.updatedAt = at;
      return item;
    }
    // An explicit reopen or a repaired record returns to the queue even if it
    // was dead-lettered or parked waiting on the reporter.
    if (item.status === "done" || item.status === "request_info" || item.status === "dead_letter") {
      item.status = "new";
      item.deadLetterReason = null;
      item.terminalReason = null;
      item.attempts = [];
      item.nextAttemptAt = null;
    }
    if (WORKING_STATUSES.has(status) && !item.lease) item.status = item.status === "actioned" ? "actioned" : "new";
    item.updatedAt = at;
    return item;
  }
}

module.exports = {
  CommunityQueue,
  KNOWN_STATUSES,
  TERMINAL_STATUSES,
  WORKING_STATUSES,
  inputHashFor,
  isTerminalStatus,
  normalizeError,
  sourceTime,
};
