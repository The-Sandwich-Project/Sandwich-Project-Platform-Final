---
name: Development query target
description: Avoid confusing the managed development SQL target with the database actually used by the workspace app.
---

The managed development SQL target and the workspace application's configured development database are different targets in this project. Do not assume a successful development SQL-tool query describes the workspace application's data.

**Why:** A read-only investigation found newer intake submissions in the app-selected development connection that were absent from the managed development SQL target. Trusting the latter alone would have incorrectly reported the submissions missing.

**How to apply:** Resolve the application's current connection selection before investigating workspace records. Use that connection for read-only checks without printing connection strings or credentials. Validate production targeting separately rather than assuming the workspace's default connection is production.
