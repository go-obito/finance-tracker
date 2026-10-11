# Finance Tracker — Architecture and Requirements Plan

**Version:** 1.1  
**Status:** Planning document — no application code or repository changes  
**Target:** Personal finance tracker for Ghana cedi (GHS), installable on iPhone without App Store publication

## 1. Purpose and scope

Build a personal finance application that records money spent and received down to the pesewa, supports manual transaction entry and bank/mobile-money statement imports, synchronizes records through the cloud, works offline for transaction entry, and includes savings goals and challenges in the first release.

The app will be developed on a Windows PC. The first iPhone release will be a Progressive Web App (PWA) installed through Safari's **Add to Home Screen** feature.

This document describes the target architecture and requirements. It does not claim that any proposed feature has already been implemented or tested.

## 2. Confirmed decisions

- **Client:** React PWA, usable in desktop browsers and installable on iPhone.
- **Development environment:** Windows PC.
- **Backend:** Existing Python/FastAPI backend, subject to repository audit.
- **Database:** Cloud synced database.
- **Authentication:** Google and Apple sign-in.
- **Statement imports:** CSV and Excel `.xlsx`.
- **Offline behavior:** Full offline transaction entry, persisted locally and synchronized later.
- **Savings:** Goals and configurable savings challenges are included at launch.
- **Intended users:** Personal use.
- **Currency:** Ghana cedi (GHS) only for the first release; store amounts as integer pesewas.
- **Distribution:** No public App Store listing required for the PWA.

### Existing project baseline

The existing repository is `go-obito/finance-tracker`. The inspected project contains only a plan in the backend folder, frontend is empty.

## 3. System architecture

```text
┌─────────────────────────────────────────────┐
│ React PWA                                   │
│ iPhone Home Screen · Desktop browser        │
│ Dashboard · Transactions · Imports · Goals  │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│ Local data layer                             │
│ IndexedDB · Pending-operation queue          │
│ Local snapshot · Sync metadata               │
└──────────────────────┬──────────────────────┘
                       │ HTTPS API
┌──────────────────────▼──────────────────────┐
│ Python / FastAPI backend                     │
│ Authentication · Validation · Business rules│
│ Import processing · Synchronization          │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│ MongoDB                                      │
│ Users · Accounts · Transactions · Transfers  │
│ Imports · Categories · Savings goals         │
└─────────────────────────────────────────────┘

Supporting infrastructure:
HTTPS hosting · Secrets management · Backups · Monitoring
```

The frontend must never connect directly to MongoDB. All cloud access goes through the backend API. The backend is authoritative for permissions, validation and committed financial records.

The local data layer is more than a cache: it must persist offline entries and queue pending operations. The interface can display local changes immediately, but must distinguish pending or provisional changes from server-confirmed records.

### Responsibilities by layer

**Frontend / PWA**
- Render the dashboard, transaction forms, account views, reports, imports and savings challenges.
- Validate form inputs for usability.
- Persist offline data in IndexedDB.
- Queue and retry sync operations.
- Show pending, synced, failed and conflict states.
- Support iPhone and desktop layouts.

**Backend / API**
- Authenticate users and authorize every record access.
- Validate amounts, account effects, transfers, imports and challenge contributions.
- Enforce idempotency and concurrency rules.
- Parse and validate imported statement rows.
- Provide reporting and reconciliation endpoints.
- Keep the API versioned and documented.

**MongoDB**
- Persist cloud records.
- Enforce appropriate uniqueness constraints and indexes.
- Support user-scoped transaction queries and import deduplication.
- Store sync metadata and revision information where required.

**Hosting and operations**
- Serve the PWA and API securely over HTTPS.
- Store credentials in environment configuration or a secrets manager.
- Back up the database and test restoration.
- Monitor errors without leaking secrets or unnecessary financial details.

## 4. Proposed technology stack

| Layer | Proposed technology | Purpose |
|---|---|---|
| Frontend | React + Vite + JavaScript/JSX | Application interface |
| PWA | Web app manifest + service worker | Installation and application-shell caching |
| Local persistence | IndexedDB | Offline records, queue and local snapshot |
| Backend | Python + FastAPI | API, authentication and business rules |
| Database | MongoDB | Persistent cloud records |
| Database driver | A maintained MongoDB Python driver with async support | Backend database operations |
| Authentication | Google and Apple web identity flows | User sign-in |
| Hosting | HTTPS-capable frontend and backend hosting | Public access |
| Database hosting | Managed MongoDB service or securely managed MongoDB | Cloud persistence |
| Tests | Backend and frontend automated tests | Correctness and regression prevention |

MongoDB is not a drop-in replacement for SQLAlchemy/SQLite. The data-access layer, queries, indexes, transaction semantics and migration approach must be designed for MongoDB. The exact driver, hosting provider and authentication libraries should be selected after compatibility and deployment requirements are verified.

## 5. Functional requirements

### 5.1 Dashboard

The dashboard should provide:
- Current recorded balance for each account.
- Combined recorded balance, with clear account inclusion rules.
- Income, expenses, fees, interest and net cash flow for a selected period.
- Recent transactions.
- Spending by category and trends over time.
- Date filters such as this week, this month and custom range.
- Visible sync state when changes are pending or failed.

**Recorded balance is not necessarily a verified provider balance.** Until an account is reconciled against a real statement or provider balance, the app must not imply that the calculated figure is guaranteed to match the external account.

### 5.2 Transaction management

Users must be able to create, view, edit, search, filter and delete transactions, with appropriate confirmation and audit behavior.

A transaction should support:
- Amount in integer pesewas.
- Date and, when available, time.
- Type: income, expense, fee, interest, refund or adjustment.
- Account affected.
- Category and optional subcategory.
- Description or note.
- Source: manual entry or statement import.
- External reference, if provided by the source.
- Creation and modification timestamps.
- Sync state on the client.

Search and filters should include date, amount, account, category, description and transaction type.

**Money precision:** Store money as integer minor units rather than floating-point values. For example, GH₵12.35 is stored as `1235` pesewas. Convert to display formatting only at the presentation boundary. Do not silently round or discard small charges.

### 5.3 Accounts

Support accounts such as:
- Cash.
- Bank accounts.
- Mobile-money wallets.
- Savings accounts.
- Other user-defined accounts.

Each account needs a name, type, currency, opening balance, creation metadata and active/archived status. GHS is the only supported currency in the first release.

### 5.4 Transfers

Transfers between accounts owned by the user must not be counted as income or expenses.

For example, moving GH₵50 from one account to another is an internal movement, not new income or spending. Model it as a linked transfer or an equivalent consistent representation. Any transfer fee is a separate expense.

Transfer creation must avoid a state where only one side of the movement is committed. Use a consistency strategy supported by the chosen MongoDB deployment, or a carefully designed representation that can be safely retried and reconciled.

### 5.5 Categories and fees

Users can create, rename, archive and organize their own categories. Suggested starting categories include food, transport, bills, shopping, salary, gifts, savings, bank fees, mobile-money fees and interest. These are defaults, not fixed categories.

Fees should be recorded distinctly when the source or user confirms them. For example, a GH₵100 payment plus a GH₵1 fee may be represented as a GH₵100 expense and a separate GH₵1 fee if that matches the actual transaction. The app must not invent fees or interest.

### 5.6 Statement imports: CSV and Excel

Required workflow:

1. Select a CSV or `.xlsx` file.
2. Validate file type, size and structure.
3. Parse available columns.
4. Map date, amount, debit/credit, description, reference and optional balance columns.
5. Preview parsed rows before saving.
6. Identify invalid rows and likely duplicates.
7. Allow the user to resolve ambiguous rows and confirm the import.
8. Commit accepted transactions and import metadata.
9. Report exact counts for imported, skipped and rejected rows.
10. Reconcile statement balances where possible.

Import safeguards:
- Previewing must not alter balances.
- Re-importing a statement must not blindly duplicate records.
- Stable provider transaction references should be used when available.
- Without stable references, use cautious matching and flag uncertain matches for review.
- Same-date/same-amount transactions must not be merged automatically without adequate evidence.
- Invalid rows need actionable explanations.
- Failed or partial imports must leave records consistent and be recoverable.
- Set file-size and processing-time limits.
- Define whether source files are retained, for how long, and why.

CSV and `.xlsx` support does not imply universal compatibility with every bank or mobile-money provider. Test actual sample exports from the providers to be supported. Date formats, Excel date serials, decimal separators, debit/credit conventions and negative amounts require explicit parsing rules. Do not trust spreadsheet formulas as executable logic.

### 5.7 Reconciliation

Where a statement provides an opening or closing balance, compare it with the app's calculated balance for the same account and period. Report differences and the transactions contributing to them. Do not automatically invent an adjustment to force balances to match; require user review and explicit confirmation for adjustments.

### 5.8 Savings goals and challenges — launch requirement

Savings features must be based on actual transactions, not merely on a progress counter.

Support:
- Create a goal with name, target amount and optional target date.
- Configure a contribution schedule: daily, weekly, monthly or custom.
- View planned contributions, actual contributions and progress.
- Link actual contributions to qualifying transactions.
- Pause, resume or cancel a challenge.
- Track missed contributions and optional catch-up behavior.
- Show progress and remaining target.
- Avoid counting the same deposit twice if it is both imported and linked to a challenge.

The challenge engine must use configurable rules rather than hardcoding a single schedule. A schedule should define its start date, frequency, contribution formula, end condition, handling of missed periods and behavior when future settings change. Historical contributions must not be rewritten when future rules change.

Planned and actual amounts must remain distinct. If GH₵25 was planned but only GH₵15 was deposited, record the actual GH₵15 and show the shortfall. Do not present the full planned amount as deposited.

A challenge schedule does not itself move money. Actual contributions must link to real transactions. Progress should be derived from actual qualifying contributions and remain verifiable against the underlying records.

### 5.9 Cloud synchronization

Required behavior:
- New transactions sync to the cloud.
- Updates and deletions propagate.
- The client shows pending, synced, failed and conflict states.
- Retrying a failed request does not duplicate a record.
- Concurrent edits do not silently overwrite each other.
- Logout clears private local state according to the local-data policy.
- A failed sync is never reported as successful.

Use stable IDs for client-created transactions and idempotency keys for queued operations. Server records should have a revision/version marker or equivalent concurrency control. A stale update should result in a conflict response or other explicit resolution, not silent data loss.

For personal use, a visible conflict-resolution flow is a reasonable initial design. Real-time push updates are optional; sync-on-open, foreground and reconnection can be sufficient for the first release.

### 5.10 PWA and iPhone behavior

The app must:
- Be served over HTTPS.
- Include a valid web app manifest, app name, icons and display settings.
- Be installable from Safari using Add to Home Screen.
- Provide a responsive, touch-friendly interface.
- Cache the application shell for offline launch.
- Use IndexedDB for offline records and pending operations.
- Clearly show offline status and unsynchronized changes.
- Handle safe areas, keyboard behavior and small screens.
- Avoid relying on hover-only controls.

A PWA does not have every capability of a native iOS app. Background synchronization can be constrained by iOS. The app must retry pending operations when it opens, returns to the foreground or reconnects. First-time authentication, provider sign-in and some cloud operations require connectivity.

## 6. Authentication: Google and Apple

The sign-in screen should offer:
- Continue with Google.
- Continue with Apple.

The frontend initiates the provider flow. The backend must validate the identity response, issuer, audience, signature and relevant security parameters before creating an application session.

Required flow:
1. User selects a provider.
2. Provider authenticates the user.
3. Backend validates the response.
4. Backend resolves the provider identity to an application user.
5. App receives a secure session or equivalent credential.
6. Subsequent API requests are authenticated and user-scoped.

Store the provider's stable subject identifier and the application's own user ID. Do not use email alone as the permanent identity key.

**Account linking is required.** If the user signs in with Apple and later uses Google, do not automatically create duplicate profiles or merge accounts just because email addresses appear similar. Linking must require an explicit, secure verification flow.

Plan for provider configuration, callback/redirect URLs, allowed origins, secrets, logout, session expiration and provider unavailability. Because this is a PWA, configure web sign-in flows; native-only Apple/Google configuration is insufficient. Verify Apple's current setup and developer-account requirements before implementation.

## 7. Data model

| Entity | Responsibility |
|---|---|
| User | Application identity, preferences, timezone and account status |
| Identity provider link | Google or Apple subject identifier associated with a user |
| Account | Name, type, currency, opening balance and status |
| Transaction | Amount in pesewas, type, account, date, category, source and reference |
| Transfer | Linked movement between two accounts and any separate fee |
| Category | User-managed classification and archive status |
| Import job | File metadata, account, column mapping and processing outcome |
| Import row | Row-level parsing, validation, duplicate status and resulting transaction |
| Savings goal | Target, dates and status |
| Challenge schedule | Frequency, contribution formula and schedule settings |
| Planned contribution | Expected amount and due date |
| Actual contribution link | Connection between an actual transaction and a challenge |
| Sync operation | Pending create/update/delete operation, stable ID and retry state |
| Audit metadata | Creation, modification and deletion information |

### Data rules

1. All records must be scoped to the authenticated user.
2. Store money in integer pesewas.
3. Use consistent timestamps and retain source dates where relevant.
4. Give transactions and sync operations stable identifiers.
5. Preserve import provenance.
6. Use controlled edits/deletions and audit metadata or reversible deletion where appropriate.
7. Ensure transfers do not inflate income or expenses.
8. Ensure challenge contributions link to actual movements.
9. Make balances and goal progress recalculable or verifiable from underlying records.
10. Design MongoDB indexes for user-scoped date queries, account queries, stable source references, import deduplication and sync lookups.

For the initial release, balances may be calculated from opening balances and posted transactions. If cached summaries are later added for performance, they must be derived from the underlying records and independently verifiable. Pending, rejected or deleted records must not accidentally affect posted balances.

## 8. API architecture

Use a documented, versioned API such as `/api/v1/`. Final endpoint names should be selected during implementation.

| API area | Responsibilities |
|---|---|
| Authentication | Provider sign-in, session handling and logout |
| Accounts | Create, list, update and archive accounts |
| Transactions | Create, list, search, update and delete |
| Transfers | Move money between accounts consistently |
| Categories | Manage user-defined categories |
| Dashboard | Return balances, totals and spending summaries |
| Imports | Upload, preview, confirm and inspect results |
| Synchronization | Submit pending operations, retrieve changes and resolve conflicts |
| Reconciliation | Compare app balances with statement balances |
| Savings goals | Manage goals, schedules, planned and actual contributions |

The backend must validate all input even if the frontend validates it. Include pagination, upload limits, consistent error responses, request authentication, authorization checks and API documentation.

## 9. Security and privacy

Minimum requirements:
- Secure Google and Apple identity verification.
- Session expiration, logout and secure session handling.
- Authorization checks for every record and operation.
- HTTPS for all production traffic.
- Secrets only in backend environment configuration or a secrets manager.
- No database credentials or private tokens in frontend code or Git.
- Strong password hashing only if passwords are added as a future option.
- Upload validation, file-size limits and safe spreadsheet handling.
- Minimal sensitive data stored locally.
- A defined local-session and logout policy.
- Backups and tested restoration.
- Operational logging without passwords, tokens or unnecessary financial details.
- Export and deletion procedures.
- A privacy policy before sharing the app with others.

Even though the initial product is personal, the API must not rely on obscurity or client-side filtering to protect records.

## 10. Offline data and conflict handling

The local workflow should be:
1. Validate the transaction locally.
2. Persist the transaction and pending operation in IndexedDB.
3. Display it locally with a pending-sync indicator.
4. Submit it when the backend is reachable.
5. Let the server validate and persist it idempotently.
6. Mark it synced only after acknowledgement.
7. Reconcile server changes and any conflicts.

Important edge cases:
- A transaction is entered offline.
- The app closes or the phone restarts before sync.
- A request is submitted twice after a timeout.
- The server saves a transaction but the client never receives the response.
- The same transaction is edited on two sessions.
- An import includes a transaction already entered manually.
- An account changes while an import is being processed.
- The user logs out with pending changes.
- A database backup needs to be restored.

The app must define what happens to pending records at logout. It should not silently discard unsynced transactions. Warn the user and provide a safe way to sync or explicitly export/recover pending entries before clearing private local state.

## 11. Reports and financial calculations

Define reporting semantics before implementing charts.

| Metric | Rule |
|---|---|
| Total income | Posted income transactions in the selected period |
| Total expenses | Posted expense transactions in the selected period |
| Fees | Posted fees shown separately and included in outflow where appropriate |
| Interest earned | Posted interest credited to an account |
| Net cash flow | Money received minus money paid out, excluding internal transfers |
| Account balance | Opening balance plus net effect of posted account transactions |
| Category spending | Eligible expense transactions grouped by category |
| Savings progress | Actual qualifying contributions compared with the goal target |

Refunds require a consistent policy; for example, they may reduce net spending rather than be counted as new income. The same rule must be used across reports.

Moving money between tracked accounts is a transfer, not an expense. Moving money to a savings account should not automatically count as spending if both accounts are tracked. The app may report the amount saved separately.

Charts are a presentation of data, not the source of truth. Dashboard totals should be testable against independently calculated transaction totals.

## 12. Deployment and environments

### Development
- Windows PC.
- Git.
- Compatible Python and Node.js versions.
- Local frontend and backend.
- Development MongoDB database.
- Environment configuration for local services.
- Repeatable setup instructions and test commands.

The existing backend configuration specifies Python 3.14 or newer. Verify compatibility among this requirement, the selected database driver and the target hosting runtime before committing to deployment.

### Staging
Use a deployed test environment to validate authentication callbacks, HTTPS, imports, offline behavior, synchronization, database migrations and iPhone installation before production release.

### Production
- Stable HTTPS URL for the PWA.
- Securely deployed API.
- Managed or securely operated MongoDB.
- Restricted database network access.
- Production secrets and provider callback configuration.
- Automated backups and tested restoration.
- Monitoring and error reporting.
- Documented deployment and rollback procedures.

The frontend and backend can be deployed together or separately. Choose based on cost, reliability, routing, CORS and runtime requirements rather than assumption.

## 13. Testing requirements

| Area | Required verification |
|---|---|
| Money arithmetic | Pesewa precision, totals and rounding |
| Transactions | Create, edit, delete, search and filter |
| Accounts | Opening balances, account effects and archived accounts |
| Transfers | Both sides remain consistent; no income/expense inflation |
| Imports | Valid and malformed files, duplicate handling, missing fields and partial failure |
| Authentication | Provider validation, session expiration and user isolation |
| Offline queue | Persistence across restarts, retry and duplicate prevention |
| Conflicts | Concurrent edits are surfaced and resolved safely |
| PWA | Home Screen installation, responsive UI, offline launch and reconnection |
| Reports | Dashboard matches independently calculated totals |
| Savings challenges | Schedule calculations, missed contributions and actual contribution links |
| Recovery | Export works and database restoration is verified |
| Security | Unauthorized access and cross-user access attempts are rejected |

Use synthetic fixtures for automated tests, and test with representative statement exports from actual providers before claiming support for those formats.

## 14. Implementation roadmap

### Phase 1 — Repository audit and migration planning
Inspect the current routes, models, services, tests, configuration and tracked database files. Determine what works, what is incomplete and whether data needs migrating from SQLite.

**Exit criterion:** verified baseline, data-preservation plan and approved MongoDB migration approach.

### Phase 2 — Backend foundation and authentication
Establish the MongoDB data model, Google/Apple sign-in, user authorization, precise money representation, transactions, accounts, transfers and versioned API.

**Exit criterion:** authenticated API and financial arithmetic tests pass.

### Phase 3 — Core finance interface
Replace the starter interface with dashboard, account management, manual transactions, categories, transfers, search and reports.

**Exit criterion:** core online workflows work against the API.

### Phase 4 — Statement imports and reconciliation
Add CSV and `.xlsx` parsing, column mapping, preview, duplicate handling, import history and balance reconciliation.

**Exit criterion:** agreed statement formats import safely and repeatably.

### Phase 5 — Savings goals and challenges
Implement configurable schedules, planned contributions, actual transaction links, progress and missed-contribution handling.

**Exit criterion:** planned and actual savings are always distinct and totals reconcile.

### Phase 6 — Offline-first PWA and synchronization
Implement IndexedDB persistence, operation queue, idempotent server processing, sync status, conflict handling and reconnection behavior.

**Exit criterion:** offline and reconnection scenarios pass on the target iPhone.

### Phase 7 — Production deployment and recovery testing
Configure hosting, HTTPS, provider callbacks, secrets, backups, monitoring, export and restore testing.

**Exit criterion:** deployment and recovery procedures have been verified.

## 15. Definition of done

The first release is not complete until:
- [ ] Google and Apple sign-in work securely.
- [ ] Users can create, edit, search and review transactions.
- [ ] Money is stored and calculated without floating-point errors.
- [ ] Account balances and transfers are correct.
- [ ] Dashboard totals match independent calculations.
- [ ] CSV and `.xlsx` imports support the agreed formats and show a preview.
- [ ] Re-importing statements does not silently duplicate transactions.
- [ ] Fees, interest and refunds follow consistent reporting rules.
- [ ] Savings challenges calculate planned schedules and actual progress correctly.
- [ ] Actual contributions link to real transactions without double-counting.
- [ ] Offline entries persist across app restarts and sync without duplicates.
- [ ] Pending, failed and conflicting sync operations are visible.
- [ ] The app installs on iPhone Home Screen without App Store publication.
- [ ] Production data is protected by authentication and authorization.
- [ ] Database backups and restoration have been tested.
- [ ] Export and deletion workflows are documented.
- [ ] Existing database files have been inspected and preserved or migrated appropriately.
- [ ] Automated tests pass and the deployed app has been tested on the target device.
- [ ] Setup, configuration, migration and deployment instructions are documented.

## 16. Decisions still to finalize during the audit

The main product choices are confirmed. The following implementation details remain open:
- Hosting provider and managed MongoDB deployment.
- Exact Google/Apple authentication libraries and provider setup.
- Whether existing SQLite data needs migration or can be archived.
- Specific bank/mobile-money statement formats to support first, based on real sample files.
- Local-data protection and pending-transaction behavior at logout.
- Detailed rules for missed savings contributions and schedule changes.

These choices should be made using repository inspection, provider requirements and test data—not guessed.

## 17. Immediate next step

Audit `go-obito/finance-tracker` before changing files. Document the current implementation, inspect tracked database files safely, review tests, and prepare a data-preservation and migration plan. Only then should implementation begin.

**No code has been written and no repository changes have been made as part of this planning document.**
