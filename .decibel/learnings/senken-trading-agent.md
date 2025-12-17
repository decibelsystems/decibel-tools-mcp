# Technical Learnings: senken-trading-agent

> A living document of lessons learned, gotchas, and insights.

---

### [2025-12-16 23:12:06] Fail-fast wallet identity guard prevents HL SDK random-wallet fallback
**Category:** debug | **Tags:** `hyperliquid`, `wallet`, `config`, `execution`, `fail-fast`, `defensive`

Symptom: bots running and signals/cache look healthy, but no trades because the Hyperliquid SDK ends up operating under a different (apparently random) wallet/address than the configured funded wallet.

Root pattern: wallet/private-key config parsing/formatting fails (quotes/newlines/0x handling/invalid hex/wrong length), and our code path (or SDK wrapper) effectively falls back to generating a LocalAccount / random wallet rather than failing hard.

Defensive fix (recommended):
- Sanitize env inputs (strip whitespace + surrounding quotes).
- Validate private key strictly (hex-only, 32 bytes / 64 hex chars, optional 0x prefix).
- Derive signer address from private key and compare to configured wallet address.
- Hard-fail startup on mismatch or parse error (no fallback account creation).
- Log signer address used by the SDK + configured address + key length (never log the key).

Outcome: makes "wrong wallet" impossible to run silently; converts silent execution failures into loud config errors and restores trade execution reliability once config is correct.

---
### [2025-12-16 23:27:26] Use GoldenPathBot as the canonical smoke-test for signal→PDE→execution
**Category:** process | **Tags:** `golden-path`, `testbot`, `debugging`, `smoke-test`, `process`

When debugging Senken, start with the GoldenPathBot (known-good, minimal surface area) to re-validate the entire pipeline end-to-end before chasing complex bot behavior.

Golden path run should explicitly verify each boundary:
1) Config ingestion (wallet/private key parse + derived signer address)
2) Signal ingestion (raw signals present + correct source labels)
3) PDE decisions (decision created + reason codes + source labels)
4) Execution intent (order payload built)
5) Exchange submission (HL SDK signer address + ack/err)

Use its logs/outputs as the baseline; then diff failing bots against it (env, strategy enablement, registry, mapping fields). This prevents agents from jumping to conclusions and keeps debugging evidence-driven.

---
