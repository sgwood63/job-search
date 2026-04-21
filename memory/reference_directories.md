---
name: Directory Path Definitions
description: Canonical paths for $APP_DIR, $APPLICANT_DIR, and $GDRIVE_DIR — resolve these before any file operation
type: reference
originSessionId: c0149eb9-2d07-4301-a2c8-2d751f157124
---
## Path Variables

All paths are defined in `$APP_DIR/.env` (gitignored). Read that file to resolve variables.

| Variable | Default Location | Notes |
|---|---|---|
| `$APP_DIR` | `~/Documents/Job-Search-2026/` | Process repo, git-tracked |
| `$APPLICANT_DIR` | `~/Documents/Job-Search-Applicant/` | Applicant data, NOT git-tracked |
| `$GDRIVE_DIR` | OS-specific (see below) | Google Drive sync target |

## Google Drive Path by OS

| OS | Typical path |
|---|---|
| macOS | `~/Library/CloudStorage/GoogleDrive-[email]/My Drive/[folder]` |
| Windows (WSL) | `/mnt/g/My Drive/[folder]` |
| Windows (native) | `C:/Users/[name]/Google Drive/[folder]` |
| Linux (rclone) | `~/gdrive/[folder]` |

On macOS, find the exact path with:
```bash
ls ~/Library/CloudStorage/
```

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
└── memory/                       # Applicant-specific memory
```

## How to Apply

Before any file operation, resolve `$APP_DIR`, `$APPLICANT_DIR`, and `$GDRIVE_DIR` from `$APP_DIR/.env`. Do not hardcode paths.

Shell scripts load variables with:
```bash
source "$(dirname "$0")/../.env"
```
