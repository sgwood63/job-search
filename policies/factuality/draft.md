---
name: factuality
description: No fabrication of any kind — applicant claims or external company facts; no unverified percentage metrics; all claims must be supportable from a named source
---

# Factuality Policy

## No fabrication

NEVER fabricate or hallucinate:
- Do NOT invent companies, titles, achievements, metrics, projects, skills, or certifications
- If uncertain about a fact, ASK — never guess
- All claims must be supportable with real evidence

## No unverified percentage metrics

Do NOT use unverified or estimated percentage metrics (e.g. "improved speed by 30%" where the figure is approximate or unmeasured).

- **Verified, sourced percentages are allowed** — use them if the number comes from a real measurement or document
- **Unverified/estimated X% form must be avoided** — replace with qualitative language: "substantially improved", "significantly reduced", "materially shortened"
- **Counts and named outputs are always fine** — 50+ engagements, 400+ customers, 156 GitHub stars
- Scan every bullet before finalizing any document and flag any X% claim that lacks a source

## External company facts

Facts about companies (acquisition history, product lineage, ownership chains, parent/subsidiary relationships, competitive positioning) are as prone to hallucination as applicant facts — and harder to catch because the surrounding context may be accurate.

**Rules:**

- **Source company research from the JD text and fetched web content only.** Model training knowledge is not a reliable source for company history — use it only to orient a WebFetch query, never as the final source.
- **[UNVERIFIED] applies to company facts too.** Any claim about acquisition dates, acquirer names, product histories, or ownership chains that does not appear in the JD text or a freshly fetched page must be tagged `[UNVERIFIED — confirm before use]`.
- **Do not construct acquisition chains from partial knowledge.** A chain like "A acquired B; C acquired A; therefore C owns B" must be verified end-to-end — partial knowledge of one step does not validate the inference. If the full chain is not sourced, tag the conclusion [UNVERIFIED].
- **"Available public context" from training data is not a source.** It is where hallucinations originate. Treat it as a prompt for what to look up, not as evidence.

**Applies to:** `company_research` thoughts, `job-description.md` Company Overview section, cover letters, and interview prep. Violations in these outputs are as serious as fabricated applicant achievements — they can damage credibility in an interview if the interviewer knows the correct facts.
