"""Unit tests for user service."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from finance_tracker.core.exceptions import ResourceNotFoundError, ValidationError
from finance_tracker.models import Base, User
from finance_tracker.schemas import UserCreate, UserUpdate
from finance_tracker.services import UserService


@pytest.fixture
async def test_db():
    """Create an in-memory SQLite database for testing."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    async with async_session() as session:
        yield session

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_user(test_db):
    """Test creating a new user."""
    service = UserService(test_db)
    user_in = UserCreate(email="test@example.com", name="Test User")

    user = await service.create_user(user_in)

    assert user.email == "test@example.com"
    assert user.name == "Test User"


@pytest.mark.asyncio
async def test_create_duplicate_user(test_db):
    """Test creating a user with duplicate email raises error."""
    service = UserService(test_db)
    user_in = UserCreate(email="test@example.com", name="Test User")

    await service.create_user(user_in)

    with pytest.raises(ValidationError):
        await service.create_user(user_in)


@pytest.mark.asyncio
async def test_get_user_not_found(test_db):
    """Test getting a non-existent user raises error."""
    service = UserService(test_db)

    with pytest.raises(ResourceNotFoundError):
        await service.get_user(999)


@pytest.mark.asyncio
async def test_update_user(test_db):
    """Test updating a user."""
    service = UserService(test_db)
    user_in = UserCreate(email="test@example.com", name="Test User")
    user = await service.create_user(user_in)

    updated_in = UserUpdate(name="Updated User")
    updated_user = await service.update_user(user.id, updated_in)

    assert updated_user.name == "Updated User"


@pytest.mark.asyncio
async def test_delete_user(test_db):
    """Test deleting a user."""
    service = UserService(test_db)
    user_in = UserCreate(email="test@example.com", name="Test User")
    user = await service.create_user(user_in)

    deleted = await service.delete_user(user.id)
    assert deleted is True

    with pytest.raises(ResourceNotFoundError):
        await service.get_user(user.id)
