"""``python -m psycho_worker <command>``."""

from __future__ import annotations

import argparse
import getpass
import sys

from . import __version__, logs
from .config import UNOFFICIAL_TOKENS_FILE, load_settings


def _cmd_login(args: argparse.Namespace) -> int:
    """Interactive unofficial Garmin login on Paul's Mac. Handles MFA. Stores tokens locally.

    The password is read with getpass, used once, and never written anywhere. The resulting
    token JSON (DI OAuth + refresh token) is saved to ``apps/worker/.secrets/garmin_tokens.json``
    (0600, gitignored). Phase 1 adds ``--upload`` to push it into Supabase Vault.
    """
    from .garmin.unofficial import login_interactive, write_tokens_file

    if not sys.stdin.isatty():
        print(
            "login must be run in an interactive terminal (it asks for password and MFA).",
            file=sys.stderr,
        )
        return 2
    email = args.email or input("Garmin Connect email: ").strip()
    password = getpass.getpass("Garmin Connect password (not stored): ")
    try:
        tokens = login_interactive(
            email, password, prompt_mfa=lambda: input("MFA code from your email/app: ")
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Login failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        del password
    write_tokens_file(UNOFFICIAL_TOKENS_FILE, tokens)
    print(f"Saved Garmin tokens to {UNOFFICIAL_TOKENS_FILE} (owner-only permissions).")
    if args.upload:
        from .loops import push_tokens

        return push_tokens(load_settings(), tokens)
    return 0


def _cmd_push_tokens(_args: argparse.Namespace) -> int:
    """Upload the locally saved unofficial tokens to Supabase Vault."""
    from .loops import push_tokens

    if not UNOFFICIAL_TOKENS_FILE.exists():
        print("No saved tokens. Run `python -m psycho_worker login` first.", file=sys.stderr)
        return 2
    return push_tokens(load_settings(), UNOFFICIAL_TOKENS_FILE.read_text(encoding="utf-8"))


def _cmd_set_owner(args: argparse.Namespace) -> int:
    from .loops import set_owner

    return set_owner(load_settings(), args.email)


def _cmd_sync(_args: argparse.Namespace) -> int:
    from .loops import sync

    return sync(load_settings())


def _cmd_nightly(_args: argparse.Namespace) -> int:
    from .loops import nightly

    return nightly(load_settings())


def _cmd_metrics(args: argparse.Namespace) -> int:
    """Recompute activity_metrics (+ full daily_load) outside a sync run."""
    from datetime import date

    from .db import Store
    from .metrics.engine import recompute

    settings = load_settings()
    if not settings.has_supabase:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", file=sys.stderr)
        return 2
    store = Store(settings.supabase_url or "", settings.supabase_service_role_key or "")
    start = date.fromisoformat(args.since) if args.since else date(2000, 1, 1)
    counts = recompute(store, start, force=args.all)
    print(counts)
    return 0


def _cmd_lab_snapshot(_args: argparse.Namespace) -> int:
    from .db import Store
    from .labsnap import write

    settings = load_settings()
    if not settings.has_supabase:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", file=sys.stderr)
        return 2
    print(
        "Wrote", write(Store(settings.supabase_url or "", settings.supabase_service_role_key or ""))
    )
    return 0


def _cmd_backfill(args: argparse.Namespace) -> int:
    from .loops import backfill

    return backfill(load_settings(), months=args.months, resume=not args.restart)


def _cmd_audit(args: argparse.Namespace) -> int:
    from . import audit

    settings = load_settings()
    tokens = None
    if UNOFFICIAL_TOKENS_FILE.exists() and not args.official_only:
        tokens = UNOFFICIAL_TOKENS_FILE.read_text(encoding="utf-8")
    if not settings.has_official and not tokens:
        print(
            "Nothing to audit: set GARMIN_PERSONAL_API_KEY in apps/worker/.env and/or run "
            "`python -m psycho_worker login` first.",
            file=sys.stderr,
        )
        return 2
    return audit.run(settings, unofficial_tokens=tokens, days=args.days)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="psycho_worker", description="Psycho Garmin sync worker")
    p.add_argument("--version", action="version", version=f"psycho_worker {__version__}")
    p.add_argument("--json-logs", action="store_true", help="force structured JSON logs")
    sub = p.add_subparsers(dest="command", required=True)

    login = sub.add_parser("login", help="interactive Garmin Connect login (Mac only, handles MFA)")
    login.add_argument("--email", help="Garmin Connect email (prompted if omitted)")
    login.add_argument("--upload", action="store_true", help="also push tokens to Supabase Vault")
    login.set_defaults(fn=_cmd_login)

    push = sub.add_parser("push-tokens", help="upload saved Garmin tokens to Supabase Vault")
    push.set_defaults(fn=_cmd_push_tokens)

    owner = sub.add_parser("set-owner", help="set the only email allowed to sign in to the web app")
    owner.add_argument("email")
    owner.set_defaults(fn=_cmd_set_owner)

    audit = sub.add_parser(
        "audit", help="Phase 0: pull 7 days from every endpoint, write docs/DATA_AVAILABILITY.md"
    )
    audit.add_argument("--days", type=int, default=7)
    audit.add_argument("--official-only", action="store_true", help="skip the unofficial library")
    audit.set_defaults(fn=_cmd_audit)

    sub.add_parser("sync", help="incremental sync (every 30 min)").set_defaults(fn=_cmd_sync)
    sub.add_parser("nightly", help="nightly enrichment + 120-day load recompute").set_defaults(
        fn=_cmd_nightly
    )
    mt = sub.add_parser("metrics", help="recompute activity metrics and daily load")
    mt.add_argument("--since", help="only activities on/after this date (YYYY-MM-DD)")
    mt.add_argument("--all", action="store_true", help="force-recompute every activity")
    mt.set_defaults(fn=_cmd_metrics)

    sub.add_parser(
        "lab-snapshot", help="export real data to apps/web/.lab/snapshot.json for /lab (dev only)"
    ).set_defaults(fn=_cmd_lab_snapshot)

    bf = sub.add_parser("backfill", help="resumable history backfill (run on the Mac)")
    bf.add_argument("--months", type=int, default=18)
    bf.add_argument("--restart", action="store_true", help="ignore the saved checkpoint")
    bf.set_defaults(fn=_cmd_backfill)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logs.setup(json_output=True if args.json_logs else None)
    return int(args.fn(args))
