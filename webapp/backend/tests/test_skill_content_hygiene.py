"""Run scripts/check-md-hygiene.sh over all skills/policies/workflows markdown.

Catches hygiene violations (applicant name, absolute paths) in CI/pytest,
not only at commit time.
"""

import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(os.environ['APP_DIR'])


def test_skill_markdown_hygiene():
    files = []
    for sub in ('skills', 'policies', 'workflows'):
        files.extend(str(p) for p in (REPO_ROOT / sub).rglob('*.md'))
    assert files, 'no skill markdown found — registry should have content'
    result = subprocess.run(
        ['bash', str(REPO_ROOT / 'scripts' / 'check-md-hygiene.sh'), *files],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0, f'hygiene failures:\n{result.stdout}\n{result.stderr}'
