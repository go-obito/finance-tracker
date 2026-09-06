# Finance Tracker

A **production-ready finance tracker** built with clean architecture principles, strict type validation, and async-first design. This application demonstrates best practices for building scalable, maintainable, and testable Python APIs.

## 🏗️ Architecture Overview

The application follows a **layered clean architecture**:

```
HTTP Requests
    ↓
Routes Layer (HTTP handling only)
    ↓
Services Layer (Business logic)
    ↓
Repositories Layer (Data access)
    ↓
Database
```

### Key Design Principles

- **✅ Repository Pattern**: No SQL queries in routes or services
- **✅ Dependency Injection**: Per-request resource management via FastAPI's `Depends`
- **✅ Async Throughout**: True async/await from routes to database
- **✅ Strict Validation**: Pydantic schemas for all inputs/outputs
- **✅ Model Isolation**: SQLAlchemy models completely separate from API schemas
- **✅ Lifespan Management**: FastAPI's `@asynccontextmanager` for startup/shutdown

## 🚀 Quick Start

### Prerequisites

- Python 3.10+
- uv (package manager)

### Installation

```bash
# Clone the repository
cd finance-tracker

# Install dependencies
uv sync

# Create environment file
cp .env.example .env
```

### Running the Application

```bash
# Start development server (with auto-reload)
uv run finance-tracker

# Or with uvicorn directly
uvicorn finance_tracker:app --reload
```

The API will be available at `http://localhost:8000`

### Interactive API Documentation

Once running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **Health Check**: http://localhost:8000/health

## 📁 Project Structure

```
src/finance_tracker/
├── api/                    # HTTP Layer
│   ├── routes/            # API endpoints
│   └── dependencies.py    # Dependency injection
├── services/              # Business Logic Layer
├── repositories/          # Data Access Layer
│   ├── base.py           # Generic CRUD repository
│   └── __init__.py       # Specific repositories
├── models/               # SQLAlchemy ORM models
├── schemas/              # Pydantic validation schemas
└── core/                 # Configuration & Database
    ├── config.py        # Settings
    ├── database.py      # Engine, sessions, lifespan
    └── exceptions.py    # Custom exceptions
```

## 📚 Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Deep dive into architecture and patterns
- **[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)** - Detailed layer responsibilities
- **[USAGE.md](USAGE.md)** - API examples and use cases

## 💡 Core Features

### 1. Users
- Create user accounts
- Retrieve user information
- Update user details
- Delete users (cascade delete accounts/transactions)

### 2. Accounts
- Create multiple accounts per user
- Track account balances
- View all user accounts
- Delete accounts

### 3. Transactions
- Record income/expense transactions
- Automatic account balance updates
- Transaction history per account
- Statistics (income, expenses, net balance)
- Filter transactions by date range

## 📋 API Endpoints

### Users
```
POST   /api/v1/users              # Create user
GET    /api/v1/users/{id}         # Get user
PUT    /api/v1/users/{id}         # Update user
DELETE /api/v1/users/{id}         # Delete user
```

### Accounts
```
POST   /api/v1/users/{id}/accounts              # Create account
GET    /api/v1/accounts/{id}                    # Get account
GET    /api/v1/users/{id}/accounts              # List user accounts
PUT    /api/v1/accounts/{id}                    # Update account
DELETE /api/v1/accounts/{id}                    # Delete account
```

### Transactions
```
POST   /api/v1/accounts/{id}/transactions       # Create transaction
GET    /api/v1/transactions/{id}                # Get transaction
GET    /api/v1/accounts/{id}/transactions       # List account transactions
PUT    /api/v1/transactions/{id}                # Update transaction
DELETE /api/v1/transactions/{id}                # Delete transaction
GET    /api/v1/accounts/{id}/statistics         # Get account statistics
```

## 🔍 Example Usage

### Create a User
```bash
curl -X POST http://localhost:8000/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{"email": "john@example.com", "name": "John Doe"}'
```

### Create an Account
```bash
curl -X POST http://localhost:8000/api/v1/users/1/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "Checking", "account_type": "checking", "balance": 5000}'
```

### Record a Transaction
```bash
curl -X POST http://localhost:8000/api/v1/accounts/1/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "transaction_type": "expense",
    "category": "Groceries",
    "description": "Weekly groceries",
    "transaction_date": "2024-01-15T10:00:00"
  }' \
  -G -d 'user_id=1'
```

See [USAGE.md](USAGE.md) for comprehensive examples.

## 🧪 Testing

```bash
# Run all tests
pytest tests/ -v

# Run tests with coverage
pytest tests/ --cov=finance_tracker

# Run specific test file
pytest tests/test_user_service.py -v

# Run with live output
pytest tests/ -s
```

## 🔐 Key Architectural Patterns

### Repository Pattern
```python
# Routes never write queries directly
# Services never write queries directly
# Only repositories contain database logic

class UserRepository(BaseRepository[User, UserCreate, UserUpdate]):
    async def get_by_email(self, email: str) -> Optional[User]:
        result = await self.session.execute(
            select(self.model).where(self.model.email == email)
        )
        return result.scalars().first()

# Services use repositories
user = await self.user_repository.get_by_email("john@example.com")
```

### Dependency Injection
```python
# Routes receive injected dependencies
# Perfect for testing and mocking

@router.post("/users")
async def create_user(
    user_in: UserCreate,
    user_service: UserService = Depends(get_user_service),  # Injected
    session: AsyncSession = Depends(get_db_session),         # Injected
):
    return await user_service.create_user(user_in)

# In tests: easily inject mock repository
mock_repo = MockUserRepository()
service = UserService(mock_repo)
```

### Lifespan Management
```python
# No global variables
# Proper resource cleanup

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db_manager.init_db()
    await db_manager.create_tables()
    yield
    # Shutdown
    await db_manager.close_db()

app = FastAPI(lifespan=lifespan)
```

### Strict Type Validation
```python
# All inputs validated with Pydantic
# Type hints throughout

class TransactionCreate(BaseModel):
    amount: float = Field(..., gt=0)                    # Must be > 0
    transaction_type: str = Field(..., pattern="^(income|expense)$")  # Strict enum
    category: Optional[str] = Field(None, max_length=100)  # Optional but validated
```

## 🛠️ Configuration

Create a `.env` file:

```env
# SQLite (development)
DATABASE_URL=sqlite+aiosqlite:///./finance_tracker.db

# PostgreSQL (production)
# DATABASE_URL=postgresql+asyncpg://user:password@localhost/finance_tracker

DEBUG=false
APP_NAME=Finance Tracker
```

## 📦 Dependencies

### Core
- **FastAPI** - Modern web framework
- **Pydantic** - Data validation
- **SQLAlchemy** - ORM with async support
- **Uvicorn** - ASGI server

### Database
- **aiosqlite** - Async SQLite driver
- **asyncpg** - Async PostgreSQL driver (optional)

### Development
- **pytest** - Testing framework
- **pytest-asyncio** - Async test support

## 🔄 Request Flow Example

```
1. HTTP POST /api/v1/accounts/1/transactions
2. Route receives JSON, parses with TransactionCreate schema
3. Route injects session and TransactionService via Depends
4. Route calls service.create_transaction(user_id, account_id, transaction_in)
5. Service validates business logic (user exists, account exists)
6. Service calls transaction_repo.create(transaction_in)
7. Repository executes: session.execute(INSERT INTO transactions ...)
8. Service updates account: account_repo.update_balance(account_id, new_balance)
9. Route returns 201 with TransactionResponse (Pydantic schema)
10. Session auto-closes after response
```

## 🎯 Best Practices Implemented

✅ **Async First**: All I/O is async for better scalability  
✅ **Error Handling**: Custom exception hierarchy  
✅ **Validation**: Strict Pydantic schemas everywhere  
✅ **Type Safety**: Full type hints for IDE support  
✅ **Separation**: Clear layer boundaries  
✅ **Testability**: Easy to mock and unit test  
✅ **Documentation**: OpenAPI/Swagger automatically  
✅ **Clean Code**: DRY principle, no duplication  

## 🚀 Scaling Considerations

### Database
- Supports SQLite for development
- Supports PostgreSQL/MySQL with async drivers
- Connection pooling configured
- Ready for migration strategies

### API
- Stateless design enables horizontal scaling
- Pagination for large datasets
- Efficient query patterns
- Ready for caching layer

### Monitoring
- Error tracking ready (integrate Sentry)
- Request logging ready
- Performance monitoring ready

## 📖 Learning Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy Async Documentation](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [Pydantic Documentation](https://docs.pydantic.dev/)
- [Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html)
- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

Contributions are welcome! Please ensure:
1. Code follows the existing style
2. All tests pass
3. New features include tests
4. Documentation is updated

## ❓ FAQ

**Q: Why separate models and schemas?**  
A: Models are for the database layer, schemas are for API contracts. This separation allows flexibility—your database schema can evolve independently from your API.

**Q: Why use repositories?**  
A: The Repository Pattern abstracts data access, making code testable and allowing easy switching between data sources (SQL, NoSQL, APIs).

**Q: Why async?**  
A: Async enables handling many concurrent requests efficiently. FastAPI + SQLAlchemy async is perfect for I/O-bound applications.

**Q: How do I add authentication?**  
A: Add JWT middleware in `api/dependencies.py` that validates tokens and injects the current user. See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

---

Built with ❤️ for scalable, maintainable finance applications.
