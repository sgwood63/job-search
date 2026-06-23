---
name: jd-evaluation
description: Screen a job description for fit — extract key facts, check location and hard stops, match to the best profile, return fit/no-fit with a fully structured output contract
---

# JD Evaluation (DRAFT — extends v1)

Screen a job description and return a fit/no-fit verdict with reasoning. Use the cheapest capable model (Haiku when running as a subagent) — screening is extraction and rule-checking, not generation.

**Changes from v1:**
- Output contract expanded from 3 fields to the full 19-field contract expected by `workflows/process-jd/`
- New `## Location check` section: generic rubric that reads location criteria from the screening context passed by the caller — no hardcoded place names in this skill
- `hard_stops_hit` is now a structured array field; location hard stops appear here as labeled strings

## Extraction

Extract from the JD:
- Company, role title, location, travel requirement, compensation, core requirements (Required and Preferred separately)

## Location check (evaluate before profile scoring)

1. Extract `location_extracted` from the JD (verbatim location string, or `"Not specified"` if absent).
2. Classify against the **Location Check section** passed in the screening context (read from `PROFILES-QUICK-REFERENCE.md ## Location Check` by the caller):
   - If remote / US remote → `location_verdict = "remote-ok"`
   - If onsite/hybrid in an accepted location → `location_verdict = "onsite-ok"`
   - If onsite/hybrid in a location explicitly listed as ❌ in Location Check → `location_verdict = "hard-stop"`; add the label `"Location: onsite outside accepted area"` to `hard_stops_hit`
   - If unclear or not stated → `location_verdict = "unclear"`; note in `fit_reasoning` but do NOT auto-block
3. If `hard_stops_hit` is non-empty after all checks: `fit = false`, `profile_score = 0`.
4. Lead `fit_reasoning` with the location result when `location_verdict = "hard-stop"` or `"unclear"`.

## Fit check

- Check location/travel fit against the Location Check section passed in the screening context
- Check compensation floor and deal-breakers from the Hard Stops section and comp floor passed in the screening context
- Match to the best profile using the profile slugs/summaries passed in the screening context
- Apply Hard Stops first — any Hard Stop hit = no-fit regardless of score
- Return `fit=true` only if `profile_score >= 7` and no Hard Stop applies

## Unknown company research

For any JD where the end company is not explicitly named (recruiter postings, stealth, "confidential client"), research to identify the likely end company before or during document generation:

- Run a research pass using clues from the JD: product description phrases, location, comp range, recruiter name, industry focus, stage signals
- Cross-reference against job boards (Built In, Ashby, Lever, Greenhouse) for exact comp/location matches
- Check if the recruiter firm has any public client disclosures
- Look for near word-for-word language matches between JD and company marketing copy
- Rank candidates by confidence; include in `job-description.md` under "Company Research" and in `notes.md` under "Company Context"
- Add an action item to confirm identity on the first recruiter call
- Tracker entry uses the likely company name with a "likely" qualifier

**Why:** Knowing the actual company enables better resume tailoring, smarter interview prep, and surfaces useful intel (stage, funding, customers, product positioning) that generic JD language obscures. A confident ID is often achievable from public sources in a single research pass.

## Output contract

Return a single JSON object with ALL of the following fields:

```
fit                         — true/false
profile_score               — integer 1–10; set to 0 if any hard stop hit
profile_match               — best profile slug (even on no-fit)
employment_type             — as stated or "Not listed"
seniority                   — as stated/inferred or "Not listed"
location_extracted          — location string from JD, or "Not specified"
location_verdict            — "remote-ok" | "onsite-ok" | "hard-stop" | "unclear"
travel                      — travel requirement as stated, or "Not listed"
compensation                — comp range as stated, or "Not listed"
role_summary                — 2–3 sentence paragraph
responsibilities            — array of ALL distinct responsibilities
must_have                   — array of {text, gap} objects
preferred                   — array of preferred qualifications (omit if none)
hard_stops_hit              — array of hard-stop label strings that triggered; [] if none
fit_reasoning               — narrative paragraph; lead with location verdict if it triggered
coverage                    — (fit=true only) array of {requirement, status}
domain_tags                 — array of 2–4 short domain tags
jd_requirements_structured  — {required: [string,...], preferred: [string,...]}
```

Field notes:
- `hard_stops_hit`: each element is a short label string identifying the triggered stop (e.g., `"Location: onsite outside accepted area"`, `"Travel: exceeds 25%"`, `"Comp: below floor"`, `"Defense/crypto/tobacco/gov"`, `"Equity-only"`, `"Management-only"`). Empty array `[]` if no hard stops triggered.
- `coverage`: `status` values are `"✅ Strong"`, `"⚠️ Partial"`, `"❌ Gap"`. Include 3–8 key requirements. Omit field entirely for no-fit.
- `domain_tags`: lowercase, hyphen-separated, no spaces (e.g., `["ai-governance","b2b-saas","fintech"]`).
- `jd_requirements_structured`: flat text arrays — `required` from `must_have[].text`, `preferred` from `preferred[]`.
