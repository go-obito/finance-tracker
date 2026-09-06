"""Application configuration."""

import os
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings."""

    # Database
    database_url: str = os.getenv(
        "DATABASE_URL", "sqlite+aiosqlite:///./finance_tracker.db"
    )

    # Application
    app_name: str = "Finance Tracker"
    app_version: str = "0.1.0"
    debug: bool = os.getenv("DEBUG", "false").lower() == "true"

    class Config:
        """Pydantic config."""

        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    """Get application settings."""
    return Settings()
