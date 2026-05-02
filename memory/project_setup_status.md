---
name: Applicant Setup Status
description: Current state of the applicant's job search system setup — what's complete, what's next
type: project
originSessionId: 3a6ee31f-fe0c-4b19-941c-b0167fc78c58
---
Phases A–D complete. Phase E (Profile Validation) was validated in practice through live applications starting 2026-04-28. Phase F (Profile Maintenance) is now active with file registry and cross-profile propagation rule documented in applicant-setup.md.

**Why:** Full onboarding interview and career advice session conducted; all Phase C and D documents generated. Live applications (EliseAI, Anecdotes, Amplitude, GoodLeap, eGain, Decagon) validated the content library in production — Phase E sample-resume exercise was superseded by real applications. Phase F workflow committed to repo 2026-05-02.

**How to apply:** System is in active use. Use Phase F rules for all profile updates. Unverified items in role-achievements.md still need resolution (see below).

## What's done

- Phase A: Documents uploaded to $APPLICANT_DIR/base-documents/ (9 resumes + LinkedIn PDFs)
- Phase B: Interview complete (profiles, preferences, compensation, deal-breakers)
- Phase C: All documents generated:
  - applicant.md
  - profiles/EXPERIENCE-REFERENCE.md
  - base-documents/resume-content-guidance.md
  - profiles/role-achievements.md (achievement set with P1/P2/P4 scoring)
  - base-documents/applicant-interview-2026-04-28.md (session summary + gap list)
  - profiles/presales-se.md + presales-se-CONTENT.md
  - profiles/ai-governance-se.md + ai-governance-se-CONTENT.md
  - profiles/post-sales-se.md + post-sales-se-CONTENT.md
  - profiles/PROFILES-QUICK-REFERENCE.md
- Phase D: Career advice complete:
  - career-advice.md generated (profile fit scores, target roles, skill gaps, quick-win profile)
  - Profiles reviewed; ai-strategy-consultant dropped; presales-se designated primary

## Active profiles

1. **presales-se** — Presales SE / Solutions Engineer at AI/analytics SaaS (primary)
2. **ai-governance-se** — AI Governance & Risk SE (primary, differentiating)
3. **post-sales-se** — Post-Sales SE / CS Architect (active)

Dropped: AI Strategy Consultant (not of interest).

## Key unverified items to resolve

All marked [UNVERIFIED] in role-achievements.md and EXPERIENCE-REFERENCE.md:
- LatticeFlow: deal count, deal size range, POV-to-close win rate, main competitors
- LatticeFlow: confirm 20% compliance cost reduction (measured vs. estimated)
- LatticeFlow: Partner Enablement Program — how many consulting firms?
- LatticeFlow: other named/describable clients beyond Julius Baer
- Pyramid: 200% user growth — over what timeframe?
- Solace: 3-month tenure — why did it end? Have clean explanation ready.

## Phase F — active

Profile maintenance workflow is live. See applicant-setup.md Phase F for:
- Trigger phrases and classification matrix
- File Registry (what to update for each change type)
- Cross-Profile Propagation Rule
- Logging instructions (append to $APPLICANT_DIR/applicant-maintenance.md)

**Last Updated:** 2026-05-02
