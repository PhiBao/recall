# Walrus Memory feedback — working draft for the Session form + Bug Bounty

The Session requires a feedback form (≥1 bug/friction + ≥1 improvement) and
rewards quality GitHub issues on `MystenLabs/MemWal` (repro steps,
expected vs actual, env: model, runtime, OS, SDK version). Collect entries
here during integration, then file them and link them in the form.

SDK: `@mysten-incubation/memwal 0.1.8` · Runtime: Node 22 / Next.js 15 (Linux)
Relayer: `https://relayer.memory.walrus.xyz` (mainnet)

## Bug / friction

### 1. (fill during integration)
- Steps to reproduce:
- Expected:
- Actual:
- Env:

## Improvement idea

### 1. Per-namespace blob accounting endpoint
- As an operator running the multi-tenant cookbook (one account, namespace per
  end user), I can prove "≥10 blobs" only by tracking `blob_id`s on my side.
  A relayer endpoint returning `{ namespace, blob_count }` (metadata only, no
  decryption) would make hackathon proof — and SaaS billing — trivial.
  `listNamespaces` returns `memory_count`, which partially covers this; verdict
  pending after mainnet testing.

## Filed issues

- [ ] _(link each filed issue here once submitted during Sep 18–Oct 9)_
