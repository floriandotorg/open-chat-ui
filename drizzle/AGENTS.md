# Drizzle SQL output

Generated migration SQL in this directory must follow the safety rules in [`src/lib/server/db/AGENTS.md`](../src/lib/server/db/AGENTS.md). Reject or rewrite migrations that drop tables, truncate data, or recreate tables in ways that destroy rows.
