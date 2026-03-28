# Combine V1 and V2 Job Sniper Without Losing Capabilities

## Goal

Create one production repo that preserves every working V1 behavior and every working V2 behavior.

Current repo paths:

- Canonical repo: `/Users/derin/Desktop/CODING/Job sniper`
- Archived legacy source: `/Users/derin/Desktop/CODING/Job sniper/archive/legacy-source`

## Current state

### V1 is stronger at

- current stable baseline behavior
- existing published shape
- daily dated Google Sheets tabs in `src/sheets.ts`
- current package naming adjustment to `job-sniper-v1`

### V2 is stronger at

- decision layer
- route intelligence
- pitch-angle generation
- dossier mode
- contact and outcome logging
- experiments summary
- expanded stats, export, and sheet columns
- new test coverage for strategic logic

## Recommended merge target

Use V2 as the merge base.

Reason:

- V2 is already a superset architecturally
- V2 preserves V1 commands and behavior
- V2 already passes the inherited V1 tests plus new V2 tests
- the remaining V1-only delta is narrow and easy to port

Do not try to back-port V2 into V1 directly. That path creates more risk because V1 is missing the new schema and strategic modules.

## Capabilities that must exist in the final combined repo

### Preserve from V1

- local-first SQLite
- role-pack-driven search
- web, RSS, ATS discovery
- profile scoring
- company and contact enrichment
- Google Sheets sync
- outreach draft generation
- migration support
- all existing commands
- daily dated Google Sheets job tabs

### Preserve from V2

- recommendation layer
- route intelligence
- pitch-angle generation
- dossier command
- contact log / outcome log
- experiments command
- expanded stats/export
- expanded sheet columns
- new V2 tests

## Minimum-change merge plan

### Phase 1. Freeze the baseline

1. Keep V1 untouched.
2. Keep V2 as the active integration workspace.
3. Run and save the current V1 and V2 test outputs before any merge.

Acceptance:

- V1 still passes in its own folder.
- V2 still passes in its own folder.

### Phase 2. Port the V1-only Sheets behavior into V2

Port these changes from V1 into V2:

- `src/sheets.ts`
  Specifically the `dayKey()` and `dailyJobSheets()` flow plus the `syncSheets()` logic that writes `Jobs YYYY-MM-DD` tabs.
- `test/sheets.test.ts`
  Reintroduce the daily-tab assertion on top of V2’s expanded headers.

Do not overwrite the V2 sheet columns. Merge the behaviors:

- keep V2 strategic columns
- keep V1 daily tabs

Acceptance:

- V2 `Jobs` tab still works
- V2 `Companies`, `Contacts`, and `RunMetrics` tabs still work
- daily dated `Jobs YYYY-MM-DD` tabs are created again

### Phase 3. Normalize package and repo identity

Decide one package identity and stick to it.

Recommendation:

- keep the repo folder name as `Job sniper`
- keep the skill command as `/sniper`
- keep the package identity aligned with `job-sniper`

Avoid carrying old nested repo names in active docs or runtime paths.

Pick one final package name before release.

### Phase 4. Re-run full regression after the Sheets merge

Required:

- `npm run typecheck`
- `npm test`
- `npm run sniper -- help`

Add one manual sanity pass:

1. onboard sample profile
2. run discovery with fixtures or stubbed inputs
3. sync to fake sheet gateway
4. confirm both strategic columns and daily tabs exist

### Phase 5. Data-compatibility validation

Test with:

- empty DB
- migrated legacy DB
- an existing populated V1 DB copied into V2

Validate:

- no schema reset
- no missing data
- old rows remain readable
- new columns default safely
- sheet pull still preserves manual columns

### Phase 6. Operational cutover

Only cut over Hermes and cron after this checklist passes:

- V2 passes all tests
- daily tabs are merged
- Google Sheets sync works with the final sheet schema
- the repo root/path for automation is final
- env vars are set in the runtime used by Hermes/cron

## Merge checklist

- [ ] V2 remains the codebase of record
- [ ] V1 daily sheet tabs ported into V2
- [ ] no V2 strategic columns lost in the merge
- [ ] old commands still work
- [ ] new commands still work
- [ ] migration tests cover new and legacy DBs
- [ ] sheets tests cover manual column preservation and daily tabs
- [ ] Hermes docs updated to the final repo path

## Things to avoid

- do not replace V2 `src/sheets.ts` wholesale with the V1 version
- do not back-merge V2 into V1 manually file-by-file without tests
- do not change DB defaults in a way that rewrites old rows
- do not cut over cron before the sheet schema is stable

## Final recommendation

The cleanest combined Job Sniper is:

- V2 as the main repo and runtime
- V1 daily Google Sheets tab feature merged into V2
- one final package name chosen after regression passes

That path keeps the most capability with the least risk.
