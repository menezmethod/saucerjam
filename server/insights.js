// Behavioural analytics: friction and struggle signals, aggregated server-side.
// Privacy: no identifiers, no free text, no per-user history. Only counters of
// event names + coarse buckets. This is what lets the loop *detect* a problem
// (e.g. players stuck in the lobby, dying without firing, opening the menu
// repeatedly) before it is ever reported on Fider.
const { ESCAPE } = require("./metrics");

// Bound the number of distinct series this anonymous endpoint can create.
const MAX_SERIES = 200;

const EVENT_ALLOW = new Set([
  "landing_view",
  "practice_start",
  "online_start",
  "practice_quit",
  "touch_guide_shown",
  "touch_guide_dismissed",
  "menu_opened",
  "menu_opened_repeatedly",
  "help_opened",
  "report_opened",
  "no_aim_fire",          // fired without ever moving the aim/pointer
  "stuck_no_input",       // joined but sent no movement for 10s
  "died_without_kill",    // died before scoring a kill
  "low_hull_death",
  "controls_struggle",    // repeatedly died within 3s of spawn
  "chat_opened",
  "map_changed",
  "weapon_cycled"
]);
const clean = (v, limit) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit) : "");
const finiteBucket = (v, buckets) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "unknown";
  for (const b of buckets) if (n <= b) return `<=${b}`;
  return `>${buckets[buckets.length - 1]}`;
};

class Insights {
  constructor() {
    this.counts = new Map();   // "event|device|platform" -> count
    this.sessions = 0;
  }
  track({ event, device, platform } = {}) {
    if (!EVENT_ALLOW.has(event)) return false;
    let key = `${event}|${clean(device, 16) || "unknown"}|${clean(platform, 16) || "unknown"}`;
    // device and platform are caller-supplied and this endpoint is anonymous, so
    // without a cap an attacker mints a new series per request indefinitely.
    // Past the cap every new combination folds into one bucket.
    if (!this.counts.has(key) && this.counts.size >= MAX_SERIES) key = `${event}|other|other`;
    this.counts.set(key, (this.counts.get(key) || 0) + 1);
    return true;
  }
  beginSession() { this.sessions++; }
  render() {
    const lines = [];
    const rows = new Map();
    for (const [key, value] of this.counts) {
      const [event, device, platform] = key.split("|");
      // Label values MUST be escaped. An unescaped `"` here emits a line that is
      // not valid exposition, and Prometheus rejects the whole scrape on one bad
      // line — so a single anonymous request could blind every dashboard, alert
      // and health signal for the lifetime of this process.
      lines.push(`insight_events_total{event="${ESCAPE(event)}",device="${ESCAPE(device)}",platform="${ESCAPE(platform)}"} ${value}`);
      rows.set(event, (rows.get(event) || 0) + value);
    }
    // Denominator: sessions when known, else total game starts, so the rate is
    // still meaningful on a server that only sees landing-page traffic. Clamped
    // to 1 so it reads as "share of sessions that hit this signal".
    const starts = (rows.get("practice_start") || 0) + (rows.get("online_start") || 0);
    const total = this.sessions || starts || 1;
    const rate = (e) => Math.min(1, (rows.get(e) || 0) / total);
    lines.push(
      `insight_sessions_total ${this.sessions}`,
      `insight_friction_ratio{signal="menu_repeat_per_session"} ${rate("menu_opened_repeatedly")}`,
      `insight_friction_ratio{signal="no_aim_fire_per_session"} ${rate("no_aim_fire")}`,
      `insight_friction_ratio{signal="stuck_no_input_per_session"} ${rate("stuck_no_input")}`,
      `insight_friction_ratio{signal="died_without_kill_per_session"} ${rate("died_without_kill")}`,
      `insight_friction_ratio{signal="controls_struggle_per_session"} ${rate("controls_struggle")}`,
      `insight_guides_dismissed_total ${rows.get("touch_guide_dismissed") || 0}`,
    );
    return lines.join("\n");
  }
}
module.exports = { Insights, EVENT_ALLOW };
