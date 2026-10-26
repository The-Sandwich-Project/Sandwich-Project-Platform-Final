---
name: Development query target
description: Distinguish managed SQL targets, workspace Neon connection settings, and the live deployment's actual database.
---

The managed development SQL target and the workspace application's configured development database are different targets in this project. Do not assume a successful development SQL-tool query describes the workspace application's data.

**Why:** A read-only investigation found newer intake submissions in the app-selected development connection that were absent from the managed development SQL target. Trusting the latter alone would have incorrectly reported the submissions missing.

**How to apply:** Resolve the application's current connection selection before investigating workspace records. Use that connection for read-only checks without printing connection strings or credentials. Validate production targeting separately rather than assuming the workspace's default connection is production.

The managed production SQL target also differs from the Neon target selected by the workspace's production-named connection settings. Neither the tool's `production` label nor a workspace secret's name alone establishes the live deployment's actual connection.

**Why:** Error-log tables were populated in the managed production query target but empty when queried through both production-named workspace connection settings. Earlier claims equating the managed target with the published app were not verified.

**How to apply:** Label results by the connection actually tested. Establish the deployed process's target separately before describing a query result as live-app data; deployment-scoped configuration can differ from workspace configuration.
