# Cadencia Credit — Smart Contracts

Phase 1 contracts for the Cadencia decentralized MSME lending platform on Algorand.

## Contracts

| Contract | File | Purpose |
|---|---|---|
| KYC Registry | `cadencia/kyc_registry.py` | On-chain KYC status, oracle-gated writes |
| Credit Score | `cadencia/credit_score.py` | Borrower credit scores (300–900), box storage |
| Lending Pool | `cadencia/lending_pool.py` | ALGO liquidity pool, share minting, utilization cap |
| Loan Manager | `cadencia/loan_manager.py` | All loan records in box storage, state machine |
| Repayment Escrow | `cadencia/repayment_escrow.py` | 80/15/5 repayment splits |

## Compile

```bash
cd contracts
algokit compile py cadencia/kyc_registry.py
algokit compile py cadencia/credit_score.py
algokit compile py cadencia/lending_pool.py
algokit compile py cadencia/loan_manager.py
algokit compile py cadencia/repayment_escrow.py
```

## Deploy

See `scripts/deploy.py` for the full deployment pipeline.
