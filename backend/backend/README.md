# Cadencia CreditFlow — Backend

Three-process Node.js backend: **API server**, **Oracle worker**, **Job worker**.

---

## Prerequisites

- Node.js 18+
- Redis (locally or via Docker: `docker run -p 6379:6379 redis:7`)
- `.env` file (copy from `.env.example`, fill in all values)

---

## Environment Variables

Copy `.env.example` → `.env` and set:

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | **YES** | Strong random hex (e.g. `openssl rand -hex 32`) |
| `ORACLE_MNEMONIC` | **YES** | 25-word Algorand mnemonic for the oracle wallet |
| `SUPABASE_URL` | **YES** | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | **YES** | Supabase service key (bypasses RLS) |
| `REDIS_URL` | YES | Redis connection URL (default: `redis://localhost:6379`) |
| `KYC_REGISTRY_APP_ID` | YES | Deployed KYC Registry app ID |
| `CREDIT_SCORE_APP_ID` | YES | Deployed CreditScore app ID |
| `LENDING_POOL_APP_ID` | YES | Deployed LendingPool app ID |
| `LOAN_MANAGER_APP_ID` | YES | Deployed LoanManager app ID |
| `ADMIN_ADDRESSES` | YES | Comma-separated admin wallet addresses |
| `MOCK_KYC` | No | Set `true` to auto-approve KYC in dev |

> ⚠️ **NEVER** commit `.env` to version control. `.gitignore` excludes it.

---

## Starting the Backend

### Option A — All 3 processes at once (recommended)

```bash
npm run dev:all
```

This uses `concurrently` to start all three processes with color-coded output.

### Option B — Individually (3 terminals)

```bash
# Terminal 1: API server
npm run api

# Terminal 2: Oracle worker (handles KYC writes, score updates, loan disbursement)
npm run oracle

# Terminal 3: Job worker (default checks, notifications, reminders)
npm run jobs
```

---

## Architecture

| Process | Script | Queue | Role |
|---|---|---|---|
| `api` | `api/src/server.js` | — | REST API, session management |
| `oracle` | `oracle-worker/src/oracle.js` | `oracle_tasks` | Signs + submits Algorand txns |
| `jobs` | `job-worker/src/jobs.js` | `job_tasks` | Background tasks, cron |

All processes share the same `.env` file and Redis instance.

---

## API Routes

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/nonce` | — | Request nonce for wallet sign |
| POST | `/api/auth/verify` | — | Verify Ed25519 signature |
| POST | `/api/auth/logout` | Session | Destroy session |
| GET | `/api/auth/me` | Session | Session status + isAdmin |
| POST | `/api/kyc/submit` | Session | Submit KYC form |
| GET | `/api/kyc/status/:address` | — | Poll KYC status |
| GET | `/api/kyc/admin/pending` | Admin | List pending KYC |
| POST | `/api/kyc/admin/approve` | Admin | Approve KYC |
| POST | `/api/kyc/admin/reject` | Admin | Reject KYC |
| GET | `/api/loans/my` | Session | List own loans |
| POST | `/api/loans/apply` | Session | Apply for loan |
| GET | `/api/loans/admin/pending` | Admin | List pending loans |
| POST | `/api/loans/admin/approve/:id` | Admin | Approve loan |
| POST | `/api/loans/admin/reject/:id` | Admin | Reject loan |
| GET | `/api/pool/stats` | — | Pool statistics |
| GET | `/api/pool/score/:address` | — | On-chain credit score |
| GET | `/api/health` | — | Health check |

---

*Cadencia CreditFlow — Algorand Testnet — v0.1.0*
