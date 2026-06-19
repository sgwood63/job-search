# Automated JD Workflow — Moved to Versioned Skills

The full automated pipeline that runs when a job description is provided now lives in **versioned skill documents** (see `skills/README.md` for the format and `skills/registry.yaml` for the index):

| Content | New location |
|---|---|
| JD fetch, screening, folder creation, fit/no-fit branches, JD regeneration, notes.md structure, two-file status rule | `workflows/create-application/` |
| Haiku screening + fit check + profile match + unknown-company research | `skills/jd-evaluation/` |
| Resume pipeline: phases, verification gate, file naming, section labels, role ordering, PDF command, evaluation report | `skills/resume-generation/` |
| Interview prep orchestration | `workflows/prepare-interview/` + `skills/interview-prep/` |
| DATA_BACKEND routing (OB1 vs local) | `policies/storage-routing/` |
| Fabrication and percentage-metric rules | `policies/factuality/` |
| Source-of-truth and role-order rules | `policies/evidence-grounding/` |
| Domain connection + company descriptions | `policies/company-descriptors/` |

**Which version to read:** interactive sessions use `draft.md` when present, otherwise the `pinned` version named in the entry's `skill.yaml`. The webapp always executes pinned versions.

CLAUDE.md contains the triggers and critical rules; this file is kept as a pointer because external docs reference it.
