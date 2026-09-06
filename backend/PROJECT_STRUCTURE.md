# Finance Tracker - Project Structure

## Directory Layout

```
finance-tracker/
├── src/
│   └── finance_tracker/          # Main application package
│       ├── __init__.py           # App factory and entry point
│       ├── main.py               # FastAPI app creation
│       │
│       ├── api/                  # HTTP Layer
│       │   ├── __init__.py
│       │   ├── dependencies.py   # Dependency injection
│       │   └── routes/
│       │       └── __init__.py   # API endpoints
│       │
│       ├── services/             # Service Layer (Business Logic)
│       │   └── __init__.py       # User, Account, Transaction services
│       │
│       ├── repositories/         # Repository Layer (Data Access)
│       │   ├── __init__.py       # User, Account, Transaction repositories
│       │   └── base.py           # BaseRepository class
│       │
│       ├── models/               # Database Models Layer
│       │   └── __init__.py       # User, Account, Transaction models
│       │
│       ├── schemas/              # Pydantic Schemas
│       │   └── __init__.py       # Request/response schemas
│       │
│       └── core/                 # Core Configuration
│           ├── __init__.py
│           ├── config.py         # Settings (database URL, debug mode)
│           ├── database.py       # Database engine, session factory, lifespan
│           └── exceptions.py     # Custom exceptions
│
├── tests/                        # Test Suite
│   ├── test_user_service.py     # User service tests
│   ├── test_account_service.py  # Account service tests
│   └── test_transaction_service.py  # Transaction service tests
│
├── conftest.py                   # Pytest configuration and fixtures
├── pyproject.toml                # Project metadata and dependencies
├── .env.example                  # Environment variables template
├── ARCHITECTURE.md               # Architecture guide
├── USAGE.md                      # API usage examples
├── PROJECT_STRUCTURE.md          # This file
└── README.md                     # Project overview
```

## Layer Responsibilities

### HTTP Layer (`api/`)

**Files:**
- `api/routes/__init__.py` - All endpoint definitions
- `api/dependencies.py` - Dependency injection setup

**Responsibilities:**
- Parse HTTP requests
- Validate input using Pydantic schemas
- Call service layer methods
- Return HTTP responses with appropriate status codes
- Handle HTTP-specific errors (404, 400, etc.)

**Key Principle:** No business logic or database queries—only request/response handling.

**Example:**
```python
@router.post("/users", response_model=UserResponse)
async def create_user(
    user_in: UserCreate,
    user_service: UserService = Depends(get_user_service),
    session: AsyncSession = Depends(get_db_session),
):
    return await user_service.create_user(user_in)
```

### Service Layer (`services/`)

**Files:**
- `services/__init__.py` - Contains `UserService`, `AccountService`, `TransactionService`

**Responsibilities:**
- Implement business logic
- Validate business rules
- Orchestrate repository calls
- Handle cross-entity operations
- Raise domain exceptions

**Key Principle:** Services use repositories for all data access—never write SQL queries in services.

**Example:**
```python
async def create_transaction(self, user_id, account_id, transaction_in):
    # Validation (business logic)
    user = await self.user_repo.get_by_id(user_id)
    if not user:
        raise ResourceNotFoundError(...)
    
    # Create transaction through repository
    transaction = await self.transaction_repo.create(transaction_in)
    
    # Update account balance
    new_balance = account.balance + transaction_in.amount
    await self.account_repo.update_balance(account_id, new_balance)
```

### Repository Layer (`repositories/`)

**Files:**
- `repositories/base.py` - `BaseRepository` with generic CRUD operations
- `repositories/__init__.py` - `UserRepository`, `AccountRepository`, `TransactionRepository`

**Responsibilities:**
- All database query operations
- Build SQLAlchemy queries
- Execute async queries
- Return ORM objects

**Key Principle:** Only repositories contain database-specific code (SQL queries, ORM calls).

**Example:**
```python
async def get_account_statistics(self, account_id: int):
    income_result = await self.session.execute(
        select(func.sum(self.model.amount)).where(
            and_(self.model.account_id == account_id, self.model.transaction_type == "income")
        )
    )
    total_income = income_result.scalar() or 0.0
    # ... more query logic
    return {"total_income": total_income, ...}
```

### Models Layer (`models/`)

**Files:**
- `models/__init__.py` - `User`, `Account`, `Transaction` SQLAlchemy models

**Responsibilities:**
- Define database table structure
- Define relationships between tables
- Define constraints and indexes
- Represent the actual database schema

**Key Principle:** Models are ONLY for database layer—never use them in API responses.

**Example:**
```python
class Transaction(Base):
    __tablename__ = "transactions"
    
    id = Column(Integer, primary_key=True)
    amount = Column(Float, nullable=False)
    transaction_type = Column(String(50), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id"))
    account = relationship("Account", back_populates="transactions")
```

### Schemas Layer (`schemas/`)

**Files:**
- `schemas/__init__.py` - `*Create`, `*Update`, `*Response` Pydantic schemas

**Responsibilities:**
- Validate incoming JSON data (via Pydantic)
- Define response structure
- Provide type hints for API documentation
- Serialize ORM objects to JSON

**Key Principle:** Schemas are ONLY for HTTP layer—completely separate from models.

**Example:**
```python
class TransactionCreate(BaseModel):
    amount: float = Field(..., gt=0)  # Validation: amount > 0
    transaction_type: str = Field(..., pattern="^(income|expense)$")  # Enum validation
    description: Optional[str] = Field(None, max_length=500)

class TransactionResponse(BaseModel):
    id: int
    amount: float
    transaction_type: str
```

### Core Module (`core/`)

**Files:**
- `core/config.py` - Settings and configuration
- `core/database.py` - Engine, session factory, lifespan management
- `core/exceptions.py` - Custom exception hierarchy

**Responsibilities:**
- Application configuration
- Database connection management
- Resource lifecycle (startup/shutdown)
- Error definitions

**Key Features:**
- **Lifespan Management** via `@asynccontextmanager`
- **Dependency Injection** setup
- **Custom Exceptions** for error handling

**Example:**
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db_manager.init_db()
    async with db_manager.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # Shutdown
    await db_manager.close_db()
```

## Data Flow

```
1. HTTP Request
        ↓
2. Route Handler (api/routes)
   - Parse Pydantic schema
   - Inject dependencies (service, session)
        ↓
3. Service Method (services/)
   - Validate business logic
   - Call repository methods
   - Orchestrate operations
        ↓
4. Repository Method (repositories/)
   - Build SQLAlchemy query
   - Execute async query
   - Return ORM object
        ↓
5. Service returns Pydantic schema
        ↓
6. Route returns HTTP response (JSON)
```

## Testing Strategy

### Test Structure
```
tests/
├── test_user_service.py         # Unit tests for UserService
├── test_account_service.py      # Unit tests for AccountService
└── test_transaction_service.py  # Unit tests for TransactionService
```

### Test Levels

**Unit Tests (Services)**
- Mock repositories
- Test business logic in isolation
- Verify error handling
- Fast and focused

**Integration Tests (Routes)**
- Use real in-memory SQLite database
- Test full request→response flow
- Verify status codes and response format
- More comprehensive but slower

**Example Unit Test:**
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

## Configuration

### Environment Variables (`.env`)

```env
# Database Configuration
DATABASE_URL=sqlite+aiosqlite:///./finance_tracker.db
# DATABASE_URL=postgresql+asyncpg://user:password@localhost/finance_tracker

# Application
DEBUG=false
```

### Settings Class

Located in `core/config.py`:
```python
class Settings(BaseSettings):
    database_url: str
    app_name: str
    debug: bool
```

## Dependency Injection Flow

```
FastAPI Route
    ↓
@Depends(get_db_session)     → Creates AsyncSession
    ↓
@Depends(get_user_service)   → Creates UserService(session)
    ↓
Service methods use injected session
    ↓
Session automatically cleaned up after request
```

**Benefits:**
- Testable: Inject mock session
- Isolated: Each request gets fresh instances
- Clean: No global state
- Type-safe: Full IDE autocomplete

## Key Design Principles

1. **Separation of Concerns**: Each layer has single responsibility
2. **Repository Pattern**: All data access abstracted
3. **Dependency Injection**: Per-request resource management
4. **Strict Async**: All I/O truly async
5. **Type Safety**: Comprehensive type hints throughout
6. **Error Handling**: Custom exception hierarchy
7. **Validation**: Strict Pydantic schemas
8. **Testability**: Easy to mock and test

## Extending the Application

### Adding a New Entity

1. **Create Model** (`models/__init__.py`)
   ```python
   class Category(Base):
       __tablename__ = "categories"
       id = Column(Integer, primary_key=True)
       name = Column(String(100), unique=True)
   ```

2. **Create Schemas** (`schemas/__init__.py`)
   ```python
   class CategoryCreate(BaseModel):
       name: str = Field(..., min_length=1, max_length=100)
   class CategoryResponse(BaseModel):
       id: int
       name: str
   ```

3. **Create Repository** (`repositories/__init__.py`)
   ```python
   class CategoryRepository(BaseRepository[Category, CategoryCreate, CategoryUpdate]):
       pass
   ```

4. **Create Service** (`services/__init__.py`)
   ```python
   class CategoryService:
       def __init__(self, session: AsyncSession):
           self.repository = CategoryRepository(session)
   ```

5. **Create Routes** (`api/routes/__init__.py`)
   ```python
   @router.post("/categories", response_model=CategoryResponse)
   async def create_category(...):
       pass
   ```

## Performance Optimization Tips

1. **Database Queries**
   - Use eager loading with `selectinload()` for relationships
   - Pagination (skip/limit) for large result sets
   - Indexes on frequently queried columns

2. **Caching**
   - Redis for frequently accessed data
   - Cache at repository or service level
   - Invalidate on data mutations

3. **Connection Pooling**
   - Configured in `core/database.py`
   - Tune pool size based on concurrency

4. **Monitoring**
   - Log slow queries
   - Monitor database connection usage
   - Track endpoint response times
