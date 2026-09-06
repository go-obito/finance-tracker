"""Repository implementations for finance models."""

from datetime import datetime
from typing import Optional

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from finance_tracker.models import Account, Transaction, User
from finance_tracker.schemas import (
    AccountCreate,
    AccountUpdate,
    TransactionCreate,
    TransactionUpdate,
    UserCreate,
    UserUpdate,
)

from .base import BaseRepository


class UserRepository(BaseRepository[User, UserCreate, UserUpdate]):
    """Repository for User model."""

    def __init__(self, session: AsyncSession):
        """Initialize user repository."""
        super().__init__(User, session)

    async def get_by_email(self, email: str) -> Optional[User]:
        """
        Retrieve a user by email.

        Args:
            email: User email address

        Returns:
            User instance or None if not found
        """
        result = await self.session.execute(
            select(self.model).where(self.model.email == email)
        )
        return result.scalars().first()


class AccountRepository(BaseRepository[Account, AccountCreate, AccountUpdate]):
    """Repository for Account model."""

    def __init__(self, session: AsyncSession):
        """Initialize account repository."""
        super().__init__(Account, session)

    async def get_user_accounts(self, user_id: int) -> list[Account]:
        """
        Retrieve all accounts for a user.

        Args:
            user_id: User ID

        Returns:
            List of Account instances
        """
        result = await self.session.execute(
            select(self.model).where(self.model.user_id == user_id)
        )
        return result.scalars().all()

    async def get_account_balance(self, account_id: int) -> Optional[float]:
        """
        Retrieve the current balance of an account.

        Args:
            account_id: Account ID

        Returns:
            Account balance or None if not found
        """
        account = await self.get_by_id(account_id)
        return account.balance if account else None

    async def update_balance(self, account_id: int, new_balance: float) -> bool:
        """
        Update account balance.

        Args:
            account_id: Account ID
            new_balance: New balance amount

        Returns:
            True if updated, False if not found
        """
        account = await self.get_by_id(account_id)
        if not account:
            return False

        account.balance = new_balance
        self.session.add(account)
        await self.session.flush()
        return True


class TransactionRepository(
    BaseRepository[Transaction, TransactionCreate, TransactionUpdate]
):
    """Repository for Transaction model."""

    def __init__(self, session: AsyncSession):
        """Initialize transaction repository."""
        super().__init__(Transaction, session)

    async def get_account_transactions(
        self, account_id: int, skip: int = 0, limit: int = 100
    ) -> list[Transaction]:
        """
        Retrieve all transactions for an account.

        Args:
            account_id: Account ID
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            List of Transaction instances
        """
        result = await self.session.execute(
            select(self.model)
            .where(self.model.account_id == account_id)
            .offset(skip)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_user_transactions(
        self, user_id: int, skip: int = 0, limit: int = 100
    ) -> list[Transaction]:
        """
        Retrieve all transactions for a user.

        Args:
            user_id: User ID
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            List of Transaction instances
        """
        result = await self.session.execute(
            select(self.model)
            .where(self.model.user_id == user_id)
            .offset(skip)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_account_statistics(
        self, account_id: int
    ) -> dict[str, float | int]:
        """
        Get income, expense, and transaction count for an account.

        Args:
            account_id: Account ID

        Returns:
            Dictionary with total_income, total_expenses, net_balance, and transaction_count
        """
        # Get total income
        income_result = await self.session.execute(
            select(func.sum(self.model.amount)).where(
                and_(
                    self.model.account_id == account_id,
                    self.model.transaction_type == "income",
                )
            )
        )
        total_income = income_result.scalar() or 0.0

        # Get total expenses
        expense_result = await self.session.execute(
            select(func.sum(self.model.amount)).where(
                and_(
                    self.model.account_id == account_id,
                    self.model.transaction_type == "expense",
                )
            )
        )
        total_expenses = expense_result.scalar() or 0.0

        # Get transaction count
        count_result = await self.session.execute(
            select(func.count(self.model.id)).where(
                self.model.account_id == account_id
            )
        )
        transaction_count = count_result.scalar() or 0

        return {
            "total_income": total_income,
            "total_expenses": total_expenses,
            "net_balance": total_income - total_expenses,
            "transaction_count": transaction_count,
        }

    async def get_transactions_by_date_range(
        self,
        account_id: int,
        start_date: datetime,
        end_date: datetime,
        skip: int = 0,
        limit: int = 100,
    ) -> list[Transaction]:
        """
        Retrieve transactions within a date range.

        Args:
            account_id: Account ID
            start_date: Start of date range
            end_date: End of date range
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            List of Transaction instances
        """
        result = await self.session.execute(
            select(self.model)
            .where(
                and_(
                    self.model.account_id == account_id,
                    self.model.transaction_date >= start_date,
                    self.model.transaction_date <= end_date,
                )
            )
            .offset(skip)
            .limit(limit)
        )
        return result.scalars().all()

    async def get_transactions_by_category(
        self, account_id: int, category: str, skip: int = 0, limit: int = 100
    ) -> list[Transaction]:
        """
        Retrieve transactions by category.

        Args:
            account_id: Account ID
            category: Transaction category
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            List of Transaction instances
        """
        result = await self.session.execute(
            select(self.model)
            .where(
                and_(
                    self.model.account_id == account_id,
                    self.model.category == category,
                )
            )
            .offset(skip)
            .limit(limit)
        )
        return result.scalars().all()
