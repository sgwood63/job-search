Run the applicant onboarding workflow from `$APP_DIR/applicant-setup.md`.

**Usage:** `/setup [phase?]`
- No argument: detect current state and resume from where setup left off
- With phase (A–E): override detection and start from that phase

**Step 1 — Prerequisites**
1. Verify `.env` is loaded and `$APPLICANT_DIR` exists. If not, stop and tell the user to run `bash scripts/setup.sh`.

**Step 2 — State detection** (skip if a phase argument was given)

Check which files exist in `$APPLICANT_DIR` to infer the last completed phase:

| Phase | Completion signal |
|-------|------------------|
| A | `base-documents/` contains at least one file |
| B | `applicant.md` exists |
| C | `profiles/EXPERIENCE-REFERENCE.md` exists |
| D | `career-advice.md` exists |
| E | `profiles/role-achievements.md` is non-empty AND at least one `*.pdf` resume exists in `applications/` |

Work down the list from E to A. Report which phase was last completed and which you will resume from. Example: "Phases A–C are complete. Resuming at Phase D."

If none of the signals exist, treat as fresh start (Phase A).

If a phase argument was given, skip detection and start from that phase directly.

**Step 3 — Confirm with the user**

Before starting, state:
- Last completed phase (or "fresh start")
- Phase you will begin from
- Option to override: "To start from a different phase, reply `/setup [A-E]`"

Wait for the user to confirm or redirect.

**Step 4 — Execute phases**

Read `$APP_DIR/applicant-setup.md` and execute each phase starting from the confirmed phase. Pause after each phase for user confirmation before continuing to the next.

Use **Sonnet** throughout — do not spawn Haiku for any part of setup.
