---
name: cover-letter
description: Cover letter policy and generation — not recommended by default; personal/life domain connections belong here, not in resume bullets
---

# Cover Letter (draft)

**Changes from v1:**
- Context Loading — Session Reuse section added under "When writing one": do-not-re-read guard for this document and its companion policies across repeated invocations, and reuse when `resume-generation` already loaded the same companion policies earlier in the session/invocation chain. Extends the pattern from `workflows/search-jobs/v3.md`.

## Default: do not recommend

Do NOT recommend cover letters by default. They are generally not read or considered by hiring teams.

**How to apply:**
- Do not suggest drafting a cover letter as a next step
- Do not flag the absence of a cover letter as a gap
- Exception: write one only if the applicant explicitly requests it, the role requires it, or there is a specific signal the hiring manager reviews them

## When writing one

- Source all claims per the factuality and evidence-grounding policies — only from `profiles/[profile]/[profile]-CONTENT.md` and `profiles/EXPERIENCE-REFERENCE.md`
- **Personal / life-experience domain connections belong in the cover letter, NOT in resume bullets.** When the target company builds a product for a consumer or operator context the applicant has lived (source: `profiles/EXPERIENCE-REFERENCE.md` "Personal Domain Context" section), use it in cover letter framing only.
- Surface the strongest professional domain connection (per the company-descriptors policy) in the opening paragraph — why this company's business problem maps to the applicant's background
- Keep to one page; address the specific role and company, never a template
- File naming and storage follow the same conventions as resumes (`[FirstName_LastName]_<Role_Title>_Cover_Letter.md`/`.pdf`), routed per the storage-routing policy

## Context Loading — Session Reuse

This skill and its companion policies (`factuality`, `evidence-grounding`, `company-descriptors`, `storage-routing`) are loaded once per session, not once per invocation. If cover-letter runs more than once in the same session, or if `resume-generation` already ran earlier in this session or invocation chain, these four companion policies are likely already in context — do not reload them; reuse what's there.

Re-read a document only when:
- It has not been loaded yet this session
- An auto-compaction event has occurred since it was last loaded
- The user asked to draft or promote a new version of this skill or a companion policy mid-session

(Pattern from `workflows/search-jobs/v3.md` Step 1 / Phase 3-PROCESS. No compact-cadence guidance is given here — cover letters are exception-path, not default, so back-to-back batches are unlikely.)
