# Finance Tracker - Usage Examples

## Quick Start

### 1. Create a User

**Request**:
```bash
curl -X POST http://localhost:8000/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "name": "John Doe"
  }'
```

**Response** (201 Created):
```json
{
  "id": 1,
  "email": "john@example.com",
  "name": "John Doe",
  "created_at": "2024-01-15T10:30:00",
  "updated_at": "2024-01-15T10:30:00"
}
```

### 2. Create an Account

**Request**:
```bash
curl -X POST http://localhost:8000/api/v1/users/1/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Checking Account",
    "account_type": "checking",
    "balance": 5000.00
  }'
```

**Response** (201 Created):
```json
{
  "id": 1,
  "user_id": 1,
  "name": "Checking Account",
  "account_type": "checking",
  "balance": 5000.00,
  "created_at": "2024-01-15T10:31:00",
  "updated_at": "2024-01-15T10:31:00"
}
```

### 3. Create a Transaction

**Request** (Income):
```bash
curl -X POST http://localhost:8000/api/v1/accounts/1/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 3000.00,
    "transaction_type": "income",
    "category": "Salary",
    "description": "Monthly salary",
    "transaction_date": "2024-01-15T09:00:00"
  }' \
  -G -d 'user_id=1'
```

**Request** (Expense):
```bash
curl -X POST http://localhost:8000/api/v1/accounts/1/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 45.00,
    "transaction_type": "expense",
    "category": "Groceries",
    "description": "Weekly groceries",
    "transaction_date": "2024-01-15T14:30:00"
  }' \
  -G -d 'user_id=1'
```

**Response** (201 Created):
```json
{
  "id": 1,
  "user_id": 1,
  "account_id": 1,
  "amount": 3000.00,
  "transaction_type": "income",
  "category": "Salary",
  "description": "Monthly salary",
  "transaction_date": "2024-01-15T09:00:00",
  "created_at": "2024-01-15T10:32:00",
  "updated_at": "2024-01-15T10:32:00"
}
```

Note: The account balance is automatically updated to $8000.00 (5000 + 3000).

### 4. Get Account Balance

**Request**:
```bash
curl http://localhost:8000/api/v1/accounts/1
```

**Response**:
```json
{
  "id": 1,
  "user_id": 1,
  "name": "Checking Account",
  "account_type": "checking",
  "balance": 7955.00,
  "created_at": "2024-01-15T10:31:00",
  "updated_at": "2024-01-15T10:33:00"
}
```

### 5. List All Transactions for an Account

**Request**:
```bash
curl http://localhost:8000/api/v1/accounts/1/transactions?skip=0&limit=10
```

**Response**:
```json
[
  {
    "id": 1,
    "user_id": 1,
    "account_id": 1,
    "amount": 3000.00,
    "transaction_type": "income",
    "category": "Salary",
    "description": "Monthly salary",
    "transaction_date": "2024-01-15T09:00:00",
    "created_at": "2024-01-15T10:32:00",
    "updated_at": "2024-01-15T10:32:00"
  },
  {
    "id": 2,
    "user_id": 1,
    "account_id": 1,
    "amount": 45.00,
    "transaction_type": "expense",
    "category": "Groceries",
    "description": "Weekly groceries",
    "transaction_date": "2024-01-15T14:30:00",
    "created_at": "2024-01-15T10:33:00",
    "updated_at": "2024-01-15T10:33:00"
  }
]
```

### 6. Get Account Statistics

**Request**:
```bash
curl http://localhost:8000/api/v1/accounts/1/statistics
```

**Response**:
```json
{
  "account_id": 1,
  "total_income": 3000.00,
  "total_expenses": 45.00,
  "net_balance": 2955.00,
  "transaction_count": 2
}
```

### 7. Update a Transaction

**Request**:
```bash
curl -X PUT http://localhost:8000/api/v1/transactions/2 \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50.00,
    "category": "Food",
    "description": "Updated groceries"
  }'
```

**Response** (200 OK):
```json
{
  "id": 2,
  "user_id": 1,
  "account_id": 1,
  "amount": 50.00,
  "transaction_type": "expense",
  "category": "Food",
  "description": "Updated groceries",
  "transaction_date": "2024-01-15T14:30:00",
  "created_at": "2024-01-15T10:33:00",
  "updated_at": "2024-01-15T10:35:00"
}
```

### 8. Delete a Transaction

**Request**:
```bash
curl -X DELETE http://localhost:8000/api/v1/transactions/2
```

**Response** (204 No Content)

The transaction is deleted and the account balance is reversed (balance increases by $50).

### 9. Update User Information

**Request**:
```bash
curl -X PUT http://localhost:8000/api/v1/users/1 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Smith"
  }'
```

**Response** (200 OK):
```json
{
  "id": 1,
  "email": "john@example.com",
  "name": "John Smith",
  "created_at": "2024-01-15T10:30:00",
  "updated_at": "2024-01-15T10:36:00"
}
```

### 10. Delete a User

**Request**:
```bash
curl -X DELETE http://localhost:8000/api/v1/users/1
```

**Response** (204 No Content)

The user and all related accounts and transactions are deleted (cascade delete).

## Python Client Example

```python
import httpx
import asyncio
from datetime import datetime

async def main():
    async with httpx.AsyncClient() as client:
        # Create user
        user_response = await client.post(
            "http://localhost:8000/api/v1/users",
            json={"email": "alice@example.com", "name": "Alice Johnson"}
        )
        user_id = user_response.json()["id"]
        print(f"Created user: {user_id}")

        # Create account
        account_response = await client.post(
            f"http://localhost:8000/api/v1/users/{user_id}/accounts",
            json={
                "name": "Savings Account",
                "account_type": "savings",
                "balance": 10000.00
            }
        )
        account_id = account_response.json()["id"]
        print(f"Created account: {account_id}")

        # Create income transaction
        await client.post(
            f"http://localhost:8000/api/v1/accounts/{account_id}/transactions",
            json={
                "amount": 5000.00,
                "transaction_type": "income",
                "category": "Bonus",
                "description": "Annual bonus",
                "transaction_date": datetime.now().isoformat()
            },
            params={"user_id": user_id}
        )
        print("Created income transaction")

        # Create expense transaction
        await client.post(
            f"http://localhost:8000/api/v1/accounts/{account_id}/transactions",
            json={
                "amount": 100.00,
                "transaction_type": "expense",
                "category": "Utilities",
                "description": "Electric bill",
                "transaction_date": datetime.now().isoformat()
            },
            params={"user_id": user_id}
        )
        print("Created expense transaction")

        # Get account
        account = await client.get(
            f"http://localhost:8000/api/v1/accounts/{account_id}"
        )
        print(f"Account balance: ${account.json()['balance']:.2f}")

        # Get statistics
        stats = await client.get(
            f"http://localhost:8000/api/v1/accounts/{account_id}/statistics"
        )
        stats_data = stats.json()
        print(f"Statistics: Income=${stats_data['total_income']:.2f}, "
              f"Expenses=${stats_data['total_expenses']:.2f}")

asyncio.run(main())
```

## Error Handling Examples

### Duplicate Email
**Request**:
```bash
curl -X POST http://localhost:8000/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{"email": "john@example.com", "name": "Another John"}'
```

**Response** (400 Bad Request):
```json
{
  "detail": "User with email john@example.com already exists"
}
```

### Invalid Transaction Type
**Request**:
```bash
curl -X POST http://localhost:8000/api/v1/accounts/1/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100.00,
    "transaction_type": "invalid",
    "transaction_date": "2024-01-15T10:00:00"
  }' \
  -G -d 'user_id=1'
```

**Response** (422 Unprocessable Entity):
```json
{
  "detail": [
    {
      "type": "string_pattern_mismatch",
      "loc": ["body", "transaction_type"],
      "msg": "String should match pattern '^(income|expense)$'"
    }
  ]
}
```

### Resource Not Found
**Request**:
```bash
curl http://localhost:8000/api/v1/users/999
```

**Response** (404 Not Found):
```json
{
  "detail": "User with ID 999 not found"
}
```

## Validation Rules

### User
- `email`: Valid email format (required)
- `name`: 1-255 characters (required)

### Account
- `name`: 1-255 characters (required)
- `account_type`: 1-50 characters (required)
- `balance`: Must be >= 0 (default: 0)

### Transaction
- `amount`: Must be > 0 (required)
- `transaction_type`: Must be "income" or "expense" (required)
- `category`: 0-100 characters (optional)
- `description`: 0-500 characters (optional)
- `transaction_date`: Valid datetime (required)
