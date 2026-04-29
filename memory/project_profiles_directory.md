---
name: Profiles Directory — Source of Truth for Resume Generation
description: profiles/ is the working source of truth; base-documents/ is setup-only and must not be accessed during normal workflow
type: project
originSessionId: 68569e82-4680-4c68-b1a8-00f7172b43e3
---
`$APPLICANT_DIR/profiles/` is the working source of truth for all resume generation:

- `EXPERIENCE-REFERENCE.md` — canonical verified career history; source for Education and Certifications sections
- `role-achievements.md` — scored achievement matrix; source for role bullets; must stay in sync with EXPERIENCE-REFERENCE.md and profile CONTENT files
- `[profile].md` — positioning strategy and framing per profile
- `[profile]-CONTENT.md` — pre-compiled bullet library
- `PROFILES-QUICK-REFERENCE.md` — fast-match index for Haiku screening

**Why:** These files are actively maintained during the job search and must stay synchronized. role-achievements.md is generated during setup but is then edited manually and updated as new experience is provided.

**How to apply:** Always read from `$APPLICANT_DIR/profiles/` for EXPERIENCE-REFERENCE.md and role-achievements.md. Do NOT read from `base-documents/` during normal workflow.

`$APPLICANT_DIR/base-documents/` contains setup inputs (uploaded PDFs, interview notes, source resumes). Access it only when the applicant is adding new source material to support an updated or new profile.
