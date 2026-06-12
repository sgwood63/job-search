---
name: feedback-resume-reporting
description: Do not surface the /tmp/ local copy path when reporting resume generation — only report the OB1 object store key
metadata:
  type: feedback
---

Do not mention `/tmp/<Name_Role>.md` in user-facing output after generating a resume.

**Why:** The `/tmp/` copy is an internal implementation detail for the PDF pipeline. Reporting it made the user think the resume had not been uploaded to OB1 — they didn't know a separate OB1 upload had also occurred.

**How to apply:** After uploading a resume `.md`, report only the OB1 key (e.g., `applications/2026-06-05-hover-senior-solutions-architect/Applicant_Name_Role_Title.md`) and confirm the upload succeeded. The `/tmp/` write is silent infrastructure — never surface it in the response.
