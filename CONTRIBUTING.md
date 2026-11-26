# Contributing to Everstate

Thanks for helping. Everstate is a small, opinionated codebase; the fastest way to a
merged change is to keep it focused and tested.

## Set up

```bash
make install                 # uv sync + web + landing dependencies
cp .env.example .env         # offline mode, no credentials needed
make test-core               # engine laws and adapter contracts
make test                    # builds the console, then the full suite (Redis / Ollama / cloud tests skip themselves)
```

Optional, for semantic retrieval and benchmarks: `make simulator-native` or `make simulator`.

## Ground rules

1. **Respect the laws.** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) lists the invariants
   (dependency inversion, tenant isolation, no ungated writes, supersede-never-overwrite, ...).
   Each has a test; a change that weakens one needs a strong argument.
2. **SDKs live in `adapters/` only.** The core imports no database or cloud client.
3. **New adapter?** Implement the port, then run the public contract kit
   (`everstate.testing`). See [docs/ADAPTERS.md](docs/ADAPTERS.md).
4. **Numbers need receipts.** Any performance or quality claim must come from
   `python -m benchmarks.run`, with model ids pinned in the results file.
5. **Console changes:** `cd web && npm run typecheck && npm run build`.

## Pull requests

- Branch from `main`, keep PRs small, describe the *why*.
- CI runs the Python tests, the console typecheck/build and the landing build.
- Never commit `.env`, service-account keys, `terraform.tfvars` or Terraform state.

By contributing you agree that your contribution is licensed under Apache 2.0.
