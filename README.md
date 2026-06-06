# Job Search Management System

## Contents

- [What This System Does](#what-this-system-does)
- [Requirements](#requirements)
- [Two-Repo Structure](#two-repo-structure)
- [Getting Started](#getting-started)
- [What Makes This Different](#what-makes-this-different)

---

An AI-assisted, structured system for finding, applying to, and tracking job opportunities — built to maintain authentic voice, factual accuracy, and consistent process across a multi-month search.

## What This System Does

One setup: you describe your background, experience, and goals once. After that, the system does the heavy lifting for every application.

- **Profile and career advice** — the setup process analyzes your background, gives career direction advice, and generates target role profiles so every application draws from pre-vetted, accurately-voiced content.
- **JD evaluation and scoring** — when you provide a job description, the system screens it for fit, scores it against your criteria, and gives you a reason before doing any resume work.
- **Tailored resumes, cover letters, and application content** — resumes are generated from your verified content library; cover letters and portal question answers are produced in the same voice, from the same facts.
- **Full-cycle tracking** — application status, interview prep, post-call notes, and debrief feedback all live in one place; corrections and new experience automatically carry forward into future applications.

---

## Requirements

| Requirement | Notes |
|---|---|
| [Claude Code](https://claude.ai/code) | The CLI that runs all AI-assisted steps. Install via the desktop app or `npm install -g @anthropic-ai/claude-code`. |
| Anthropic API key | Required if not using Claude Code OAuth. Get one at [console.anthropic.com](https://console.anthropic.com). Set during `scripts/setup.sh`. |
| `ANTHROPIC_API_DEPLOYMENT_KEY` | **Container deployments only** (webapp docker-compose, K8s OB1 stack). OAuth does not work inside Docker — set this separately in `.env`. Not needed for local Claude Code sessions. |
| Claude Haiku | Used for JD screening (fast, low-cost). Included with Pro subscription or API key. |
| Claude Sonnet | Used for resume and document generation (quality). Included with Pro subscription or API key. |
| pandoc + Playwright + poppler | PDF generation. Installed/detected by `scripts/setup.sh`. |

---

## Two-Repo Structure

This system uses two directories with distinct purposes:

| Directory | Purpose | Git-tracked |
|---|---|---|
| `$APP_DIR` (this repo) | Process, tooling, templates, memory | Yes |
| `$APPLICANT_DIR` | Applicant data, applications, profiles, tracker | No |

Paths are defined in `.env` — see [QUICK-START.md](QUICK-START.md) for setup.

Applicant data is kept out of git to protect personal information and keep the process repo portable.

---

## Getting Started

- **New to the system?** Start with [QUICK-START.md](QUICK-START.md).
- **Day-to-day usage?** See [USER-GUIDE.md](USER-GUIDE.md) — workflows, commands, and examples.
- **Modifying the system?** See [DEVELOPER-README.md](DEVELOPER-README.md) — architecture, DEV_MODE, hooks, scripts, and settings.
- **Choosing a deployment model?** See [DEPLOYMENT.md](DEPLOYMENT.md) — explains the five deployment dimensions (data backend, OB1 infrastructure, app driver, webapp location) and provides end-to-end instructions for each tested configuration.
- **OB1 deployment?** See [integrations/ob1/README.md](integrations/ob1/README.md) — full K8s manifest reference. For a higher-level walkthrough including Docker Compose and decision guidance, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## What Makes This Different

- **Factual accuracy** — every resume bullet traces to a verified source; nothing is invented.
- **Authentic voice** — all materials are generated from your own words and experience, not generic templates.
- **Compounding improvement** — corrections, debrief notes, and new experience carry forward automatically into every future application.
- **Full-cycle coverage** — JD screening, resume, cover letter, portal questions, interview prep, and post-call tracking in one place.
