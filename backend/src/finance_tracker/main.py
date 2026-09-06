"""FastAPI application factory."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from finance_tracker.api.routes import router
from finance_tracker.core.config import get_settings
from finance_tracker.core.database import db_manager, lifespan_context
from finance_tracker.models import Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager.

    Handles startup and shutdown events including:
    - Database engine initialization
    - Table creation
    - Connection pool setup
    - Graceful shutdown
    """
    # Startup
    settings = get_settings()
    await db_manager.init_db()

    # Create all tables
    async with db_manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    # Shutdown
    await db_manager.close_db()


def create_app() -> FastAPI:
    """
    Create and configure FastAPI application.

    Returns:
        Configured FastAPI application instance
    """
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="A production-ready finance tracker with clean architecture",
        lifespan=lifespan,
    )

    # Include routers
    app.include_router(router)

    @app.get("/health", tags=["health"])
    async def health_check():
        """Health check endpoint."""
        return {"status": "ok", "app": settings.app_name}

    return app
