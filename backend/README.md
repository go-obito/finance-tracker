# Finance Tracker API

Node.js 20+ and Express 5 API. MongoDB is authoritative; all persisted business records are scoped by the authenticated application user. Amounts are integer pesewas, and API responses label account balances as recorded rather than provider-verified.

## Local setup

1. Install Node.js 20 or newer and run MongoDB locally, or provision a MongoDB deployment.
2. Copy `.env.example` to `.env` and set `MONGODB_URI`, `MONGODB_DATABASE`, and a random `SESSION_SECRET` of at least 32 characters. Keep `.env` out of version control.
3. Set `GOOGLE_CLIENT_ID` and `APPLE_CLIENT_ID` to the web client audiences used by the frontend. The OAuth provider flows and callback/origin settings must use those same web identifiers.
4. Run `npm ci`, then `npm test` and `npm start` from this directory.
5. The API listens on `http://localhost:3000`; `GET /health` is a non-database liveness endpoint.

The server creates MongoDB indexes at startup and exits if MongoDB is unavailable. No SQLite database or existing application data was present during the repository audit. There is no automatic migration step.

## API

All finance endpoints are under `/api/v1`. Requests other than `/health` require `Authorization: Bearer <session>`. Mutations use stable UUID record IDs; sends of create requests also require an `Idempotency-Key`. Updates and deletes require `If-Match: <revision>` and return `409 revision_conflict` for stale revisions. Errors use `{ "error": { "code", "message", "details?" } }`.

- `POST /auth/challenge/:provider`, `POST /auth/session`, `GET /auth/me`, `DELETE /auth/session`, `POST /auth/links/:provider`
- `GET|POST /accounts`, `PATCH|DELETE /accounts/:id`
- `GET|POST /transactions`, `PATCH|DELETE /transactions/:id`
- `POST /transfers`, `DELETE /transfers/:id`
- `GET|POST /categories`, `PATCH|DELETE /categories/:id`
- `GET /dashboard`
- `POST /imports/preview` (multipart `file`, `accountId`, JSON `mapping`), `POST /imports/:id/confirm`, `GET /imports`, `GET /imports/:id`, `POST /imports/:id/reconcile`
- `GET|POST /savings-goals`, `PATCH /savings-goals/:id`, `POST /savings-goals/:id/status`, contribution link/unlink routes under `/savings-goals/:id/contributions`
- `GET /sync/changes`, `POST /sync/operations`

The auth challenge endpoint returns a one-time nonce. The frontend must bind that nonce into the Google or Apple web identity flow and submit the resulting ID token with the challenge ID. Provider JWT signatures, issuer, audience, algorithm, expiration and nonce are verified using provider JWKS. Provider credentials are intentionally not committed. Linking another provider requires an authenticated session plus a fresh verified identity token; matching email addresses never merge profiles.

Internal transfers are represented by one transfer document, so their principal cannot be half-committed. A transfer fee is stored separately from its principal and included in fee/outflow reports. Account balances and reports are derived from underlying records. Refunds are shown separately, excluded from income, and counted as receipts against net cash flow and net expenses.

## Imports and savings

CSV and `.xlsx` imports use an explicit column map. Preview stages row results and provenance only; it does not post transactions. Only stable external references are automatically rejected as duplicates. Same-date/same-amount matches are flagged for review, never merged automatically. Source files are not retained. Confirmation uses stable staged row IDs so a retry after interruption does not duplicate posted transactions; partial outcomes remain inspectable and retryable.

Savings goals retain schedule versions. Planned contributions are projections; actual progress is derived only from contribution links to posted account transactions or transfers. Schedule edits create a future version and do not rewrite historical versions. A goal does not move money.

## Configuration and deployment still required

- Configure Google and Apple web OAuth applications, allowed origins/callbacks, production client IDs, and Apple Developer account requirements. Validate the end-to-end web sign-in flow in staging.
- Provision MongoDB with network restrictions, TLS, least-privilege credentials, automated backups, and a tested restore procedure. This repository does not provide a hosting provider or production secrets manager.
- Serve the API behind HTTPS, restrict CORS to deployed frontend origins, and configure deployment health checks and monitoring.
- Agree and test real bank/mobile-money export samples before claiming provider compatibility. Generic CSV/XLSX parsing does not guarantee compatibility with a particular institution.
- The React PWA, IndexedDB operation queue, client-side pending/logout recovery, iPhone installation, and production deployment are outside this backend implementation.

## Tests

`npm test` runs Node's test runner, including financial/import/savings unit tests and MongoDB-backed API integration tests. The integration suite uses `mongodb-memory-server`; its MongoDB platform binary may need to be downloaded the first time the suite runs. Production dependency advisories can be checked with `npm audit --omit=dev`.
