---
name: Development query target
description: Distinguish managed SQL targets, workspace Neon connection settings, and the live deployment's actual database.
---

The managed development SQL target and the workspace application's configured development database are different targets in this project. Do not assume a successful development SQL-tool query describes the workspace application's data.

**Why:** A read-only investigation found newer intake submissions in the app-selected development connection that were absent from the managed development SQL target. Trusting the latter alone would have incorrectly reported the submissions missing.

**How to apply:** Resolve the application's current connection selection before investigating workspace records. Use that connection for read-only checks without printing connection strings or credentials. Validate production targeting separately rather than assuming the workspace's default connection is production.

The managed production SQL target also differs from the Neon target selected by the workspace's production-named connection settings. Neither the tool's `production` label nor a workspace secret's name alone establishes the live deployment's actual connection.

The authenticated live app's client-error API was subsequently matched to the managed production query target by record identifiers and timestamps. The workspace's production-named connection settings led to a different dataset. For that verified configuration, use the managed production target for live-data queries, not the workspace's production-named aliases.

**Why:** The user supplied an authenticated live API response, allowing direct comparison instead of relying on environment labels. It matched the populated managed production table, not the empty tables reached through workspace production-named settings.

**How to apply:** Label results by the connection actually tested. Deployment-scoped configuration can differ from workspace configuration. Revalidate the mapping after connection or deployment configuration changes; do not repoint the live app to an empty database merely to make it match a workspace alias.
