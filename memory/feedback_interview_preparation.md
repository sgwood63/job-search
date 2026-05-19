---
name: interview-preparation-rules
description: Rules for interview prep sessions — what to read first, output structure, what not to fabricate, and how to handle unknown stage
metadata:
  type: feedback
---

## Interview Prep — Required Reading Before Output

Always read these files before generating any prep output:

1. `$APPLICANT_DIR/applications/<folder>/notes.md` — full file, especially:
   - **Interview Prep** section(s) — pre-populated strategy from JD analysis
   - **Process** section — stage history and next stage
   - **Fit Assessment → Domain Connection** — the applicant's business domain link to this company
2. `$APPLICANT_DIR/applications/<folder>/job-description.md` — role requirements and company context
3. `$APPLICANT_DIR/profiles/[matched-profile].md` — positioning strategy for this profile

**Why:** Interview prep generated without reading notes.md produces generic output that misses the role-specific strategy already captured during JD analysis. The Interview Prep section in notes.md is the primary source — don't start from scratch.

## Output Structure (Required)

Output must follow this structure in order:

1. **Stage** — what interview type this is (from notes.md Process section; if unknown, state "stage not specified — assuming initial screen")
2. **Key talking points** — 3–5 role-specific points mapped to JD requirements, not generic SE talking points
3. **Questions to ask** — 3–5 questions tailored to this company and stage; avoid generic "what does success look like" unless nothing better applies
4. **What NOT to bring up** — from notes.md Differentiators/Caution sections if present; otherwise omit this heading rather than leaving it empty
5. **Signals to watch for** — what this company/stage is likely evaluating based on JD signals and company type

End with: "Interview prep loaded for [Company] — [Stage]. What aspect do you want to work through?"

## Stage Inference Rule

If the user does not specify a stage, use the next upcoming stage from the Process section in notes.md. If the Process section is empty or the stage is unclear, default to "initial recruiter/hiring manager screen" and say so explicitly.

## No Fabrication

Do NOT invent:
- Company facts not in notes.md or job-description.md (revenue, customer count, recent funding, product details)
- Interviewer names or backgrounds not recorded in notes.md
- Specific questions the interviewer is "likely" to ask as though they are known facts

If a useful fact is missing (e.g., company stage, product details), flag it as "worth researching before the call" rather than filling it in.

## Warm Connection Protocol

If notes.md or `$APPLICANT_DIR/memory/APPLICANT-MEMORY.md` lists a warm connection at this company, surface it in the prep brief — specifically who to mention, how the connection is relevant, and whether to reference it directly or let it serve as background context.

## Captured Feedback

*(Add session feedback here as it accumulates — e.g., "always confirm whether this is a technical screen or a discovery call before generating questions")*
