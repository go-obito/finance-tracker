"""Business logic layer for finance operations."""

from datetime import datetime
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from finance_tracker.core.exceptions import (
    ResourceNotFoundError,
    ValidationError,
)
from finance_tracker.repositories import (
    AccountRepository,
    TransactionRepository,
    UserRepository,
)
from finance_tracker.schemas import (
    AccountCreate,
    AccountResponse,
    AccountUpdate,
    TransactionCreate,
    TransactionResponse,
    TransactionUpdate,
    UserCreate,
    UserResponse,
    UserUpdate,
)


class UserService:
    """Service for user-related business logic."""

    def __init__(self, session: AsyncSession):
        """
        Initialize user service.

        Args:
            session: AsyncSession for database operations
        """
        self.repository = UserRepository(session)

    async def create_user(self, user_in: UserCreate) -> UserResponse:
        """
        Create a new user with validation.

        Args:
            user_in: User creation schema

        Returns:
            UserResponse schema

        Raises:
            ValidationError: If user already exists
        """
        # Check if user with email already exists
        if await self.repository.get_by_email(user_in.email):
            raise ValidationError(f"User with email {user_in.email} already exists")

        user = await self.repository.create(user_in)
        return UserResponse.model_validate(user)

    async def get_user(self, user_id: int) -> UserResponse:
        """
        Retrieve a user by ID.

        Args:
            user_id: User ID

        Returns:
            UserResponse schema

        Raises:
            ResourceNotFoundError: If user not found
        """
        user = await self.repository.get_by_id(user_id)
        if not user:
            raise ResourceNotFoundError(f"User with ID {user_id} not found")
        return UserResponse.model_validate(user)

    async def get_user_by_email(self, email: str) -> Optional[UserResponse]:
        """
        Retrieve a user by email.

        Args:
            email: User email

        Returns:
            UserResponse schema or None if not found
        """
        user = await self.repository.get_by_email(email)
        return UserResponse.model_validate(user) if user else None

    async def update_user(self, user_id: int, user_in: UserUpdate) -> UserResponse:
        """
        Update a user.

        Args:
            user_id: User ID
            user_in: User update schema

        Returns:
            UserResponse schema

        Raises:
            ResourceNotFoundError: If user not found
        """
        user = await self.repository.update(user_id, user_in)
        if not user:
            raise ResourceNotFoundError(f"User with ID {user_id} not found")
        return UserResponse.model_validate(user)

    async def delete_user(self, user_id: int) -> bool:
        """
        Delete a user.

        Args:
            user_id: User ID

        Returns:
            True if deleted

        Raises:
            ResourceNotFoundError: If user not found
        """
        deleted = await self.repository.delete(user_id)
        if not deleted:
            raise ResourceNotFoundError(f"User with ID {user_id} not found")
        return deleted


class AccountService:
    """Service for account-related business logic."""

    def __init__(self, session: AsyncSession):
        """
        Initialize account service.

        Args:
            session: AsyncSession for database operations
        """
        self.account_repo = AccountRepository(session)
        self.user_repo = UserRepository(session)

    async def create_account(
        self, user_id: int, account_in: AccountCreate
    ) -> AccountResponse:
        """
        Create a new account for a user.

        Args:
            user_id: User ID
            account_in: Account creation schema

        Returns:
            AccountResponse schema

        Raises:
            ResourceNotFoundError: If user not found
        """
        # Verify user exists
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise ResourceNotFoundError(f"User with ID {user_id} not found")

        account = await self.account_repo.create(
            AccountCreate(
                **account_in.model_dump(),
                user_id=user_id,
            )
        )
        return AccountResponse.model_validate(account)

    async def get_account(self, account_id: int) -> AccountResponse:
        """
        Retrieve an account by ID.

        Args:
            account_id: Account ID

        Returns:
            AccountResponse schema

        Raises:
            ResourceNotFoundError: If account not found
        """
        account = await self.account_repo.get_by_id(account_id)
        if not account:
            raise ResourceNotFoundError(f"Account with ID {account_id} not found")
        return AccountResponse.model_validate(account)

    async def get_user_accounts(self, user_id: int) -> list[AccountResponse]:
        """
        Retrieve all accounts for a user.

        Args:
            user_id: User ID

        Returns:
            List of AccountResponse schemas

        Raises:
            ResourceNotFoundError: If user not found
        """
        # Verify user exists
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise ResourceNotFoundError(f"User with ID {user_id} not found")

        accounts = await self.account_repo.get_user_accounts(user_id)
        return [AccountResponse.model_validate(account) for account in accounts]

    async def update_account(
        self, account_id: int, account_in: AccountUpdate
    ) -> AccountResponse:
        """
        Update an account.

        Args:
            account_id: Account ID
            account_in: Account update schema

        Returns:
            AccountResponse schema

        Raises:
            ResourceNotFoundError: If account not found
        """
        account = await self.account_repo.update(account_id, account_in)
        if not account:
            raise ResourceNotFoundError(f"Account with ID {account_id} not found")
        return AccountResponse.model_validate(account)

    async def delete_account(self, account_id: int) -> bool:
        """
        Delete an account.

        Args:
            account_id: Account ID

        Returns:
            True if deleted

        Raises:
            ResourceNotFoundError: If account not found
        """
        deleted = await self.account_repo.delete(account_id)
        if not deleted:
            raise ResourceNotFoundError(f"Account with ID {account_id} not found")
        return deleted


class TransactionService:
    """Service for transaction-related business logic."""

    def __init__(self, session: AsyncSession):
        """
        Initialize transaction service.

        Args:
            session: AsyncSession for database operations
        """
        self.transaction_repo = TransactionRepository(session)
        self.account_repo = AccountRepository(session)
        self.user_repo = UserRepository(session)

    async def create_transaction(
        self, user_id: int, account_id: int, transaction_in: TransactionCreate
    ) -> TransactionResponse:
        """
        Create a new transaction with balance updates.

        Args:
            user_id: User ID
            account_id: Account ID
            transaction_in: Transaction creation schema

        Returns:
            TransactionResponse schema

        Raises:
            ResourceNotFoundError: If user or account not found
            ValidationError: If validation fails
        """
        # Verify user exists
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise ResourceNotFoundError(f"User with ID {user_id} not found")

        # Verify account exists and belongs to user
        account = await self.account_repo.get_by_id(account_id)
        if not account:
            raise ResourceNotFoundError(f"Account with ID {account_id} not found")
        if account.user_id != user_id:
            raise ValidationError("Account does not belong to user")

        # Validate transaction type
        if transaction_in.transaction_type not in ["income", "expense"]:
            raise ValidationError("Transaction type must be 'income' or 'expense'")

        # Create transaction
        transaction_data = transaction_in.model_dump()
        transaction_data["user_id"] = user_id
        transaction_data["account_id"] = account_id

        transaction = await self.transaction_repo.create(
            TransactionCreate(**transaction_data)
        )

        # Update account balance
        if transaction_in.transaction_type == "income":
            new_balance = account.balance + transaction_in.amount
        else:  # expense
            new_balance = account.balance - transaction_in.amount

        await self.account_repo.update_balance(account_id, new_balance)

        return TransactionResponse.model_validate(transaction)

    async def get_transaction(self, transaction_id: int) -> TransactionResponse:
        """
        Retrieve a transaction by ID.

        Args:
            transaction_id: Transaction ID

        Returns:
            TransactionResponse schema

        Raises:
            ResourceNotFoundError: If transaction not found
        """
        transaction = await self.transaction_repo.get_by_id(transaction_id)
        if not transaction:
            raise ResourceNotFoundError(
                f"Transaction with ID {transaction_id} not found"
            )
        return TransactionResponse.model_validate(transaction)

    async def get_account_transactions(
        self, account_id: int, skip: int = 0, limit: int = 100
    ) -> list[TransactionResponse]:
        """
        Retrieve all transactions for an account.

        Args:
            account_id: Account ID
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            List of TransactionResponse schemas

        Raises:
            ResourceNotFoundError: If account not found
        """
        # Verify account exists
        account = await self.account_repo.get_by_id(account_id)
        if not account:
            raise ResourceNotFoundError(f"Account with ID {account_id} not found")

        transactions = await self.transaction_repo.get_account_transactions(
            account_id, skip, limit
        )
        return [TransactionResponse.model_validate(t) for t in transactions]

    async def update_transaction(
        self, transaction_id: int, transaction_in: TransactionUpdate
    ) -> TransactionResponse:
        """
        Update a transaction.

        Args:
            transaction_id: Transaction ID
            transaction_in: Transaction update schema

        Returns:
            TransactionResponse schema

        Raises:
            ResourceNotFoundError: If transaction not found
        """
        transaction = await self.transaction_repo.update(
            transaction_id, transaction_in
        )
        if not transaction:
            raise ResourceNotFoundError(
                f"Transaction with ID {transaction_id} not found"
            )
        return TransactionResponse.model_validate(transaction)

    async def delete_transaction(self, transaction_id: int) -> bool:
        """
        Delete a transaction and reverse the balance impact.

        Args:
            transaction_id: Transaction ID

        Returns:
            True if deleted

        Raises:
            ResourceNotFoundError: If transaction not found
        """
        # Get transaction to reverse its balance impact
        transaction = await self.transaction_repo.get_by_id(transaction_id)
        if not transaction:
            raise ResourceNotFoundError(
                f"Transaction with ID {transaction_id} not found"
            )

        # Get account and reverse balance
        account = await self.account_repo.get_by_id(transaction.account_id)
        if account:
            if transaction.transaction_type == "income":
                new_balance = account.balance - transaction.amount
            else:  # expense
                new_balance = account.balance + transaction.amount

            await self.account_repo.update_balance(transaction.account_id, new_balance)

        # Delete transaction
        deleted = await self.transaction_repo.delete(transaction_id)
        return deleted

    async def get_account_statistics(
        self, account_id: int
    ) -> dict[str, float | int]:
        """
        Get statistics for an account.

        Args:
            account_id: Account ID

        Returns:
            Dictionary with statistics

        Raises:
            ResourceNotFoundError: If account not found
        """
        # Verify account exists
        account = await self.account_repo.get_by_id(account_id)
        if not account:
            raise ResourceNotFoundError(f"Account with ID {account_id} not found")

        return await self.transaction_repo.get_account_statistics(account_id)

    async def get_transactions_by_date_range(
        self,
        account_id: int,
        start_date: datetime,
        end_date: datetime,
        skip: int = 0,
        limit: int = 100,
    ) -> list[TransactionResponse]:
        """
        Retrieve transactions within a date range.

        Args:
            account_id: Account ID
            start_date: Start of date range
            end_date: End of date range
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            List of TransactionResponse schemas

        Raises:
            ResourceNotFoundError: If account not found
        """
        # Verify account exists
        account = await self.account_repo.get_by_id(account_id)
        if not account:
            raise ResourceNotFoundError(f"Account with ID {account_id} not found")

        transactions = await self.transaction_repo.get_transactions_by_date_range(
            account_id, start_date, end_date, skip, limit
        )
        return [TransactionResponse.model_validate(t) for t in transactions]
