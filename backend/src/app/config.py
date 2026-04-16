"""Typed settings loaded from environment (Railway env vars in prod, .env locally).

Do NOT read os.environ anywhere else in the codebase — always go through `settings`.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- App ----
    app_env: Literal["development", "staging", "production"] = "development"
    app_name: str = "receivables-ageing-dashboard"
    app_log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    app_base_url: str = "http://localhost:8000"

    # ---- Database ----
    database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@localhost:5432/receivables",
        description="SQLAlchemy-style DSN. Railway sets DATABASE_URL automatically.",
    )

    # ---- Session / cookies (§11) ----
    session_secret: str = Field(default="dev-insecure-please-replace")
    session_max_age_seconds: int = 43_200  # 12h idle
    session_cookie_secure: bool = False

    # ---- Google Workspace SSO (D4) ----
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    google_oauth_allowed_domain: str = "emb.global"
    google_oauth_redirect_uri: str = "http://localhost:8000/auth/google/callback"

    # ---- Email provider (D22) ----
    email_provider: Literal["resend", "sendgrid"] = "resend"
    resend_api_key: str = ""
    sendgrid_api_key: str = ""
    smtp_from_address: str = "receivables-bot@emb.global"
    smtp_from_name: str = "EMB Receivables"

    # ---- Scheduler (§8.1 — IST 09:00 = UTC 03:30) ----
    digest_cron_utc: str = "30 3 * * 1-5"
    scheduler_timezone: str = "UTC"

    # ---- Object storage (optional) ----
    s3_bucket: str = ""
    s3_region: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""

    # ---- Rate limiting ----
    rate_limit_per_minute: int = 60

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached singleton. Import and call as `get_settings()` everywhere."""
    return Settings()
