"""Database configuration and lifecycle management."""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from .config import get_settings


class DatabaseManager:
    """Manages database engine and session lifecycle."""

    def __init__(self):
        """Initialize database manager."""
        self.engine = None
        self.async_session_factory = None

    async def init_db(self) -> None:
        """Initialize database engine and session factory."""
        settings = get_settings()
        self.engine = create_async_engine(
            settings.database_url,
            echo=settings.debug,
            future=True,
        )
        self.async_session_factory = sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )

    async def close_db(self) -> None:
        """Close database connection pool."""
        if self.engine:
            await self.engine.dispose()

    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
        """Get a database session for dependency injection."""
        if not self.async_session_factory:
            raise RuntimeError("Database not initialized. Call init_db() first.")

        async with self.async_session_factory() as session:
            yield session


# Global database manager instance
db_manager = DatabaseManager()


@asynccontextmanager
async def lifespan_context():
    """
    FastAPI lifespan context manager for startup and shutdown events.

    This manages the database engine lifecycle, ensuring proper initialization
    and cleanup of the connection pool.
    """
    # Startup
    await db_manager.init_db()
    yield
    # Shutdown
    await db_manager.close_db()
