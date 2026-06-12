"""End-to-end smoke test: run jd-evaluation@pinned through real headless Claude.

Skipped unless RUNTIME_SMOKE=1 — requires a resolvable claude binary and
makes a real (billed) model call. Run locally:

    RUNTIME_SMOKE=1 .venv/bin/pytest tests/test_smoke_skill_run.py -q
"""

import os
from pathlib import Path

import pytest

from runtime.claude_adapter import ClaudeRunnerAdapter
from runtime.composer import compose_prompt
from runtime.models import SkillRunRequest
from runtime.registry import load_registry, resolve

pytestmark = pytest.mark.skipif(
    os.environ.get('RUNTIME_SMOKE') != '1',
    reason='set RUNTIME_SMOKE=1 to run the live smoke test',
)

CANNED_JD = """
Title: Solutions Engineer
Company: Acme Analytics
Location: Remote (US)
Travel: up to 10%
Compensation: $170,000 - $200,000 OTE
Requirements: 5+ years pre-sales or solutions engineering; SQL and BI tools;
customer-facing demos and POCs; SaaS analytics background.
"""


async def test_jd_evaluation_smoke():
    repo_root = Path(os.environ['APP_DIR'])
    reg = load_registry(repo_root)
    resolved = resolve(reg, 'jd-evaluation', mode='webapp')
    prompt = compose_prompt(resolved, reg, 'webapp')
    adapter = ClaudeRunnerAdapter(app_dir=repo_root, env_path=repo_root / '.env')

    req = SkillRunRequest(
        skill='jd-evaluation', timeout_s=300,
        task={'instructions': 'Screen this JD and return a fit/no-fit verdict '
                              'with reasoning and a matched profile.',
              'jd_content': CANNED_JD},
    )
    result = await adapter.run_skill(req, prompt)
    assert result.status == 'ok', result.error
    text = result.output_text.lower()
    assert 'fit' in text  # verdict (fit or no-fit) must appear
    assert result.version == 'v1'
