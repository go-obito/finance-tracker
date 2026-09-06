"""Base repository class with common CRUD operations."""

from typing import Any, Generic, Optional, Type, TypeVar

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

ModelT = TypeVar("ModelT")
CreateSchemaT = TypeVar("CreateSchemaT")
UpdateSchemaT = TypeVar("UpdateSchemaT")


class BaseRepository(Generic[ModelT, CreateSchemaT, UpdateSchemaT]):
    """
    Base repository class providing common CRUD operations.

    This class implements the Repository Pattern to abstract database access
    and provide a consistent interface for data operations.
    """

    def __init__(self, model: Type[ModelT], session: AsyncSession):
        """
        Initialize the repository.

        Args:
            model: SQLAlchemy model class
            session: AsyncSession for database operations
        """
        self.model = model
        self.session = session

    async def create(self, obj_in: CreateSchemaT) -> ModelT:
        """
        Create a new record.

        Args:
            obj_in: Schema object with data to create

        Returns:
            Created model instance
        """
        db_obj = self.model(**obj_in.model_dump())
        self.session.add(db_obj)
        await self.session.flush()
        await self.session.refresh(db_obj)
        return db_obj

    async def get_by_id(self, id: Any) -> Optional[ModelT]:
        """
        Retrieve a record by ID.

        Args:
            id: Primary key value

        Returns:
            Model instance or None if not found
        """
        result = await self.session.execute(
            select(self.model).where(self.model.id == id)
        )
        return result.scalars().first()

    async def get_all(self, skip: int = 0, limit: int = 100) -> list[ModelT]:
        """
        Retrieve all records with pagination.

        Args:
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            List of model instances
        """
        result = await self.session.execute(
            select(self.model).offset(skip).limit(limit)
        )
        return result.scalars().all()

    async def update(self, id: Any, obj_in: UpdateSchemaT) -> Optional[ModelT]:
        """
        Update a record.

        Args:
            id: Primary key value
            obj_in: Schema object with data to update

        Returns:
            Updated model instance or None if not found
        """
        db_obj = await self.get_by_id(id)
        if not db_obj:
            return None

        update_data = obj_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_obj, key, value)

        self.session.add(db_obj)
        await self.session.flush()
        await self.session.refresh(db_obj)
        return db_obj

    async def delete(self, id: Any) -> bool:
        """
        Delete a record.

        Args:
            id: Primary key value

        Returns:
            True if deleted, False if not found
        """
        db_obj = await self.get_by_id(id)
        if not db_obj:
            return False

        await self.session.delete(db_obj)
        await self.session.flush()
        return True

    async def exists(self, **kwargs) -> bool:
        """
        Check if a record exists matching the given criteria.

        Args:
            **kwargs: Field names and values to match

        Returns:
            True if record exists, False otherwise
        """
        conditions = [
            getattr(self.model, key) == value for key, value in kwargs.items()
        ]
        result = await self.session.execute(
            select(self.model).where(and_(*conditions))
        )
        return result.scalars().first() is not None
