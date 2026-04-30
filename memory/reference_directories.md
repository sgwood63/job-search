---
name: Directory Path Definitions
description: Canonical paths for $APP_DIR and $APPLICANT_DIR — resolve these before any file operation
type: reference
originSessionId: c0149eb9-2d07-4301-a2c8-2d751f157124
---
## Path Variables

All paths are defined in `$APP_DIR/.env` (gitignored). Read that file to resolve variables.

| Variable | Default Location | Notes |
|---|---|---|
| `$APP_DIR` | `~/Documents/Job-Search-2026/` | Process repo, git-tracked |
| `$APPLICANT_DIR` | Chosen during setup | Applicant data, NOT git-tracked |

`$APPLICANT_DIR` is set by `bash scripts/setup.sh` to either a local directory (default `~/Documents/job-applications`) or a cloud sync service's managed folder. When a cloud service is chosen, the OS syncs files automatically.

## Applicant Directory Layout

```
$APPLICANT_DIR/
├── applicant.md                  # Contact info, job criteria, location preferences
├── application-tracker.md        # Master tracker (all applications)
├── profiles/
│   ├── PROFILES-QUICK-REFERENCE.md
│   ├── EXPERIENCE-REFERENCE.md           # Verified facts — canonical source of truth
│   ├── role-achievements.md              # Per-role achievements scored against active profiles
│   ├── [profile-name].md
│   └── [profile-name]-CONTENT.md
├── applications/                 # One folder per application
│   └── YYYY-MM-DD-company-role/
├── base-documents/
│   ├── resume-content-guidance.md
│   └── applicant-interview-[date].md # Interview session summary and gap list
└── memory/                       # Applicant-specific memory
```

## How to Apply

Before any file operation, resolve `$APP_DIR` and `$APPLICANT_DIR` from `$APP_DIR/.env`. Do not hardcode paths.

Shell scripts load variables with:
```bash
source "$(dirname "$0")/../.env"
```
