# Job Sniper

`job-sniper` is a local-first OpenClaw skill for finding jobs, tracking companies, collecting public hiring contacts, and running a structured outreach workflow.

V2 keeps the existing discovery engine, but adds a second layer on top: deterministic decision support for what to do next, which route to use, and what angle to lead with.

The current foundation is also split into a local engine boundary:
- typed service layer
- typed read models and dossier views
- first-class run records
- adapter-style Google Sheets sync
- CLI as a presentation shell over the engine, not the engine itself

It keeps a SQLite database as the source of truth, searches the public web plus common ATS surfaces, ranks opportunities against your profile, recommends the next action, and syncs the output into Google Sheets.

## Talk to It

You do not need to memorize a CLI manual to use this. Because it is an OpenClaw skill, you can just talk to your agent naturally.

Tell OpenClaw what you want:

- "Find me senior frontend roles in London."
- "Look at the companies we found yesterday and pull the public contacts for the top three."
- "Draft a cover letter for the Stripe job."
- "Sync our current shortlist to Google Sheets."

You act as the director. The agent figures out which commands to run and handles the heavy lifting behind the scenes.

## At a glance

- Local-first storage with SQLite
- Profile-aware job ranking instead of raw keyword matching
- Strategic recommendation layer on top of raw score
- Route intelligence and pitch-angle generation
- Company and public contact discovery
- Company dossier and outcome-learning workflow
- Google Sheets sync with manual columns preserved
- OpenClaw-friendly command surface for scouting, reviewing, and drafting
- Web-app-ready internal contracts without introducing a server yet

## What it is

This repo runs as a role-pack-driven engine.

That means:

- lanes are data-driven, not hardcoded enums
- the shipped presets are just built-in packs, not special-case code paths
- you can define new lanes for other fields in `config.json` without editing the scoring engine, query builder, or CLI

V2 also adds a deterministic-first judgment layer:

- recommendation: `apply_now`, `cold_email`, `enrich_first`, `watch`, `discard`
- route intelligence: `ats_only`, `ats_plus_cold_email`, `direct_email_first`, `founder_or_team_reachout`, `watch_company`, `no_action`
- pitch angle generation with visible evidence
- company dossier mode
- outcome logging and route/theme feedback loops

## What it does

- Onboards a profile from raw text or a local file path
- Searches across:
  - web search results
  - RSS feeds
  - ATS/job platforms
  - structured job pages via JSON-LD
- Tracks:
  - jobs
  - companies
  - public contacts
  - manual notes and outreach state
- Recommends:
  - what to do next
  - which route to use
  - what pitch angle to use
- Drafts outreach text for specific jobs
- Tracks outreach and outcome logs to learn which routes are working
- Syncs to Google Sheets and pulls manual edits back into local state

## Quick start

Install and smoke test:

```bash
npm install
npm run typecheck
npm test
npm run sniper -- help
```

Basic flow:

```text
/sniper onboard <cv text or file path>
/sniper run
/sniper digest
/sniper companies
/sniper sheet sync
```

If your OpenClaw surface does not expose native skill commands, use:

```text
/skill sniper run
```

## Command surface

OpenClaw should expose this as `/sniper`.

```text
/sniper onboard <cv text or file path>
/sniper run [--lane <lane-id>] [--company-watch]
/sniper digest [limit]
/sniper shortlist [limit]
/sniper triage [limit]
/sniper draft <job-id>
/sniper explain <job-id>
/sniper route <job-id>
/sniper pitch <job-id>
/sniper companies [limit]
/sniper dossier <company-id-or-key>
/sniper contacts [company-id-or-key]
/sniper enrich company <company-id-or-key>
/sniper contact log <company-id-or-key> --channel <email|linkedin|ats|founder> [--job <job-id>] [--note <text>]
/sniper outcome log <company-id-or-key> --result <no_reply|reply|call|interview|rejected|positive_signal> [--job <job-id>] [--note <text>]
/sniper experiments
/sniper blacklist add [--company | --keyword] [--lane <lane>] <term>
/sniper sheet sync
/sniper sheet pull
/sniper stats
/sniper export json [path]
```

## Role packs and customization

This tool is not tied to one person, one city, or one hiring market.

Main customization points:

- `config.json`
  Set target cities, countries, remote preferences, RSS feeds, ATS boards, blacklists, sheet tabs, and your lane definitions.
- `profile/cv.md` and `profile/profile.json`
  Local runtime profile files created and updated through onboarding.
- Role packs
  Add, remove, or tune lanes for any field.
- Sheet workflow
  Adapt the `Jobs`, `Companies`, and `Contacts` tabs to your own research and outreach process.

Each lane is a role pack with:

- `label`
- `type`
- `queries`
- `keywords`
- optional `queryTerms`
- optional `profileSignals`
- optional `titleFamilies`
- optional `mismatchTerms`
- optional `startupTerms`
- optional `companyTerms`

Typical uses:

- switch the search market from one city or country to another
- run a remote-only search
- use it for one candidate, a recruiting workflow, or a coaching workflow
- add a new field like policy, biotech, legal ops, data science, or climate research
- use it only for research, or for research plus outreach

### Example: add a new lane for climate policy

```json
{
  "lanes": {
    "policy_jobs": {
      "label": "Policy Jobs",
      "type": "job",
      "enabled": true,
      "queries": {
        "tr": [],
        "en": [
          "Berlin climate policy jobs",
          "Germany public affairs analyst roles"
        ]
      },
      "keywords": ["policy analyst", "climate policy", "public affairs"],
      "queryTerms": ["policy analyst", "public policy associate"],
      "profileSignals": ["policy", "climate policy", "research", "public affairs"],
      "titleFamilies": [
        {
          "family": "Policy Analyst",
          "terms": ["policy analyst", "public policy associate"]
        }
      ],
      "mismatchTerms": ["sales", "account executive"]
    }
  },
  "blacklist": {
    "lanes": {
      "policy_jobs": []
    }
  }
}
```

After adding the lane:

```text
/sniper run --lane policy_jobs
/sniper blacklist add --lane policy_jobs --keyword lobbying
```

## Typical workflow

### 1. Onboard a profile

Paste text directly:

```text
/sniper onboard I am a frontend engineer focused on devtools, based in London, open to hybrid and remote roles...
```

Or use a local file:

```text
/sniper onboard /absolute/path/to/cv.pdf
```

### 2. Run discovery

```text
/sniper run
/sniper run --lane design_jobs
/sniper run --lane policy_jobs
/sniper run --company-watch
```

This will:

- search configured sources
- normalize job and company records
- enrich public contact surfaces
- score the jobs against the onboarded profile

### 3. Review the output

```text
/sniper digest
/sniper shortlist
/sniper triage
/sniper companies
```

Use `digest` for a score-first view.

Use `triage` for an action-first view. That is the V2 shortlist that answers "what deserves energy now?"

### 4. Enrich promising companies

```text
/sniper enrich company <company-id-or-key>
/sniper contacts <company-id-or-key>
/sniper dossier <company-id-or-key>
```

`companies` is a lightweight list view.

`dossier` is the company strategy brief: why it matters, best route, best angle, contacts found, open roles, and whether to act now or watch.

### 5. Draft outreach

```text
/sniper draft 42
/sniper route 42
/sniper pitch 42
```

V2 stays deterministic-first and inspectable. It does not auto-send emails, auto-apply, or hide decisions behind a black box.

### 6. Log outcomes

```text
/sniper contact log north --channel email --job 42 --note intro sent
/sniper outcome log north --result reply --job 42 --note recruiter replied
/sniper experiments
```

Those logs feed the route/theme feedback loop so the tool can surface what is actually producing replies and positive signals.

### 7. Sync to Google Sheets

```text
/sniper sheet sync
/sniper sheet pull
```

## Google Sheets

For live Sheets sync, provide one of:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`

Optional:

- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_GOOGLE_FOLDER_ID`

If no sheet ID is configured, first sync creates a spreadsheet named `Job Sniper`.

V2 adds new strategy columns to the `Jobs`, `Companies`, and `RunMetrics` tabs while preserving the existing manual-edit workflow.

Examples:

- `Jobs`: recommendation, recommended route, pitch theme, pitch angle, outreach leverage, interview probability band, opportunity cost band
- `Companies`: recommendation, best route, pitch theme, direct contact count, reachable now, priority band
- `RunMetrics`: actionable count, route mix, direct-contact company count, average outreach leverage

Default tabs:

- `Jobs`
- `Companies`
- `Contacts`
- `RunMetrics`

Manual columns preserved on sync:

- `manual_status`
- `owner_notes`
- `priority`
- `outreach_state`
- `manual_contact_override`

## AI workflow examples

### OpenClaw + Google Sheets

Use the sheet as the operational board:

- `Jobs` for ranking and outreach state
- `Companies` for company research
- `Contacts` for public hiring surfaces

Example:

```text
Open the Job Sniper Google Sheet, find the high-priority rows, visit the job pages, and draft outreach for the top 3.
```

### ChatGPT or Gemini

You can:

- paste selected rows into the chat
- export CSV and upload it
- ask the model to rank opportunities, compare roles, or rewrite outreach

Example:

```text
Here is my Jobs sheet export. Rank the top 10 roles by likely interview conversion.
```

### Notion

This repo does not write to Notion directly, but the workflow is simple:

1. Sync to Google Sheets
2. Mirror selected rows into Notion
3. Use Notion for dossiers, prep notes, and application tracking

## Privacy and secrets

This project is designed to keep runtime data out of git.

Ignored local state includes:

- `profile/`
- `data/*.db`
- `data/*.html`
- `.env`

Expected secrets should come from environment variables, not committed files:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`
- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_GOOGLE_FOLDER_ID`

## Repo structure

- [README.md](README.md)
  Main documentation
- [SKILL.md](SKILL.md)
  Minimal OpenClaw skill wrapper
- [src/cli.ts](src/cli.ts)
  Command parsing
- [src/search](src/search)
  Discovery, crawling, parsing, enrichment
- [src/db.ts](src/db.ts)
  SQLite schema and persistence
- [src/sheets.ts](src/sheets.ts)
  Google Sheets sync and pull
- [test](test)
  Regression and integration coverage
