# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private
vulnerability reporting (the repository's **Security → Report a vulnerability** tab).
Include reproduction steps and the affected version. You will get an acknowledgement
within a few days.

## Scope notes

- Tenant and user identity must always come from the authenticated session, never from
  request bodies. Reports that bypass this are in scope and high priority.
- Deletion (`forget`) must reach the store, the vector index and the recall cache.
- Local mode (`EVERSTATE_OFFLINE=true`, "Continue as local developer") is for development.
  Do not expose it to a network.

## Secrets

`.env`, service-account keys and `terraform.tfvars` are git-ignored. If you committed a
credential by mistake, rotate it immediately; removing it from history is not enough.
