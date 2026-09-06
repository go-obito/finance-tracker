"""Dependency injection for FastAPI."""

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from finance_tracker.core.database import db_manager
from finance_tracker.services import (
    AccountService,
    TransactionService,
    UserService,
)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency to inject database session into routes.

    Yields:
        AsyncSession for database operations
    """
    async for session in db_manager.get_session():
        yield session


async def get_user_service(
    session: AsyncSession = None,
) -> UserService:
    """
    Dependency to inject UserService into routes.

    Args:
        session: Database session (injected by FastAPI)

    Returns:
        UserService instance
    """
    if session is None:
        async for session in db_manager.get_session():
            break
    return UserService(session)


async def get_account_service(
    session: AsyncSession = None,
) -> AccountService:
    """
    Dependency to inject AccountService into routes.

    Args:
        session: Database session (injected by FastAPI)

    Returns:
        AccountService instance
    """
    if session is None:
        async for session in db_manager.get_session():
            break
    return AccountService(session)


async def get_transaction_service(
    session: AsyncSession = None,
) -> TransactionService:
    """
    Dependency to inject TransactionService into routes.

    Args:
        session: Database session (injected by FastAPI)

    Returns:
        TransactionService instance
    """
    if session is None:
        async for session in db_manager.get_session():
            break
    return TransactionService(session)
