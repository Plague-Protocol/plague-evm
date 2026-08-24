#!/usr/bin/env python3
"""
Lighthouse data-transfer-plan watchdog.

Why this exists
---------------
The Lighthouse plan meters OUTBOUND traffic against a monthly package
(512 GB, resetting on the 8th at 13:27 local). When the package empties the
instance's public networking is throttled/cut — which takes api.zplague.xyz
down with it. On 2026-08-24 the plan hit 92.2% with 15 days left in the cycle;
the cause was a co-tenant process (the liquidation bot) burning ~40 GB/day
while the whole Plague stack uses ~0.75 GB/day.

Tencent's own alarm only fires at 10% remaining, which at a runaway burn rate
is a few hours of warning. This samples the local interface counter instead, so
it can see a burn-rate change on the hour it starts rather than a fortnight
later when the budget is already gone.

Reads eth0's transmit counter, tracks usage across the billing cycle, and pages
over Telegram (reusing the backend ops-watchdog bot) when either the remaining
budget or the projected end-of-cycle total crosses a threshold.

Install (as ubuntu on the VPS):
    mkdir -p ~/.egress-watch
    # Seed with the CONSOLE's authoritative used figure, once:
    SEED_USED_GB=471.9 python3 /opt/plague/deploy/egress-watch.py --seed
    # then hourly:
    #   17 * * * * /usr/bin/python3 /opt/plague/deploy/egress-watch.py >> /home/ubuntu/.egress-watch/watch.log 2>&1

The counter is monotonic per boot, so a reboot is detected via boot_id and the
post-reboot counter is treated as a fresh delta rather than a huge negative one.
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

# ── Plan configuration ──────────────────────────────────────────────────────
PLAN_GB = float(os.environ.get("PLAN_GB", 512))
IFACE = os.environ.get("IFACE", "eth0")
# Data-transfer plan resets monthly on this day/time, local (Asia/Shanghai).
# From the console: "Data transfer plan reset time: 2026-09-08 13:27:07".
RESET_DAY = int(os.environ.get("RESET_DAY", 8))
RESET_HOUR = int(os.environ.get("RESET_HOUR", 13))
RESET_MIN = int(os.environ.get("RESET_MIN", 27))

# ── Alert thresholds ────────────────────────────────────────────────────────
# Absolute floor: page regardless of trend.
CRIT_REMAINING_GB = float(os.environ.get("CRIT_REMAINING_GB", 8))
WARN_REMAINING_GB = float(os.environ.get("WARN_REMAINING_GB", 20))
# Burn rate that would be abnormal for the Plague stack alone (~0.75 GB/day).
# 2.5 GB/day means something new is running — the earliest useful signal.
WARN_BURN_GB_DAY = float(os.environ.get("WARN_BURN_GB_DAY", 2.5))
ALERT_COOLDOWN_S = int(os.environ.get("ALERT_COOLDOWN_S", 6 * 3600))

STATE_DIR = Path(os.environ.get("STATE_DIR", "/home/ubuntu/.egress-watch"))
STATE_FILE = STATE_DIR / "state.json"
ENV_FILE = Path(os.environ.get("PLAGUE_ENV", "/opt/plague/deploy/.env"))

GB = 1_000_000_000  # Lighthouse bills in decimal GB, matching the console


def tx_bytes(iface: str) -> int:
    """Transmit-byte counter for `iface` from /proc/net/dev."""
    with open("/proc/net/dev") as fh:
        for line in fh:
            name, _, rest = line.partition(":")
            if name.strip() == iface:
                return int(rest.split()[8])
    raise SystemExit(f"interface {iface} not found in /proc/net/dev")


def boot_id() -> str:
    return Path("/proc/sys/kernel/random/boot_id").read_text().strip()


def next_reset(after: datetime) -> datetime:
    """First plan reset strictly after `after`."""
    candidate = after.replace(
        day=RESET_DAY, hour=RESET_HOUR, minute=RESET_MIN, second=0, microsecond=0
    )
    if candidate <= after:
        # Roll into next month without a calendar dependency.
        year, month = candidate.year, candidate.month + 1
        if month > 12:
            year, month = year + 1, 1
        candidate = candidate.replace(year=year, month=month)
    return candidate


def read_env(path: Path) -> dict:
    """Parse a KEY=VALUE .env well enough to pull the Telegram credentials."""
    out = {}
    try:
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip("'\"")
    except OSError:
        pass
    return out


def notify(text: str) -> None:
    """Page over Telegram, reusing the backend ops-watchdog bot + recipients."""
    env = read_env(ENV_FILE)
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    ids = [i.strip() for i in env.get("OPS_ALERT_TELEGRAM_IDS", "").split(",") if i.strip()]
    if not token or not ids:
        print("  (no telegram credentials — alert not sent)")
        return
    for chat_id in ids:
        payload = urllib.parse.urlencode(
            {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
        ).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage", data=payload
        )
        try:
            urllib.request.urlopen(req, timeout=15).read()
        except Exception as exc:  # noqa: BLE001 - never let alerting kill the check
            print(f"  telegram send failed for {chat_id}: {exc}")


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_FILE)


def seed() -> None:
    """Anchor the counter to the console's authoritative used figure."""
    used_gb = float(os.environ["SEED_USED_GB"])
    now = datetime.now()
    save_state(
        {
            "used_bytes": used_gb * GB,
            "last_tx": tx_bytes(IFACE),
            "boot_id": boot_id(),
            "cycle_reset": next_reset(now).isoformat(),
            "samples": [[now.timestamp(), used_gb * GB]],
            "last_alert": 0,
        }
    )
    print(f"seeded: {used_gb:.1f} GB used, cycle resets {next_reset(now):%Y-%m-%d %H:%M}")


def main() -> None:
    if "--seed" in sys.argv:
        return seed()

    state = load_state()
    if not state:
        raise SystemExit("no state file — run once with SEED_USED_GB=<n> --seed")

    now = datetime.now()
    cur_tx, cur_boot = tx_bytes(IFACE), boot_id()

    # A reboot resets /proc counters, so the current value IS the delta.
    delta = cur_tx if cur_boot != state.get("boot_id") else max(0, cur_tx - state["last_tx"])

    reset_at = datetime.fromisoformat(state["cycle_reset"])
    if now >= reset_at:
        # New billing cycle: the package refills.
        state["used_bytes"] = 0
        state["samples"] = []
        reset_at = next_reset(now)
        state["cycle_reset"] = reset_at.isoformat()
        print(f"cycle rolled over — next reset {reset_at:%Y-%m-%d %H:%M}")

    used = state["used_bytes"] + delta
    state.update({"used_bytes": used, "last_tx": cur_tx, "boot_id": cur_boot})

    # Keep a 48h ring of samples so burn rate is measured, not assumed.
    samples = [s for s in state.get("samples", []) if now.timestamp() - s[0] < 48 * 3600]
    samples.append([now.timestamp(), used])
    state["samples"] = samples

    burn_gb_day = 0.0
    if len(samples) >= 2:
        span_s = samples[-1][0] - samples[0][0]
        if span_s > 600:  # need a meaningful window before trusting the slope
            burn_gb_day = (samples[-1][1] - samples[0][1]) / GB / (span_s / 86400)

    used_gb = used / GB
    remaining_gb = PLAN_GB - used_gb
    days_left = max(0.0, (reset_at - now).total_seconds() / 86400)
    projected_gb = used_gb + burn_gb_day * days_left
    budget_gb_day = remaining_gb / days_left if days_left > 0 else float("inf")

    print(
        f"{now:%Y-%m-%d %H:%M} used={used_gb:.1f}/{PLAN_GB:.0f}GB "
        f"remaining={remaining_gb:.1f}GB burn={burn_gb_day:.2f}GB/day "
        f"budget={budget_gb_day:.2f}GB/day days_left={days_left:.1f} "
        f"projected={projected_gb:.1f}GB"
    )

    reasons = []
    if remaining_gb < CRIT_REMAINING_GB:
        reasons.append(f"CRITICAL: only {remaining_gb:.1f} GB left")
    elif remaining_gb < WARN_REMAINING_GB:
        reasons.append(f"remaining down to {remaining_gb:.1f} GB")
    if burn_gb_day > WARN_BURN_GB_DAY:
        reasons.append(
            f"burn {burn_gb_day:.2f} GB/day is above the {WARN_BURN_GB_DAY} GB/day "
            f"norm — something new may be running"
        )
    if projected_gb > PLAN_GB and days_left > 0:
        reasons.append(
            f"projected {projected_gb:.0f} GB by reset — would exhaust the plan "
            f"and take api.zplague.xyz down"
        )

    if reasons and now.timestamp() - state.get("last_alert", 0) > ALERT_COOLDOWN_S:
        notify(
            "<b>⚠️ Lighthouse egress warning</b>\n"
            + "\n".join(f"• {r}" for r in reasons)
            + f"\n\nUsed <b>{used_gb:.1f}/{PLAN_GB:.0f} GB</b> "
            f"({used_gb / PLAN_GB * 100:.1f}%)\n"
            f"Burn <b>{burn_gb_day:.2f} GB/day</b> vs budget "
            f"<b>{budget_gb_day:.2f} GB/day</b>\n"
            f"Plan resets {reset_at:%Y-%m-%d %H:%M} ({days_left:.1f} days)\n\n"
            f"Check: <code>ssh lighthouse 'pm2 list; docker stats --no-stream'</code>"
        )
        state["last_alert"] = now.timestamp()
        print(f"  ALERTED: {'; '.join(reasons)}")

    save_state(state)


if __name__ == "__main__":
    main()
