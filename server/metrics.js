// Prometheus exposition metrics for SRE + AI monitoring.
// No external client library: the exposition format is plain text.
// scrape_config lives in docs/SRE.md (Pi5 Prometheus 192.168.0.207).
const os = require("node:os");
const { createHash } = require("node:crypto");

const ESCAPE = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const LABELS = (labels) => {
  const entries = Object.entries(labels || {}).filter(([, v]) => v !== undefined && v !== null);
  if (!entries.length) return "";
  return "{" + entries.map(([k, v]) => `${k}="${ESCAPE(v)}"`).join(",") + "}";
};

class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this.counters = new Map();   // name -> { help, type, values: Map<labelKey, {labels, value}> }
    this.gauges = new Map();
    this.histograms = new Map(); // name -> { help, buckets, values: Map<labelKey,{labels,counts,sum,total}> }
    this.tokens = new Map();     // hashed profile token -> last-seen ms (retention)
    // Default application-relevant buckets (seconds): sub-ms auth to multi-second round saves.
    this.httpDuration = this.histogram("saucerjam_http_request_duration_seconds", "HTTP request duration in seconds", [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
    this.wsRtt = this.histogram("saucerjam_ws_round_trip_seconds", "Client-reported websocket ping in seconds", [0.02, 0.05, 0.09, 0.15, 0.25, 0.5, 1]);
  }
  counter(name, help, type = "counter") {
    if (!this.counters.has(name)) this.counters.set(name, { help, type, values: new Map() });
    return { add: (labels = {}, delta = 1) => this._add(name, labels, delta) };
  }
  gauge(name, help) {
    if (!this.gauges.has(name)) this.gauges.set(name, { help, values: new Map() });
    return { set: (labels = {}, value) => this._set(name, labels, value) };
  }
  histogram(name, help, buckets) {
    if (!this.histograms.has(name)) this.histograms.set(name, { help, buckets: [...buckets].sort((a, b) => a - b), values: new Map() });
    return { observe: (labels = {}, value) => this._observe(name, labels, value) };
  }
  _key(labels) { return JSON.stringify(Object.entries(labels || {}).sort()); }
  _add(name, labels, delta) {
    const metric = this.counters.get(name); if (!metric) return;
    const key = this._key(labels);
    const entry = metric.values.get(key) || { labels, value: 0 };
    entry.value += delta; metric.values.set(key, entry);
  }
  _set(name, labels, value) {
    const metric = this.gauges.get(name); if (!metric) return;
    metric.values.set(this._key(labels), { labels, value });
  }
  _observe(name, labels, value) {
    const metric = this.histograms.get(name); if (!metric || !Number.isFinite(value)) return;
    const key = this._key(labels);
    const entry = metric.values.get(key) || { labels, counts: new Array(metric.buckets.length).fill(0), sum: 0, total: 0 };
    // Store each observation in its first matching bucket only; values above
    // the largest finite bucket have no finite bucket and count toward +Inf
    // (entry.total) alone. render() accumulates for the exposition format.
    for (let i = 0; i < metric.buckets.length; i++) if (value <= metric.buckets[i]) { entry.counts[i]++; break; }
    entry.sum += value; entry.total++; metric.values.set(key, entry);
  }
  // Retention: distinct hashed pilot tokens seen in the last 7 days.
  seeToken(token) {
    if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{20,128}$/.test(token)) return;
    this.tokens.set(createHash("sha256").update(token).digest("hex"), Date.now());
  }
  distinctTokens(windowMs = 7 * 24 * 60 * 60_000) {
    const cutoff = Date.now() - windowMs;
    let n = 0;
    for (const [hash, at] of this.tokens) { if (at >= cutoff) n++; else if (this.tokens.size > 50_000) this.tokens.delete(hash); }
    return n;
  }
  render({ extraGauges = [] } = {}) {
    const lines = [];
    const fmt = (v) => Number.isFinite(v) ? v : 0;
    for (const [name, metric] of this.counters) {
      lines.push(`# HELP ${name} ${metric.help}`, `# TYPE ${name} ${metric.type}`);
      for (const { labels, value } of metric.values.values()) lines.push(`${name}${LABELS(labels)} ${fmt(value)}`);
    }
    for (const [name, metric] of this.gauges) {
      lines.push(`# HELP ${name} ${metric.help}`, `# TYPE ${name} gauge`);
      for (const { labels, value } of metric.values.values()) lines.push(`${name}${LABELS(labels)} ${fmt(value)}`);
    }
    for (const [name, metric] of this.histograms) {
      lines.push(`# HELP ${name} ${metric.help}`, `# TYPE ${name} histogram`);
      for (const entry of metric.values.values()) {
        let cumulative = 0;
        for (let i = 0; i < metric.buckets.length; i++) {
          cumulative += entry.counts[i];
          lines.push(`${name}_bucket${LABELS({ ...entry.labels, le: metric.buckets[i] })} ${cumulative}`);
        }
        lines.push(`${name}_bucket${LABELS({ ...entry.labels, le: "+Inf" })} ${entry.total}`);
        lines.push(`${name}_sum${LABELS(entry.labels)} ${entry.sum}`);
        lines.push(`${name}_count${LABELS(entry.labels)} ${entry.total}`);
      }
    }
    for (const gauge of extraGauges) lines.push(gauge);
    const mem = process.memoryUsage();
    lines.push(
      "# HELP saucerjam_process_uptime_seconds Process uptime in seconds", "# TYPE saucerjam_process_uptime_seconds gauge",
      `saucerjam_process_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`,
      "# HELP saucerjam_process_resident_memory_bytes Resident memory", "# TYPE saucerjam_process_resident_memory_bytes gauge",
      `saucerjam_process_resident_memory_bytes ${mem.rss}`,
      "# HELP saucerjam_process_heap_bytes Heap used", "# TYPE saucerjam_process_heap_bytes gauge",
      `saucerjam_process_heap_bytes ${mem.heapUsed}`,
      "# HELP saucerjam_system_load1 One-minute load average", "# TYPE saucerjam_system_load1 gauge",
      `saucerjam_system_load1 ${os.loadavg()[0]}`,
      "# HELP saucerjam_distinct_pilots_7d Distinct pilot tokens seen in trailing 7 days", "# TYPE saucerjam_distinct_pilots_7d gauge",
      `saucerjam_distinct_pilots_7d ${this.distinctTokens()}`,
    );
    return lines.join("\n") + "\n";
  }
}
module.exports = { Metrics };
