---
name: Directory Path Definitions
description: Canonical paths for $APP_DIR and $APPLICANT_DIR — resolve these before any file operation
type: reference
originSessionId: c0149eb9-2d07-4301-a2c8-2d751f157124
---
## Path Definitions

| Variable | Path | Notes |
|---|---|---|
| `$APP_DIR` | `/Users/shermanwood/Documents/Job-Search-2026/` | App source, git-tracked |
| `$APPLICANT_DIR` | `/Users/shermanwood/Documents/Job-Search-Applicant/` | Applicant data, NOT git-tracked |

## Applicant Directory Layout

```
$APPLICANT_DIR/
├── applicant.md                  # Contact info, job criteria, location preferences
├── application-tracker.md        # Master tracker (all applications)
├── profiles/
│   ├── PROFILES-QUICK-REFERENCE.md
│   ├── [profile-name].md
│   └── [profile-name]-CONTENT.md
├── applications/                 # One folder per application
│   └── YYYY-MM-DD-company-role/
├── base-documents/
│   ├── EXPERIENCE-REFERENCE.md
│   └── resume-content-guidance.md
└── memory/                       # Applicant-specific memory (not app-process memory)
```

## How to Apply

Whenever a memory file or workflow step references `$APPLICANT_DIR` or `$APP_DIR`, resolve to the paths above. Do not hardcode paths elsewhere.
