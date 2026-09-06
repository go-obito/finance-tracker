"""API routes for finance operations."""

from fastapi import APIRouter, Depends, HTTPException, status

from finance_tracker.core.exceptions import ResourceNotFoundError, ValidationError
from finance_tracker.schemas import (
    AccountCreate,
    AccountResponse,
    AccountStatisticsResponse,
    AccountUpdate,
    TransactionCreate,
    TransactionResponse,
    TransactionUpdate,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from finance_tracker.services import (
    AccountService,
    TransactionService,
    UserService,
)

from .dependencies import (
    get_account_service,
    get_transaction_service,
    get_user_service,
)

router = APIRouter(prefix="/api/v1", tags=["finance"])


# ============================================================================
# USER ENDPOINTS
# ============================================================================


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_in: UserCreate,
    user_service: UserService = Depends(get_user_service),
):
    """Create a new user."""
    try:
        return await user_service.create_user(user_in)
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    user_service: UserService = Depends(get_user_service),
):
    """Retrieve a user by ID."""
    try:
        return await user_service.get_user(user_id)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    user_in: UserUpdate,
    user_service: UserService = Depends(get_user_service),
):
    """Update a user."""
    try:
        return await user_service.update_user(user_id, user_in)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    user_service: UserService = Depends(get_user_service),
):
    """Delete a user."""
    try:
        await user_service.delete_user(user_id)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


# ============================================================================
# ACCOUNT ENDPOINTS
# ============================================================================


@router.post(
    "/users/{user_id}/accounts",
    response_model=AccountResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_account(
    user_id: int,
    account_in: AccountCreate,
    account_service: AccountService = Depends(get_account_service),
):
    """Create a new account for a user."""
    try:
        return await account_service.create_account(user_id, account_in)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.get("/accounts/{account_id}", response_model=AccountResponse)
async def get_account(
    account_id: int,
    account_service: AccountService = Depends(get_account_service),
):
    """Retrieve an account by ID."""
    try:
        return await account_service.get_account(account_id)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.get("/users/{user_id}/accounts", response_model=list[AccountResponse])
async def get_user_accounts(
    user_id: int,
    account_service: AccountService = Depends(get_account_service),
):
    """Retrieve all accounts for a user."""
    try:
        return await account_service.get_user_accounts(user_id)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.put("/accounts/{account_id}", response_model=AccountResponse)
async def update_account(
    account_id: int,
    account_in: AccountUpdate,
    account_service: AccountService = Depends(get_account_service),
):
    """Update an account."""
    try:
        return await account_service.update_account(account_id, account_in)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: int,
    account_service: AccountService = Depends(get_account_service),
):
    """Delete an account."""
    try:
        await account_service.delete_account(account_id)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


# ============================================================================
# TRANSACTION ENDPOINTS
# ============================================================================


@router.post(
    "/accounts/{account_id}/transactions",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_transaction(
    account_id: int,
    transaction_in: TransactionCreate,
    user_id: int = 1,  # This would normally come from auth
    transaction_service: TransactionService = Depends(get_transaction_service),
):
    """Create a new transaction for an account."""
    try:
        return await transaction_service.create_transaction(
            user_id, account_id, transaction_in
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.get("/transactions/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_id: int,
    transaction_service: TransactionService = Depends(get_transaction_service),
):
    """Retrieve a transaction by ID."""
    try:
        return await transaction_service.get_transaction(transaction_id)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.get("/accounts/{account_id}/transactions", response_model=list[TransactionResponse])
async def get_account_transactions(
    account_id: int,
    skip: int = 0,
    limit: int = 100,
    transaction_service: TransactionService = Depends(get_transaction_service),
):
    """Retrieve all transactions for an account."""
    try:
        return await transaction_service.get_account_transactions(account_id, skip, limit)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.put("/transactions/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_id: int,
    transaction_in: TransactionUpdate,
    transaction_service: TransactionService = Depends(get_transaction_service),
):
    """Update a transaction."""
    try:
        return await transaction_service.update_transaction(
            transaction_id, transaction_in
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: int,
    transaction_service: TransactionService = Depends(get_transaction_service),
):
    """Delete a transaction."""
    try:
        await transaction_service.delete_transaction(transaction_id)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )


@router.get("/accounts/{account_id}/statistics", response_model=AccountStatisticsResponse)
async def get_account_statistics(
    account_id: int,
    transaction_service: TransactionService = Depends(get_transaction_service),
):
    """Retrieve statistics for an account."""
    try:
        stats = await transaction_service.get_account_statistics(account_id)
        return AccountStatisticsResponse(account_id=account_id, **stats)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        )
