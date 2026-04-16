# Sample files for parser tests

**Do NOT commit the real files** — they are real client invoice data. The
`.gitignore` at the repo root excludes `*.xlsx` / `*.xls` / `*.csv` from
this directory.

## Required files

Per spec §16, Milestone 2 parsers test against these three real files:

| Purpose | Expected filename | Source |
|---|---|---|
| Tally India (Sundry Debtors) | `GrpBills.xlsx` | Tally export from India entity |
| Xero UAE (Aged Receivables Detail) | `MANTARAV_Aged_Receivables_Detail.xlsx` | Xero export for the UAE entity |
| Credit Period master | `Credit Period for Accounts - India & UAE.xlsx` | Manually maintained master |

## How to place them locally

1. Pull the three files from the working folder used during design:
   `/sessions/upbeat-peaceful-ramanujan/mnt/uploads/` (Cowork session).
   If that session has expired, re-export from Tally / Xero / the master
   file yourself — they are the same shape.
2. Drop them directly into this directory (`backend/tests/fixtures/sample_files/`).
3. Do NOT rename unless you also update parser tests.
4. Verify `.gitignore` is still excluding them: `git status` should show
   nothing new here.

## Red flag

If `git status` ever shows one of these files as staged / committed,
stop immediately, remove from history (`git rm --cached`, rewrite),
and notify Tejaswa. They contain real party names and invoice numbers.
