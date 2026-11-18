"""Environment and path configuration for the worker.

Secrets come from the environment (GitHub Actions secrets in the cloud, ``apps/worker/.env``
on Paul's Mac). Nothing here is ever logged; see ``logs.mask``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

WORKER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = WORKER_DIR.parent.parent
FIXTURES_DIR = REPO_DIR / "fixtures"
DOCS_DIR = REPO_DIR / "docs"

# Unsanitised Phase 0 pulls. Gitignored. Never copied into fixtures/ without sanitising.
RAW_DIR = WORKER_DIR / ".raw"

# Local secret files (gitignored). The unofficial tokens live here until they are pushed to
# Supabase Vault in Phase 1; the official bearer-token cache stays local-only on the Mac.
SECRETS_DIR = WORKER_DIR / ".secrets"
UNOFFICIAL_TOKENS_FILE = SECRETS_DIR / "garmin_tokens.json"
OFFICIAL_BEARER_CACHE_FILE = SECRETS_DIR / "garmin_personal_bearer.json"

TIMEZONE = "Asia/Manila"


@dataclass(frozen=True)
class Settings:
    garmin_personal_api_key: str | None
    supabase_url: str | None
    supabase_service_role_key: str | None
    github_actions: bool

    @property
    def has_official(self) -> bool:
        return bool(self.garmin_personal_api_key)

    @property
    def has_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)


def load_settings() -> Settings:
    load_dotenv(WORKER_DIR / ".env", override=False)
    return Settings(
        garmin_personal_api_key=_clean(os.environ.get("GARMIN_PERSONAL_API_KEY")),
        supabase_url=_clean(os.environ.get("SUPABASE_URL")),
        supabase_service_role_key=_clean(os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
        github_actions=os.environ.get("GITHUB_ACTIONS") == "true",
    )


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None
