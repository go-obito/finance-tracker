"""Dependencies for routes."""

from finance_tracker.core.database import db_manager
from finance_tracker.services import (
    AccountService,
    TransactionService,
    UserService,
)


async def get_user_service() -> UserService:
    """Dependency to inject UserService into routes."""
    async for session in db_manager.get_session():
        return UserService(session)


async def get_account_service() -> AccountService:
    """Dependency to inject AccountService into routes."""
    async for session in db_manager.get_session():
        return AccountService(session)


async def get_transaction_service() -> TransactionService:
    """Dependency to inject TransactionService into routes."""
    async for session in db_manager.get_session():
        return TransactionService(session)
