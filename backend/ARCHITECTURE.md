# Finance Tracker Architecture Guide

## Overview

This is a production-ready finance tracker built with **clean architecture principles** and modern Python async patterns. The application separates concerns into distinct layers, enabling scalability, testability, and maintainability.

## Architecture Layers

### 1. **HTTP Layer** (`api/routes/`)
- **Responsibility**: Handle HTTP requests/responses only
- **No business logic**: Routes delegate to services
- **Features**:
  - Dependency injection via `FastAPI.Depends()`
  - Proper HTTP status codes and error handling
  - Request/response validation using Pydantic schemas

```python
@router.post("/users", response_model=UserResponse)
async def create_user(
    user_in: UserCreate,
    user_service: UserService = Depends(get_user_service),
    session: AsyncSession = Depends(get_db_session),
) -> UserResponse:
    """Create a new user - route only handles HTTP concerns."""
    return await user_service.create_user(user_in)
```

### 2. **Service Layer** (`services/`)
- **Responsibility**: Business logic and orchestration
- **No database queries**: All data access goes through repositories
- **Features**:
  - Validation and error handling
  - Transaction management
  - Cross-entity operations

```python
async def create_transaction(self, user_id: int, account_id: int, transaction_in: TransactionCreate):
    """Business logic: validate, create transaction, update account balance."""
    # Validation
    user = await self.user_repo.get_by_id(user_id)
    if not user:
        raise ResourceNotFoundError(...)
    
    # Create transaction
    transaction = await self.transaction_repo.create(transaction_in)
    
    # Update account balance
    new_balance = account.balance + transaction_in.amount
    await self.account_repo.update_balance(account_id, new_balance)
```

### 3. **Repository Layer** (`repositories/`)
- **Responsibility**: All database operations
- **Pattern**: Repository Pattern (abstraction over data access)
- **Features**:
  - CRUD operations via `BaseRepository`
  - Complex queries (filtering, aggregation)
  - No SQL logic in services/routes

```python
class TransactionRepository(BaseRepository[Transaction, ...]):
    async def get_account_transactions(self, account_id: int):
        """Query builder stays in repository."""
        result = await self.session.execute(
            select(self.model).where(self.model.account_id == account_id)
        )
        return result.scalars().all()
```

### 4. **Models Layer** (`models/`)
- **Responsibility**: SQLAlchemy ORM models (database schema)
- **Strictly separate from schemas**: Models are for the database layer only
- **Features**:
  - Table definitions
  - Relationships
  - Constraints and indexes

```python
class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True)
    account_id = Column(Integer, ForeignKey("accounts.id"))
    amount = Column(Float)
    account = relationship("Account", back_populates="transactions")
```

### 5. **Schemas Layer** (`schemas/`)
- **Responsibility**: Pydantic models for request/response validation
- **Strictly separate from models**: Schemas only for HTTP layer
- **Features**:
  - Strict type validation
  - Serialization/deserialization
  - Documentation for API endpoints

```python
class TransactionCreate(BaseModel):
    amount: float = Field(..., gt=0)
    transaction_type: str = Field(..., pattern="^(income|expense)$")
    description: Optional[str] = Field(None, max_length=500)
```

### 6. **Core Module** (`core/`)
- **Database Configuration**: Engine, session factory, connection pooling
- **Lifespan Management**: Startup/shutdown via `@asynccontextmanager`
- **Exceptions**: Custom exception hierarchy
- **Settings**: Environment-based configuration

## Key Design Patterns

### Dependency Injection
FastAPI's `Depends()` injects dependencies per-request:

```python
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Each request gets its own database session."""
    async with db_manager.async_session_factory() as session:
        yield session

@router.post("/users")
async def create_user(
    user_service: UserService = Depends(get_user_service),
    session: AsyncSession = Depends(get_db_session),
):
    """Services and sessions are injected and cleaned up automatically."""
    pass
```

**Benefits**:
- Easy mocking for unit tests (inject mock repositories)
- Per-request resource management
- Testable without complex setup

### Lifespan Events
FastAPI's `@asynccontextmanager` handles database lifecycle:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize engine, create tables
    await db_manager.init_db()
    async with db_manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # Shutdown: Close connection pool
    await db_manager.close_db()

app = FastAPI(lifespan=lifespan)
```

**Benefits**:
- No global variables
- Guaranteed cleanup
- Proper error handling

### Async/Await Throughout
All I/O operations are truly async:

```python
# Routes
@app.post("/users")
async def create_user(...):  # async

# Services
async def create_user(self, ...):  # async

# Repositories
async def create(self, obj_in):  # async
await self.session.execute(...)  # await database

# Sessions
session = AsyncSession(engine)  # async engine
```

## Request Flow

```
HTTP Request
    ↓
Routes Layer (api/routes/)
    ├─ Parse request → Pydantic schema
    ├─ Inject dependencies (session, service)
    └─ Call service method
        ↓
    Service Layer (services/)
        ├─ Validate business logic
        ├─ Call repository methods
        └─ Orchestrate operations
            ↓
        Repository Layer (repositories/)
            ├─ Query builder (SQLAlchemy)
            ├─ Execute async queries
            └─ Return ORM objects
        ↓
    Service returns Pydantic schema
    ↓
Routes serialize schema to JSON response
    ↓
HTTP Response
```

## Testing Strategy

### Unit Tests (Repository Layer)
- Mock database session
- Test query builders
- Verify data access patterns

```python
@pytest.mark.asyncio
async def test_get_account_transactions(test_db):
    repo = TransactionRepository(test_db)
    transactions = await repo.get_account_transactions(account_id=1)
    assert len(transactions) == 5
```

### Service Tests
- Mock repositories
- Test business logic
- Verify error handling

```python
@pytest.mark.asyncio
async def test_create_transaction(test_db):
    service = TransactionService(test_db)
    transaction = await service.create_transaction(
        user_id=1, account_id=1, 
        transaction_in=TransactionCreate(...)
    )
    assert transaction.amount == 100.0
```

### Integration Tests
- Real database (SQLite in-memory)
- Test full request flow
- Verify HTTP status codes and responses

```python
@pytest.mark.asyncio
async def test_create_transaction_endpoint(client):
    response = await client.post(
        "/api/v1/accounts/1/transactions",
        json={"amount": 100.0, "transaction_type": "income"}
    )
    assert response.status_code == 201
```

## Scalability Considerations

### Database Layer
- **Async operations**: Non-blocking I/O for high concurrency
- **Connection pooling**: Managed by `create_async_engine()`
- **Query optimization**: Complex queries in repositories

### Service Layer
- **Stateless**: Each request gets fresh service instances
- **Reusable methods**: Services can be called from multiple routes
- **Easy to extend**: Add new services without modifying routes

### Repository Layer
- **Polymorphic queries**: Base repository provides common operations
- **Specialized repositories**: Custom methods for complex queries
- **Type-safe**: Generic types ensure type safety

### API Layer
- **Pagination**: Skip/limit parameters for large result sets
- **Filtering**: Repository methods support complex filters
- **Caching**: Can be added at route or service level

## Configuration

Environment variables in `.env`:

```env
DATABASE_URL=sqlite+aiosqlite:///./finance_tracker.db
# or for PostgreSQL async:
# DATABASE_URL=postgresql+asyncpg://user:password@localhost/finance_tracker

DEBUG=false
```

## Running the Application

```bash
# Install dependencies
uv sync

# Start development server
uv run finance-tracker

# Or directly with uvicorn
uvicorn finance_tracker:app --reload

# Run tests
pytest tests/ -v

# Run tests with coverage
pytest tests/ --cov=finance_tracker
```

## API Documentation

Once running, visit:
- **Interactive API Docs**: http://localhost:8000/docs (Swagger UI)
- **Alternative API Docs**: http://localhost:8000/redoc (ReDoc)
- **Health Check**: http://localhost:8000/health

## Future Enhancements

1. **Authentication & Authorization**
   - JWT tokens for user authentication
   - Role-based access control (RBAC)
   - Middleware for request authentication

2. **Advanced Querying**
   - Filter/sort/search on all endpoints
   - Full-text search on descriptions
   - Date range queries

3. **Caching**
   - Redis caching for frequently accessed data
   - Invalidation strategies

4. **Monitoring**
   - Application performance monitoring (APM)
   - Database query monitoring
   - Request logging and tracing

5. **Background Tasks**
   - Celery for async job processing
   - Scheduled reports generation
   - Data cleanup tasks
