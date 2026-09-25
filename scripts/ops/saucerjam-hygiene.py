#!/usr/bin/env python3
"""SaucerJam hygiene watchdog — report-only.

Watches the full intake sequence and reports the places it silently leaks:

    Fider post -> webhook -> CommunityQueue (IN MEMORY) -> triage -> /action -> PR -> human merge

Checks (all read-only):
 1. intake lost  — a Fider post that is not in the game queue at all. The queue is an
                   in-memory Map (server/server.js: `new CommunityQueue()`), so every
                   restart or redeploy drops whatever was not yet actioned. Fider is the
                   durable source of truth; the queue is a cache.
 2. intake stuck — a queue item still `status: new` past STUCK_HOURS. Nothing in the
                   fleet calls POST /api/community/action, so the queue only drains when
                   the triage leg actually runs.
 3. stale PRs    — open PRs on the repo past PR_STALE_HOURS with nobody merging.

Contract (docs/HERMES-AUTOMATION-CONTRACT.md D3):
  exit 0 + empty stdout = healthy (Hermes stays silent)
  exit 0 + stdout       = an event (delivered verbatim)
  non-zero              = alert

Report-only: never marks an item actioned, never merges, closes, or comments. A standing
condition reports once per COOLDOWN_HOURS and again whenever its key changes, so a known
problem does not nag every 30 minutes.

Data sources that are unreachable are skipped quietly — Fider reachability is already
owned by saucerjam-fider-health, and double-alerting is worse than staying quiet.
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

STATE = os.path.expanduser("~/.hermes/data/saucerjam-hygiene-state.json")
BASE = os.environ.get("SAUCERJAM_URL", "https://qd.menezmethod.com").rstrip("/")
REPO = os.environ.get("SAUCERJAM_REPO", os.path.expanduser("~/.hermes/workspace/saucerjam-ops"))
# "local" (default): Fider and this watchdog are co-located (Oracle) — run docker
# directly via sudo. Set FIDER_HOST=user@host to check a remote Fider over ssh, as
# this ran before the Oracle migration.
FIDER_HOST = os.environ.get("FIDER_HOST", "local")
FIDER_DB = os.environ.get("FIDER_DB_CONTAINER", "database-3eryqh2shspqvr0yn8hpo2oo")
FIDER_CONTAINER = os.environ.get("FIDER_CONTAINER", "fider-3eryqh2shspqvr0yn8hpo2oo")

STUCK_HOURS = float(os.environ.get("SAUCERJAM_STUCK_HOURS", "6"))
PR_STALE_HOURS = float(os.environ.get("SAUCERJAM_PR_STALE_HOURS", "48"))
COOLDOWN_HOURS = float(os.environ.get("SAUCERJAM_HYGIENE_COOLDOWN_HOURS", "24"))
# Fider posts older than this predate the webhook and can never be "lost intake".
# 2026-09-19T16:30Z = 12:30 EDT, when FIDER_WEBHOOK_TOKEN was provisioned.
FIDER_SINCE = os.environ.get("SAUCERJAM_FIDER_SINCE", "2026-09-19T16:30:00+00:00")
# Internal smoke-test posts used to verify webhook delivery. They are not player reports
# and were never meant to be actioned, so they must not raise "lost intake" forever.
FIDER_IGNORE = {
    n.strip()
    for n in os.environ.get("SAUCERJAM_FIDER_IGNORE", "9,10").split(",")
    if n.strip()
}
MAX_LISTED = 10
REQUEST_TIMEOUT = 15


def load_env():
    """no_agent cron scripts inherit a clean environment — pull the token in."""
    if os.environ.get("COMMUNITY_ACTION_TOKEN"):
        return
    path = os.path.expanduser("~/.hermes/.env")
    if not os.path.exists(path):
        return
    with open(path) as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def now():
    return datetime.now(timezone.utc)


def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def clip(text, limit=70):
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def read_state():
    try:
        with open(STATE) as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def write_state(value):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")


def squad_queue():
    """Every item the game currently remembers, regardless of status.

    Uses curl, not urllib: qd.menezmethod.com sits behind Cloudflare, which answers
    urllib's default fingerprint with HTTP 403 `error code: 1010`.
    """
    token = os.environ.get("COMMUNITY_ACTION_TOKEN", "")
    if not token:
        return None
    try:
        result = subprocess.run(
            [
                "curl", "-fsS", "--max-time", str(REQUEST_TIMEOUT),
                f"{BASE}/api/community/queue",
                "-H", f"x-community-token: {token}",
            ],
            capture_output=True,
            text=True,
            timeout=REQUEST_TIMEOUT + 5,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout).get("items") or []
    except ValueError:
        return None


def fider_posts():
    """Fider posts created since the automation went live — the durable record.

    The floor matters: Fider also holds roadmap/seed posts written before any webhook
    existed. Those can never be "lost intake", so they are excluded. Everything after
    the floor that the queue does not hold is a genuine leak.
    """
    since = parse_time(FIDER_SINCE) or now()
    sql = (
        "select number, left(replace(title, E'\\n', ' '), 90) from posts "
        f"where created_at > to_timestamp({int(since.timestamp())}) "
        "order by number;"
    )
    inner = (
        "U=$(%s inspect %s --format '{{range .Config.Env}}{{println .}}{{end}}' "
        "| sed -n 's/^POSTGRES_USER=//p'); "
        "%s exec %s psql -U \"$U\" -d fider -tAc \"%s\""
    )
    if FIDER_HOST == "local":
        docker = "sudo -n docker"
        cmd = ["bash", "-c", inner % (docker, FIDER_DB, docker, FIDER_DB, sql)]
        timeout = 20
    else:
        docker = "docker"
        cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", FIDER_HOST,
               inner % (docker, FIDER_DB, docker, FIDER_DB, sql)]
        timeout = 35
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    posts = []
    for line in result.stdout.splitlines():
        if "|" not in line:
            continue
        number, title = line.split("|", 1)
        number = number.strip()
        if number.isdigit():
            posts.append((number, title.strip()))
    return posts


def open_pull_requests():
    """Open PRs on the repo, or None when gh is unavailable."""
    tool = subprocess.run(["bash", "-lc", "command -v gh"], capture_output=True, text=True)
    if tool.returncode != 0:
        return None
    try:
        result = subprocess.run(
            [
                "gh", "pr", "list", "--repo", "menezmethod/saucerjam", "--state", "open",
                "--json", "number,title,createdAt,isDraft,reviewDecision", "--limit", "50",
            ],
            capture_output=True,
            text=True,
            timeout=45,
            cwd=REPO if os.path.isdir(REPO) else None,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout or "[]")
    except ValueError:
        return None


def main():
    load_env()
    items = squad_queue()
    if items is None:
        return 0  # API unreachable — saucerjam-sre owns that alert.

    known = {str(item.get("id")) for item in items}
    sections = []
    stamps = {}

    recent_posts = fider_posts()
    if recent_posts is not None:
        lost = [
            (number, title)
            for number, title in recent_posts
            if number not in known and number not in FIDER_IGNORE
        ]
        if lost:
            stamps["intake_lost"] = ",".join(number for number, _ in lost)
            listed = "\n".join(f"    #{number} {clip(title)}" for number, title in lost[:MAX_LISTED])
            if len(lost) > MAX_LISTED:
                listed += f"\n    …and {len(lost) - MAX_LISTED} more"
            sections.append(
                f"• intake lost — {len(lost)} Fider post(s) not in the game queue "
                "(the queue is in-memory and drops on restart; Fider is the durable copy):\n" + listed
            )

    stuck = []
    for item in items:
        if item.get("status") != "new":
            continue
        received = parse_time(item.get("receivedAt"))
        if not received:
            continue
        age = now() - received
        if age >= timedelta(hours=STUCK_HOURS):
            stuck.append((item, age))
    if stuck:
        stamps["intake_stuck"] = ",".join(str(item.get("id")) for item, _ in stuck)
        listed = "\n".join(
            f"    #{item.get('id')} {clip(item.get('title'))} — {age.total_seconds() / 3600:.1f}h, "
            f"proposal: {item.get('proposal') or 'none'}, nobody actioned it"
            for item, age in stuck[:MAX_LISTED]
        )
        sections.append(f"• intake stuck — {len(stuck)} item(s) still `new` after {STUCK_HOURS:g}h:\n" + listed)

    pulls = open_pull_requests()
    if pulls is not None:
        stale = []
        for pull in pulls:
            created = parse_time(pull.get("createdAt"))
            if not created:
                continue
            age = now() - created
            if age >= timedelta(hours=PR_STALE_HOURS):
                stale.append((pull, age))
        if stale:
            stamps["stale_prs"] = ",".join(str(pull.get("number")) for pull, _ in stale)
            listed = "\n".join(
                f"    #{pull.get('number')} {clip(pull.get('title'))} — "
                f"{age.total_seconds() / 3600:.0f}h open, review: {pull.get('reviewDecision') or 'none'}"
                + (" (draft)" if pull.get("isDraft") else "")
                for pull, age in stale[:MAX_LISTED]
            )
            sections.append(f"• stale PR — {len(stale)} open past {PR_STALE_HOURS:g}h with no merge:\n" + listed)

    if not sections:
        if os.path.exists(STATE):
            os.remove(STATE)
        return 0

    state = read_state()
    cutoff = now() - timedelta(hours=COOLDOWN_HOURS)
    fresh = []
    for key, stamp in stamps.items():
        previous = state.get(key) or {}
        unchanged = previous.get("stamp") == stamp
        last = parse_time(previous.get("notifiedAt"))
        if unchanged and last and last > cutoff:
            continue
        fresh.append(key)
        state[key] = {"stamp": stamp, "notifiedAt": now().isoformat()}

    for key in list(state):
        if key not in stamps:
            del state[key]
    write_state(state)

    if not fresh:
        return 0

    print(f"SaucerJam hygiene — {len(sections)} issue(s)")
    print()
    print("\n".join(sections))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # never die silently in a no_agent cron
        print(f"SaucerJam hygiene error: {type(exc).__name__}: {exc}")
        sys.exit(1)
