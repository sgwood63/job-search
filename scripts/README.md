# Scripts

## setup.sh

One-time setup script. Run from the repo root before starting a job search.

```bash
bash scripts/setup.sh
```

Detects an existing applicant configuration and offers a **refresh** path (re-check deps, auth, sync) or a **new applicant** path. On new setup:

1. Checks Claude Code auth (OAuth or API key)
2. Installs PDF generation dependencies: pandoc, poppler
3. Detects Playwright Python installation and records it in `.env`
4. Detects installed cloud sync services; presents a numbered menu to set `$APPLICANT_DIR`
5. Writes `.env` with `APP_DIR`, `APPLICANT_DIR`, `APPLICANT_NAME`, `PLAYWRIGHT_PYTHON`, and auth config
6. Scaffolds `$APPLICANT_DIR` with stub files from `templates/scaffold/`

Safe to re-run — existing files are never overwritten (triggers refresh path instead).

---

## fetch-jd.py

Playwright-based job description fetcher. Called automatically by Claude during the JD workflow.

```bash
source "$APP_DIR/.env"

# Fetch a public URL (no auth needed)
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" "<url>"

# Fetch and save full page text as markdown
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --md-out "$FOLDER/jd-company-role.md" "<url>"

# First-time auth setup for a login-walled site (e.g. LinkedIn)
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --setup 'https://www.linkedin.com/jobs/view/123'

# Import cookies from Firefox without opening a browser
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/fetch-jd.py" --import linkedin.com
```

Exit codes:
- `0` — success
- `1` — navigation error (ask user to paste JD text)
- `2` — auth required or expired (re-run `--setup` or `--import`)

Auth cookies are saved to `$APPLICANT_DIR/.auth/<domain>.json`. Re-run `--setup` or `--import` when exit code 2 is returned.

---

## generate-pdf.py

Converts an HTML resume file to PDF using Playwright (headless Chromium). Produces clean output with no filename or filepath in headers/footers.

```bash
source "$APP_DIR/.env"
pandoc "$RESUME_MD" -o "$RESUME_HTML" --css="$APP_DIR/templates/resume.css" --standalone
"$PLAYWRIGHT_PYTHON" "$APP_DIR/scripts/generate-pdf.py" "$RESUME_HTML" "$RESUME_PDF"
rm "$RESUME_HTML"
pdfinfo "$RESUME_PDF" | grep Pages
```

Always source `.env` before running — `$PLAYWRIGHT_PYTHON` must be set. Never use `--print-to-pdf` via Chrome directly; Chrome adds filename/filepath to the header/footer.

---

## check-md-hygiene.sh

Pre-commit hook that enforces two rules on every `.md` file staged in `$APP_DIR`:

1. **No personal names** — rejects commits containing the applicant's name (read from `.env`)
2. **No hard-coded absolute paths** — rejects commits containing literal home directory paths

Install once with `bash scripts/install-hooks.sh`. Runs automatically on every `git commit`.

---

## install-hooks.sh

Installs git hooks into `.git/hooks/`. Run once after cloning:

```bash
bash scripts/install-hooks.sh
```

Installs `pre-commit` → `scripts/check-md-hygiene.sh`.
