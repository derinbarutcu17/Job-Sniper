---
name: sniper
description: "Local job-intelligence and outreach workflow for jobs, companies, and public hiring contacts. Use /sniper with subcommands like onboard, run, digest, companies, and sheet sync."
user-invocable: true
metadata: { "openclaw": { "requires": { "bins": ["node", "npm"] } } }
---

# Sniper

Use this skill when the user wants to discover jobs, track companies, gather public hiring contacts, and sync the results into Google Sheets.

Run the local CLI with:

```bash
node {baseDir}/scripts/run-sniper.mjs <subcommand> [args...]
```

Core rules:

- Keep the local SQLite database as the source of truth.
- Collect only public job, company, and contact data.
- Never send applications or email anyone automatically.
- Use Google Sheets only when the user asks to sync or pull.

Primary commands:

- `onboard <text-or-path>`
- `run [--lane <lane>] [--company-watch]`
- `digest [limit]`
- `shortlist [limit]`
- `draft <job-id>`
- `companies [limit]`
- `contacts [company-id-or-key]`
- `enrich company <company-id-or-key>`
- `sheet sync`
- `sheet pull`

See `README.md` for setup, customization, workflow examples, privacy guidance, and configuration details.
