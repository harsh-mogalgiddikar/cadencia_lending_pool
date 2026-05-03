# Cadencia — Decentralized Lending Pool on Algorand

Cadencia is a decentralized MSME lending platform built on the **Algorand blockchain**. It combines on-chain smart contracts for KYC, credit scoring, and loan management with an off-chain Node.js backend and a React/Vite frontend.

> **Network:** Algorand Testnet  
> **Stack:** AlgoPy · Node.js · Express · React · Vite · Supabase · Redis · Docker

---

## Repository Structure

```
cadencia_lending_pool/
├── backend/
│   ├── backend/            # Node.js backend (API · Oracle · Job worker)
│   ├── contracts/          # Algorand smart contracts (AlgoPy/PyTEAL)
│   ├── scripts/            # Deployment scripts
│   └── docker-compose.yml  # Full stack orchestration
└── frontend/               # React + Vite + shadcn/ui frontend
```

---

## Smart Contracts

Five interconnected Algorand contracts written in **AlgoPy (PuyaPy)**:

| Contract | File | Purpose |
|---|---|---|
| `KYCRegistry` | `contracts/cadencia/kyc_registry.py` | On-chain KYC status, oracle-gated writes |
| `CreditScore` | `contracts/cadencia/credit_score.py` | Borrower credit scores (300–900), box storage |
| `LendingPool` | `contracts/cadencia/lending_pool.py` | ALGO liquidity pool, share minting, utilization cap |
| `LoanManager` | `contracts/cadencia/loan_manager.py` | Loan records in box storage, state machine |
| `RepaymentEscrow` | `contracts/cadencia/repayment_escrow.py` | 80/15/5 repayment splits |

### Compile Contracts

```bash
cd backend/contracts
algokit compile py cadencia/kyc_registry.py
algokit compile py cadencia/credit_score.py
algokit compile py cadencia/lending_pool.py
algokit compile py cadencia/loan_manager.py
algokit compile py cadencia/repayment_escrow.py
```

### Deploy Contracts

```bash
cd backend/scripts
node deploy.js
```

---

## Backend

Three-process Node.js backend sharing a single `.env` and Redis instance:

| Process | Entry Point | Role |
|---|---|---|
| `api` | `backend/api/src/server.js` | REST API — sessions, auth, KYC, loans, pool stats |
| `oracle` | `backend/oracle-worker/src/oracle.js` | Signs and submits Algorand transactions |
| `jobs` | `backend/job-worker/src/jobs.js` | Background cron — defaults, notifications |

### Prerequisites

- Node.js 18+
- Redis (`docker run -p 6379:6379 redis:7-alpine`)
- Supabase project (for DB + auth)
- `.env` file (see below)

### Environment Variables

Copy `.env.example` → `.env` inside `backend/backend/`:

```bash
cp backend/backend/.env.example backend/backend/.env
```

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | ✅ | Strong random secret (`openssl rand -hex 32`) |
| `ORACLE_MNEMONIC` | ✅ | 25-word Algorand mnemonic for the oracle wallet |
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | ✅ | Supabase service role key (bypasses RLS) |
| `REDIS_URL` | ✅ | Redis connection URL (default: `redis://localhost:6379`) |
| `KYC_REGISTRY_APP_ID` | ✅ | Deployed KYC Registry app ID |
| `CREDIT_SCORE_APP_ID` | ✅ | Deployed CreditScore app ID |
| `LENDING_POOL_APP_ID` | ✅ | Deployed LendingPool app ID |
| `LOAN_MANAGER_APP_ID` | ✅ | Deployed LoanManager app ID |
| `REPAYMENT_ESCROW_APP_ID` | ✅ | Deployed RepaymentEscrow app ID |
| `ADMIN_ADDRESSES` | ✅ | Comma-separated admin wallet addresses |
| `MOCK_KYC` | No | Set `true` to auto-approve KYC in dev |

> ⚠️ **Never commit your `.env` file.** It is excluded by `.gitignore`.

### Run Locally (without Docker)

```bash
cd backend/backend
npm install

# All 3 processes at once (recommended)
npm run dev:all

# Or individually
npm run api      # Terminal 1 — API on :3001
npm run oracle   # Terminal 2 — Oracle worker
npm run jobs     # Terminal 3 — Job worker
```

### API Routes

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/nonce` | — | Request nonce for wallet sign |
| POST | `/api/auth/verify` | — | Verify Ed25519 wallet signature |
| POST | `/api/auth/logout` | Session | Destroy session |
| GET | `/api/auth/me` | Session | Session status + isAdmin flag |
| POST | `/api/kyc/submit` | Session | Submit KYC form |
| GET | `/api/kyc/status/:address` | — | Poll KYC approval status |
| GET | `/api/kyc/admin/pending` | Admin | List pending KYC submissions |
| POST | `/api/kyc/admin/approve` | Admin | Approve KYC + write on-chain |
| POST | `/api/kyc/admin/reject` | Admin | Reject KYC submission |
| GET | `/api/loans/my` | Session | List own loans |
| POST | `/api/loans/apply` | Session | Apply for a loan |
| GET | `/api/loans/admin/pending` | Admin | List pending loan applications |
| POST | `/api/loans/admin/approve/:id` | Admin | Approve loan + disburse |
| POST | `/api/loans/admin/reject/:id` | Admin | Reject loan application |
| GET | `/api/pool/stats` | — | Lending pool statistics |
| GET | `/api/pool/score/:address` | — | On-chain credit score for address |
| GET | `/api/health` | — | Health check |

---

## Frontend

React 18 · Vite · TypeScript · Tailwind CSS · shadcn/ui · Zustand · React Query · Pera Wallet

### Prerequisites

- Node.js 18+
- `.env` file inside `frontend/`:

```env
VITE_API_URL=http://localhost:3001
VITE_LENDING_POOL_APP_ID=<your_app_id>
```

### Run Locally

```bash
cd frontend
npm install
npm run dev        # Dev server on http://localhost:8080
npm run build      # Production build
npm run test       # Run Vitest tests
```

---

## Docker (Full Stack)

The `docker-compose.yml` inside `backend/` orchestrates all services.

```
Services:
  redis          — Redis 7 (queues, nonces, sessions)
  api            — Express REST API on :3001
  oracle         — Algorand transaction signer (no port)
  jobs           — Background job worker (no port)
  frontend-dev   — Vite HMR dev server on :8080   [profile: dev]
  frontend       — nginx static production on :80  [profile: prod]
```

### Start Dev Stack

```bash
cd backend
docker compose --profile dev up --build
```

### Start Production Stack

```bash
cd backend
docker compose --profile prod up --build
```

> Set all required environment variables in `backend/backend/.env` before starting.

---

## Database

Cadencia uses **Supabase (PostgreSQL)** for off-chain state. Migrations live in:

```
backend/backend/supabase/migrations/
  001_initial_schema.sql   — core tables (users, kyc, loans)
  002_phase2_additions.sql — phase 2 additions
```

Run migrations from the Supabase dashboard or CLI:

```bash
supabase db push
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Algorand (Testnet) |
| Smart Contracts | AlgoPy (PuyaPy) |
| Backend | Node.js · Express · BullMQ |
| Database | Supabase (PostgreSQL) |
| Cache / Queues | Redis |
| Frontend | React 18 · Vite · TypeScript |
| UI Components | shadcn/ui · Tailwind CSS |
| State | Zustand · TanStack Query |
| Wallet | Pera Wallet (`@perawallet/connect`) |
| Containers | Docker · nginx |

---

## License

MIT © Harsh Mogalgiddikar
