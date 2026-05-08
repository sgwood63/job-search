---
name: Profile maintenance operation checklists
description: Mandatory step-by-step checklists for adding a new achievement and creating a new profile — use these instead of reasoning from the File Registry for these two operations
type: feedback
---

Two maintenance operations reliably cause missed file updates when handled by reasoning from the File Registry alone. These operations have explicit checklists that must be run to completion before the session closes.

**Why:** When a new profile is created, `career-advice.md` is not obviously triggered by the File Registry's "career direction changes" language — so it gets skipped. When a new achievement is added, cross-profile propagation is stated as a rule but has no enforcement point. Both failures occurred in practice (P3 created 2026-05-02, P5 created 2026-05-04 — both missing from career-advice.md until prompted).

**How to apply:** When either trigger fires, run the corresponding checklist below in order. Do not close the session or append the maintenance log entry until every step is addressed (completed or explicitly noted as not applicable with a reason).

---

## Operation A — New Achievement Added

Trigger: User says "I have a new achievement," "I finished a project," "I verified a metric," "resolved an unverified item," or any variant that adds, changes, or confirms a bullet in the experience record.

**Checklist — run in order:**

- [ ] **A1. role-achievements.md** — Add or update the achievement row. Include Power score and a relevance score for every active profile column (P1 through P5, or however many are active). Add sourcing/framing notes. If a metric was [UNVERIFIED] and is now confirmed, remove the flag and add source.
- [ ] **A2. EXPERIENCE-REFERENCE.md** — Add or update the verified fact in the relevant role's section. Include dates, metrics, and technology where applicable.
- [ ] **A3. Cross-profile propagation** — Open each `*-CONTENT.md` file for every active profile in turn. For each: does the new or updated achievement materially strengthen any bullet, fill a documented gap, or warrant a new entry? Update where relevant. This step is not complete until all active profiles have been explicitly reviewed.
- [ ] **A4. applicant-maintenance.md** — Append the session entry. Include: date, achievement ID, what changed, and for each active profile CONTENT file — whether it was reviewed and whether it was updated (and why not if skipped).

**career-advice.md for achievements:** Do NOT update the Profile Fit Scores table for an achievement addition — scores are set at profile creation or major career direction shifts. Update Feedback Incorporated only if the new achievement resolves a documented skill gap or materially changes the strategic advice.

**Session close gate:** Before ending, output: _"Maintenance checklist complete. Operation A: A1 ✓, A2 ✓, A3 ✓ [list profiles reviewed and which received updates], A4 ✓."_

---

## Operation B — New Profile Created

Trigger: User says "add a new target role," "I want a new profile," "create a profile for [X]," or session determines that a new JD type warrants a new profile track.

**Checklist — run in order:**

- [ ] **B1. Create profile strategy file** — `profiles/[profile-slug].md` with: positioning statement, framing guidance, what to emphasize / compress / omit, target companies and roles, key JD signals, known gaps, keywords.
- [ ] **B2. Create profile content library** — `profiles/[profile-slug]-CONTENT.md` with: opening summaries (2–3 variants), capabilities section, role bullets by position, portfolio section (if applicable), cover letter guidance. Source all bullets from role-achievements.md and EXPERIENCE-REFERENCE.md only.
- [ ] **B3. role-achievements.md** — Add the new profile column (e.g., P5) to the Profiles header, the Achievement Completeness table, and every achievement row with an explicit relevance score for the new profile. Do not leave any row without a score for the new column.
- [ ] **B4. PROFILES-QUICK-REFERENCE.md** — Add a row for the new profile: profile name and slug, best-for description, key JD signals, avoid-when conditions. Update Matching Rules if the new profile has unique scoring considerations.
- [ ] **B4.5. PROFILES-QUICK-REFERENCE.md search queries** — Add a row to the `## Search Queries` table for the new profile: one OR-query combining role/title terms across all naming conventions. Role and title terms only — no domain expertise appended. Include adjacent titles: names other companies use for the same function (e.g., "Solutions Architect" alongside "Solutions Engineer"). Aim for 8–14 terms for broad market coverage. Format: `| <profile-slug> | \`"Term A" OR "Term B" OR "Term C"\` |`
- [ ] **B5. career-advice.md** — This step is mandatory and not skippable:
  - Add a row to §1 Profile Fit Scores table with scores for all five dimensions (Experience Match, Market Demand, Differentiation, Competition Level, Overall)
  - Add a scoring rationale subsection below the table (same format as existing profiles)
  - Add a row to §5 Compensation Expectations table with base range, floor, and notes
  - Add a Feedback Incorporated entry with date noting the new profile was created, the score, and how it was classified (primary / parallel / opportunistic)
- [ ] **B6. applicant-maintenance.md** — Append the session entry. Include: date, new profile name and slug, what triggered the decision (the JD or conversation), files created, files updated, career-advice.md sections updated.

**EXPERIENCE-REFERENCE.md for new profiles:** Only update if the profile creation session surfaces a new verified fact or experience clarification that belongs in the canonical fact sheet. Adding a profile alone does not require a fact-sheet update.

**applicant.md for new profiles:** Update only if the new profile reflects a material shift in job search direction or screening criteria that should affect how Haiku evaluates future JDs.

**Session close gate:** Before ending, output: _"Maintenance checklist complete. Operation B: B1 ✓, B2 ✓, B3 ✓, B4 ✓, B5 ✓ [career-advice.md §1, §5, Feedback Incorporated updated], B6 ✓."_
