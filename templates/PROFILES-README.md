# Profiles System

This document describes how the profiles directory works and how to author profile files.

All profile files live in `$APPLICANT_DIR/profiles/` — not in this repo. This repo contains scaffold stubs (in `templates/scaffold/profiles/`) that are seeded into `$APPLICANT_DIR/profiles/` during `scripts/setup.sh`.

---

## Directory Structure

```
$APPLICANT_DIR/profiles/
├── PROFILES-QUICK-REFERENCE.md     # Fast JD-matching index (one row per profile)
├── EXPERIENCE-REFERENCE.md         # Verified facts for every role — canonical source
├── role-achievements.md            # Achievement set scored against all active profiles
├── [profile-name].md               # Full strategy document per profile
└── [profile-name]-CONTENT.md       # Pre-compiled resume content library per profile
```

---

## File Roles

### `PROFILES-QUICK-REFERENCE.md`
One-row summary per profile for fast JD matching. Used by Haiku during initial screening. Keep this up to date when profiles are added or retired.

### `EXPERIENCE-REFERENCE.md`
Canonical source of verified experience facts: exact titles, companies, dates, contributions, technologies, and metrics. All resume generation draws from this. Never fabricate — if a claim is not here, add it here first. Also the authoritative source for the `## Education` and `## Certifications` resume sections.

### `role-achievements.md`
Achievement set organized by role (most-recent first), scored against all active profiles. **This is the canonical source for all achievement bullet text and metrics.** Changes here must propagate downstream:

```
role-achievements.md → EXPERIENCE-REFERENCE.md → [profile]-CONTENT.md
```

### `[profile-name].md`
Full strategy document for one target role type. Contains:
- What makes the applicant strong for this profile
- Framing guidance for experience and accomplishments
- What to emphasize, compress, or omit
- Keywords and signals for this audience
- Example JDs (added during Phase E)

### `[profile-name]-CONTENT.md`
Pre-compiled resume content library for one profile. Contains:
- Opening summaries tailored to this profile
- Achievement bullets organized by role, ready to pull from
- Eliminates per-application re-extraction from PDF resumes

---

## Authoring Rules

**Content library section headers are not job titles.** Headers like `## AI Solution Architect — Presales Experience` in CONTENT files are source material labels. Never render them as job entries in a resume.

**Role order is strict reverse chronological.** Always verify against `EXPERIENCE-REFERENCE.md` before generating a resume. Never display roles out of order.

**Update sequence matters.** When adding a new achievement or metric:
1. Add it to `role-achievements.md` first
2. Propagate to `EXPERIENCE-REFERENCE.md`
3. Update the relevant `[profile]-CONTENT.md` files

---

## Resume Format

See [`resume-format.md`](resume-format.md) for section structure, voice rules, capabilities format, and detail-per-role guidelines.
