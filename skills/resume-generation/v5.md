---
name: resume-generation
description: Generate a tailored, factual resume from profile content for a screened JD, with verification gate and evaluation report. v4 adds Phase 0.25 Entity Graph Enrichment (OB1 mode only): resolves company→requires→skill and skill→demonstrates→achievement edges before content retrieval to prioritize graph-linked requirements in Phase 0.5 semantic queries.
---

# Resume Generation

Source only from `profiles/[profile]/[profile]-CONTENT.md` and `profiles/EXPERIENCE-REFERENCE.md` (see evidence-grounding policy). All file reads/writes follow the storage-routing policy.

## Context Loading — Session Reuse

This skill and its companion policies (`factuality`, `evidence-grounding`, `company-descriptors`, `storage-routing`) are loaded once per session, not once per invocation. When resume-generation runs a second (or later) time in the same session — e.g. generating resumes for several stub applications back-to-back — do not re-read this document or its companion policies; reuse what is already in context.

If resume-generation is invoked from `create-application`, `storage-routing` may already be loaded (it is also create-application's companion policy) — do not reload it a second time for this call.

Re-read a document only when:
- It has not been loaded yet this session
- An auto-compaction event has occurred since it was last loaded
- The user asked to draft or promote a new version of this skill or a companion policy mid-session

**Compact guidance:** When generating several resumes back-to-back in one session, run `/compact` after every 3 resumes if no manual compact has occurred recently. Profile content, JD content, and the evaluation report per resume are substantial; unmanaged growth risks unpredictable auto-compaction that busts the cache prefix and forces a full reload of this document and its four companion policies. (Pattern from `workflows/search-jobs/v3.md` Step 1 / Phase 3-PROCESS.)

## Length

- **2 pages default** for enterprise/consulting/governance/direct applications
- **1 page** for: networking, warm referrals, recruiter outreach, pre-sales SE roles, role pivoting

## Two-Phase Flow

Always follow this two-phase sequence. Never generate the PDF before the user has reviewed and approved the draft.

**Why:** The user wants to review the draft and evaluation before committing to a PDF. Generating PDF first removes the review opportunity and wastes iteration cycles if changes are needed.

**Phase 0 — Role Classification check (before drafting):**

Verify every role to be included has a `**Role Classification:**` field in `profiles/EXPERIENCE-REFERENCE.md`. If any included role is missing one, stop and ask the user to provide it before generating any bullets. Do not infer role type from activity descriptions — the user must confirm.

**Phase 0.25 — Entity Graph Enrichment (OB1 mode only, after Phase 0):**

Step 1: Resolve company name from `notes-index.md` header (`# [Company] — [Role]`).

Step 2: Get required skills the company has signaled across prior applications:

```
get_entity_neighbors(
  entity_name = <company_name>,
  entity_type = 'organization',
  relation = 'requires',
  direction = 'out',
  limit = 20
)
```

→ `graph_required_skills` (list of entity_name strings; may be empty)

Step 3: For each skill in `graph_required_skills` (up to 10):

```
get_entity_neighbors(
  entity_name = <skill_name>,
  relation = 'demonstrates',
  direction = 'in',
  limit = 5
)
```

→ `graph_achievements_for_skill` (achievement entity names)

Step 4: Build `priority_map`: `{skill_name → [achievement_entity_names]}`

Step 5: Pass `priority_map` to Phase 0.5. In Phase 0.5 per-requirement semantic retrieval, process requirements that appear in `graph_required_skills` FIRST (they carry the strongest entity-graph signal). Log inline: "Graph enrichment: N required skills found for <company>."

**Graceful degradation:** If `get_entity_neighbors` returns empty (new company or no prior `process-jd/v3` runs for this company) — log inline: "No graph edges for <company> — using standard semantic retrieval order." Proceed with Phase 0.5 unchanged.

**Local mode:** Skip Phase 0.25 entirely. `get_entity_neighbors` is not available in local mode.

---

**Phase 0.5 — Content retrieval (before drafting, after Phase 0.25):**

Loading method depends on `DATA_BACKEND`.

### OB1 mode (`DATA_BACKEND=ob1`)

**Always load — structural anchors (regardless of JD content):**

Retrieve these three sections from `profiles/EXPERIENCE-REFERENCE.md` via `search_chunks_semantic`:

```
search_chunks_semantic(
  query = "role classification experience reference",
  storage_key_prefix = "profiles/",
  limit = 3
)
```

Verify results include:
- A chunk with `section_title` matching "Role Classification" (or containing role classification entries for the included roles)
- `section_title` = "Education"
- `section_title` = "Certifications"

If any of these three anchors are missing from results: fall back to `get_file('profiles/EXPERIENCE-REFERENCE.md')` and extract only the missing section.

**Per-requirement semantic retrieval:**

For each "Required" requirement extracted from `applications/<folder>/job-description.md`, run:

```
search_chunks_semantic(
  query = "<requirement text>",
  storage_key_prefix = "profiles/<profile>/",
  limit = 3
)
```

Process requirements that appear in `graph_required_skills` from Phase 0.25 FIRST — these have the strongest entity-graph signal and should anchor the retrieval pool before lower-priority requirements are queried.

Collect all returned chunks across all requirement queries. Deduplicate by `section_title` (keep the highest-scoring occurrence of each section). The resulting de-duped set is the achievement pool for resume drafting.

**Fall-back:** If the de-duped pool contains fewer than 3 unique sections after all requirement queries:
- Load the full `profiles/<profile>/<profile>-CONTENT.md` via `get_file`
- Log inline: "Semantic retrieval returned < 3 unique sections — loaded full profile-CONTENT.md."

**Note:** `role-achievements.md` is an upstream maintenance source only — it is NOT read during resume generation and is NOT a target for semantic retrieval.

### Local mode (`DATA_BACKEND=local`)

Full file reads — same as v2:
- Read `profiles/<profile>/<profile>-CONTENT.md` in full
- Read `profiles/EXPERIENCE-REFERENCE.md` in full

No semantic retrieval in local mode — no vector DB available. No degraded output, just no context savings.

---

**Phase 0.75 — Cross-application domain patterns (OB1 mode only, after Phase 0.5):**

Call `find_similar_applications` to surface past applications where the business domain context is similar to this JD:

```
find_similar_applications(
  query = "<JD company description + role domain, 1-2 sentences summarizing business context>",
  exclude_id = <current application_id>,
  limit = 3
)
```

Use the results to:
1. **Verify domain connection narrative consistency** — if a similar past application exists, confirm the framing is consistent (or note if this JD has a meaningfully different angle worth highlighting)
2. **Elevate proven bullets** — if a specific achievement was featured prominently in a similar-domain resume and is relevant here, prioritize it
3. **Avoid narrative drift** — if the applicant's positioning in similar-domain applications differs substantially, surface the discrepancy and apply the most accurate framing

If no similar applications are found or all similarities are low (> 0.4 cosine distance): skip silently — do not note "no similar applications found" in the output.

**Local mode / no results:** Skip entirely. Resume generation proceeds without cross-app patterns.

---

**Phase 1 — Draft, evaluate, and present for review (stop here, wait for approval):**

1. Write the resume `.md` file — per the storage-routing policy (OB1 active: compose in memory, `upload_file('applications/<folder>/<Name_Role>.md', content, 'text/markdown')`, plus a local copy to `/tmp/<Name_Role>.md` for the PDF pipeline; local fallback: write to `$RESUME_MD`)
2. **Verification gate** — run a coverage check against `job-description.md`:
   - Extract every stated requirement (Required and Preferred separately)
   - Score each Required item: **MET** (a specific bullet addresses it), **PARTIAL** (mentioned but not specific), or **GAP** (not addressed)
   - **Exit condition:** all Required items are MET or PARTIAL
   - If GAPs exist on Required items: apply targeted edits and re-score — maximum 2 cycles
   - If a Required item remains a GAP after 2 cycles: flag it explicitly rather than continuing to loop
3. Produce the Recruiter & ATS Appeal Analysis (four-subsection format below)
4. Write the complete Resume Evaluation Report (coverage table + recruiter/ATS analysis) to the `## Resume Evaluation Report` section of `notes.md`
5. **Present the full evaluation report inline in the conversation** — then stop and wait for user review. Do NOT reproduce the resume markdown in the conversation; it is already in the `.md` file. A condensed summary is not sufficient — the full evaluation must appear in the chat.

**Phase 2 — Finalize (after user approves):**

6. Apply any edits from user review
7. Generate PDF and verify page count

## File Naming

Resume `.md` and `.pdf` files: `[FirstName_LastName]_<JD_role_title>` — spaces → underscores, special characters removed or replaced with underscores. Derive the name from `applicant.md`.

Example: "GRC Solutions Engineer" → `[FirstName_LastName]_GRC_Solutions_Engineer.md` / `.pdf`

```
RESUME_MD="$FOLDER/[FirstName_LastName]_<Role_Title>.md"
RESUME_PDF="$FOLDER/[FirstName_LastName]_<Role_Title>.pdf"
RESUME_HTML="$FOLDER/resume.html"
```

## Title Format

Do NOT include a frontmatter `title:` block. The resume must open directly with the applicant's name as a top-level heading — no YAML front matter above it. (A frontmatter title renders as a duplicate heading.)

## Summary Section — Never Use "## Summary" Heading

Do NOT use `## Summary` as a section heading. Replace with a bold positioning title on its own line between the `---` divider and the summary paragraph:

```markdown
---

**[Role Title] — [Domain/Qualifier]**

[Summary paragraph...]
```

Example: `**Implementation Engineer — Enterprise SaaS**`

**Why:** A role title immediately anchors the reader; a bold line avoids the uppercase CSS treatment and renders as a clean subtitle. Never use `## Summary`, `## Professional Summary`, or any h2 heading above the opening paragraph. Do not open with career history ("25 years of experience...") — lead with current positioning.

## Role Ordering and Structure

- **Strict reverse chronological order** — all included roles most-recent-first. Skipping roles is acceptable; out-of-order is not. Verify against `profiles/EXPERIENCE-REFERENCE.md` before generating.
- **Section heading is `## Experience`** — never `## RELEVANT EXPERIENCE` (ATS non-standard) or `## PROFESSIONAL EXPERIENCE`. CSS `text-transform: uppercase` renders it as "EXPERIENCE" in the PDF, but the underlying text must be "Experience" for ATS parsers.
- **Earlier Career is a subsection** — all roles that ended more than 12 years ago grouped under `### Earlier Career`, reverse chronological within it. Never place an early-career role in the main section above a recent role.

## Detail per role

- Recent roles (last 10–12 years): **5–7 bullets**
- Mid-career (12–20 years ago): **2–4 bullets**
- Early career (20+ years): **1 bullet or title only**

## Earlier Career — Apply the Same Relevance Filter as the Main Experience Section

Do NOT include all Earlier Career entries by default. Include an entry only if it is relevant to the specific role being applied for or to the target company's domain (same judgment used to select bullets in the main section). Including irrelevant entries adds wrong-domain signal and dilutes positioning. Evaluate each canonical Earlier Career entry against the target role and company domain per the relevance table in `profiles/EXPERIENCE-REFERENCE.md` context; omit entries that add noise.

## Signal density

- Every bullet answers a recruiter question: "Can they talk to customers? Design architectures? Make AI/analytics work?"
- Bullet formula: **Action → Technical Domain → Context → Outcome**
- Use hands-on IC verbs: designed, implemented, architected, built, delivered
- Avoid management language (led large teams, departmental strategy, oversaw transformation) when targeting IC roles — signal technical leadership, not org leadership
- Use **technology categories** in the capabilities section, not exhaustive tool lists — specific tools go inside role bullets for context
- Write natural sentences with embedded keywords — not ATS keyword stuffing
- Explicitly surface customer-facing experience — discovery, demos, POCs, architecture discussions
- Tailor language, emphasis, and framing to the specific role and target company; mirror JD terminology where it truthfully matches experience; elevate differentiating content (domain overlap, startup fit, specific tools named in the JD)

## Bullet structure — one idea per bullet

Each bullet must express one idea. Do not compress multiple distinct actions into a single bullet by stacking semicolons.

**Rule:** A bullet may contain at most one semicolon. If you find yourself writing two semicolons in one bullet, it contains three ideas — split it.

**Use commas or em-dashes** to connect related elements within a single idea:
- Comma: for a participle or result clause that flows from the main action ("Built demo frameworks for an AI governance platform entering a new market, translating complex concepts into business-value narratives")
- Em-dash: for a detail list or elaboration ("Delivered 50+ enterprise pre-sales engagements — discovery, demos, POCs, and RFP/RFI responses across financial services and healthcare")

**Do not use semicolons** to join what are actually two separate accomplishments. Those belong in separate bullets.

**Why:** Dense, semicolon-stacked bullets reduce human readability. A recruiter scanning in 6 seconds will not parse a 40-word compound sentence — they will skip it. One clear idea per bullet is easier to read and easier to remember.

**Check before uploading:** Scan every bullet for two or more semicolons. If found, split before proceeding.

## No duplication

- Capabilities section items must not overlap — merge any that cover the same domain
- Each achievement appears in the role period where it actually occurred — never attribute work from one era to another role's section

## Capabilities Section Format

The Capabilities section is **always required** on every resume. Always include a `## Capabilities` heading above the capability lines — without it the section has no visual anchor and blends into the summary.

Structure:
```markdown
## Capabilities

**Category Name:** Item one, Item two, Item three  
**Category Name:** Item one, Item two, Item three  
**Category Name:** Item one, Item two, Item three
```

**Each capability category line must end with two trailing spaces (markdown `<br>`) except the last line.** Without them, pandoc collapses all lines into a single `<p>` block — they render as one run-on paragraph. Same fix as the contact block.

Use `, ` (comma-space) as the delimiter between skills — not `·` (middle dot). ATS parsers may treat an entire `·`-delimited line as a single token.

Content library files (`*-CONTENT.md`) store capabilities as bullet lists under bold category headings; flatten each category's bullet list to a single comma-separated inline line. Do not change bullets inside role entries.

## Contact block

Phone format: `(415) 516-4894` style — no `+1` country code prefix (observed: Ashby leaves phone blank with `+1`). Two lines, with two trailing spaces (markdown `<br>`) after line 1:
- Line 1: `email | (area) exchange-number | linkedin-url`
- Line 2: `City, State`

Parseable fields must come first; location last or on its own line (location-first broke Ashby's parser for all fields).

## Education and Certifications

Every resume must include, after Earlier Career, in this order:
1. `## Education` — copied verbatim from `profiles/EXPERIENCE-REFERENCE.md`
2. `## Certifications` — copied verbatim from `profiles/EXPERIENCE-REFERENCE.md`

Do not paraphrase, reorder, or abbreviate. ATS systems explicitly require these sections.

## Age Perception — Standard Mitigations (No Fabrication)

Apply to every resume without being asked. None involve changing facts:

1. **Remove year ranges from Earlier Career entries.** Keep company names and role titles; do not add "earlier" or vague date placeholders.
2. **Replace "X+ years" language in summaries with positioning language** — "Deep delivery experience spanning..." / "Extensive customer-facing background in..." — no calendar anchor.
3. **Omit graduation year from Education.** University name and degree are sufficient.

Check every draft before presenting; flag any violation.

## Pandoc list parsing — required blank line before bullets

Pandoc requires a **blank line between a paragraph and a list** to render list items as `<ul><li>`. Without it, pandoc treats the `-` markers as inline text and collapses all bullets into a single `<p>` block.

**Every role entry must follow this structure:**

```markdown
**Company** | Title | Dates  
*Italic company description*

- First bullet
- Second bullet
```

The blank line after the italic description line is mandatory. Without it, the PDF renders bullets inline separated by ` - ` instead of as a proper list — a silent rendering failure that is not visible in the `.md` file.

**Check before generating PDF:** Verify every role block has a blank line between the italic description and the first bullet. This applies to all roles including NeuronSource, and any role with an italic context line.

## PDF Generation — Always Use Playwright Script

Always use the Playwright script — never Chrome `--print-to-pdf` directly (Chrome adds filename/filepath to header/footer).

```bash
source "$APP_DIR/.env"
pandoc "$RESUME_MD" -o "$RESUME_HTML" --css="$APP_DIR/templates/resume.css" --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$RESUME_HTML" "$RESUME_PDF"
rm "$RESUME_HTML"
pdfinfo "$RESUME_PDF" | grep Pages
```

For 1-page resumes, add `--css="$APP_DIR/templates/one-page-override.css"` to the pandoc command.

Output: date in header (right), page number in footer (center), no filename or filepath anywhere.

**After PDF generation and page count verification — OB1 mode PDF upload:**

Use the REST API curl command from the storage-routing policy. **NEVER use `upload_file` MCP tool for PDFs** — binary files exceed MCP transport limits. Go directly to REST; do not attempt MCP first.

After upload (HTTP 2xx), verify `bytes` in the response is non-zero. If `bytes` is 0 or missing: **hard stop** — the content field was empty (the PDF may have been deleted from `/tmp` between generation and upload); do not call `update_application_status` with a corrupt upload. Re-generate the PDF and retry the upload.

On successful upload: call `update_application_status(id, 'resume-ready', 'Resume generated [YYYY-MM-DD] — not yet submitted', null)`. Do NOT copy the PDF to `$APPLICANT_DIR`.

**Local fallback:** PDF stays at `$RESUME_PDF`; update `application-tracker.md` to `Resume Ready`.

## Recruiter & ATS Appeal Analysis (Required After Every Resume)

After the JD requirement scoring, produce a second analysis block covering real-world response likelihood — separate from "does the resume cover the requirements"; it answers "will this resume actually get read and acted on." Four subsections:

1. **ATS Performance** — keyword coverage, format risks (delimiter-heavy capability lines, date parsing). Flag if the hiring stack is likely ATS-heavy (large enterprise) vs. light (seed-stage startup).
2. **Recruiter Eye Scan (6 seconds)** — what the recruiter sees first: positioning line, company name brand recognition, summary scannability, career span visibility from date math. Be specific about which company names have recognition and which don't. Flag dense paragraph blocks.
3. **Structural factors** — anything affecting response odds regardless of content quality: company size/stage fit, age signal visibility from date ranges, simultaneous contracts reading as fractional, lack of F500 brands in recent roles, absence of quantified outcomes. Be honest.
4. **Response likelihood estimate** — an honest probability range (e.g. "15–25%") with specific factors for and against. Not optimistic cheerleading. End with the single most impactful thing that would improve odds (warm intro, specific reframe, cutting a section, etc.).

**Tone:** Honest and direct. The applicant explicitly values candor over reassurance.

## Evaluation report contents

The Resume Evaluation Report (written to `notes.md`) must include:
- Coverage table: every JD requirement scored MET / PARTIAL / GAP
- Overall effectiveness and competitive positioning vs. the JD
- Any differentiators surfaced or missed
- Any explicit gaps (Required items that remained GAP after 2 cycles) and recommended mitigation
- The Recruiter & ATS Appeal Analysis (four subsections above)

## The 3 questions the resume must answer quickly

1. Does this person fit the role?
2. Do they have credible experience?
3. Can they succeed in our environment?
