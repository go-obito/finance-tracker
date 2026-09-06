"""Pydantic schemas for request/response validation."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    """Schema for creating a user."""

    email: EmailStr
    name: str = Field(..., min_length=1, max_length=255)


class UserUpdate(BaseModel):
    """Schema for updating a user."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    email: Optional[EmailStr] = None


class UserResponse(BaseModel):
    """Schema for user response."""

    id: int
    email: str
    name: str
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class AccountCreate(BaseModel):
    """Schema for creating an account."""

    name: str = Field(..., min_length=1, max_length=255)
    account_type: str = Field(..., min_length=1, max_length=50)
    balance: float = Field(default=0.0, ge=0)


class AccountUpdate(BaseModel):
    """Schema for updating an account."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    balance: Optional[float] = Field(None, ge=0)


class AccountResponse(BaseModel):
    """Schema for account response."""

    id: int
    user_id: int
    name: str
    account_type: str
    balance: float
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class AccountWithTransactions(AccountResponse):
    """Schema for account response with transactions."""

    transactions: list["TransactionResponse"] = []


class TransactionCreate(BaseModel):
    """Schema for creating a transaction."""

    amount: float = Field(..., gt=0)
    transaction_type: str = Field(
        ..., pattern="^(income|expense)$"
    )  # Strict enum pattern
    category: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    transaction_date: datetime


class TransactionUpdate(BaseModel):
    """Schema for updating a transaction."""

    amount: Optional[float] = Field(None, gt=0)
    category: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    transaction_date: Optional[datetime] = None


class TransactionResponse(BaseModel):
    """Schema for transaction response."""

    id: int
    user_id: int
    account_id: int
    amount: float
    transaction_type: str
    category: Optional[str]
    description: Optional[str]
    transaction_date: datetime
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class AccountStatisticsResponse(BaseModel):
    """Schema for account statistics response."""

    account_id: int
    total_income: float
    total_expenses: float
    net_balance: float
    transaction_count: int


# Update forward references
AccountWithTransactions.model_rebuild()
