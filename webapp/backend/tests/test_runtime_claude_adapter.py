"""ClaudeRunnerAdapter contract — stub claude binary + in-test runner HTTP server."""

import http.server
import json
import os
import stat
import threading

import pytest

from runtime.adapter import AdapterUnavailable
from runtime.claude_adapter import ClaudeRunnerAdapter
from runtime.composer import compose_prompt
from runtime.events import record_event
from runtime.models import SkillRunRequest
from runtime.registry import load_registry, resolve
from tests.test_runtime_registry import make_tree

CANNED_EVENTS = [
    {'type': 'system', 'subtype': 'init', 'session_id': 'abc123'},
    {'type': 'assistant', 'message': {'content': [
        {'type': 'tool_use', 'name': 'mcp__job-search__upload_file',
         'input': {'key': 'applications/2026-06-12-acme-se/notes.md', 'content': 'x'}},
    ]}},
    {'type': 'assistant', 'message': {'content': [
        {'type': 'text', 'text': 'Verdict: fit. Profile: presales-se.'},
    ]}},
    {'type': 'result', 'subtype': 'success', 'result': 'Verdict: fit. Profile: presales-se.',
     'usage': {'input_tokens': 100, 'output_tokens': 20}, 'total_cost_usd': 0.01},
]


def write_stub(tmp_path, lines=None, exit_code=0, sleep_s=0):
    """Shell script standing in for the claude binary: emits canned stream-json."""
    body = ['#!/bin/sh', 'cat > /dev/null']  # consume stdin like claude -p does
    if sleep_s:
        body.append(f'sleep {sleep_s}')
    for line in (lines if lines is not None else CANNED_EVENTS):
        body.append(f"echo '{json.dumps(line)}'")
    body.append(f'exit {exit_code}')
    stub = tmp_path / 'claude-stub'
    stub.write_text('\n'.join(body) + '\n')
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    return str(stub)


@pytest.fixture
def prompt_and_reg(tmp_path):
    reg = load_registry(make_tree(tmp_path / 'repo'))
    resolved = resolve(reg, 'demo-skill', mode='webapp')
    return compose_prompt(resolved, reg, 'webapp'), reg


def _adapter(tmp_path, binary):
    return ClaudeRunnerAdapter(app_dir=tmp_path, binary=binary)


async def test_successful_run(tmp_path, prompt_and_reg):
    prompt, _ = prompt_and_reg
    adapter = _adapter(tmp_path, write_stub(tmp_path))
    req = SkillRunRequest(skill='demo-skill', task={'instructions': 'go'})
    result = await adapter.run_skill(req, prompt)
    assert result.status == 'ok'
    assert result.output_text == 'Verdict: fit. Profile: presales-se.'
    assert result.version == 'v1' and result.adapter == 'claude-runner'
    assert [a.key for a in result.artifacts] == ['applications/2026-06-12-acme-se/notes.md']
    assert result.usage['input_tokens'] == 100
    assert result.usage['total_cost_usd'] == 0.01
    assert len(result.transcript) == 4


async def test_error_run_no_result_event(tmp_path, prompt_and_reg):
    prompt, _ = prompt_and_reg
    adapter = _adapter(tmp_path, write_stub(
        tmp_path, lines=[{'type': 'system', 'subtype': 'init'}], exit_code=1))
    result = await adapter.run_skill(SkillRunRequest(skill='demo-skill'), prompt)
    assert result.status == 'error'


async def test_timeout(tmp_path, prompt_and_reg):
    prompt, _ = prompt_and_reg
    adapter = _adapter(tmp_path, write_stub(tmp_path, sleep_s=5))
    req = SkillRunRequest(skill='demo-skill', timeout_s=1)
    result = await adapter.run_skill(req, prompt)
    assert result.status == 'timeout'
    assert 'exceeded 1s' in result.error


async def test_missing_binary_raises(tmp_path, prompt_and_reg):
    prompt, _ = prompt_and_reg
    adapter = _adapter(tmp_path, str(tmp_path / 'does-not-exist'))
    with pytest.raises(AdapterUnavailable):
        await adapter.run_skill(SkillRunRequest(skill='demo-skill'), prompt)
    assert not await adapter.health()


async def test_health_ok(tmp_path):
    assert await _adapter(tmp_path, write_stub(tmp_path)).health()


async def test_runner_url_path(tmp_path, prompt_and_reg):
    """Adapter forwards to the runner sidecar and parses its NDJSON stream."""
    prompt, _ = prompt_and_reg
    received = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            received['body'] = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            received['path'] = self.path
            self.send_response(200)
            self.send_header('Content-Type', 'application/x-ndjson')
            self.end_headers()
            for ev in CANNED_EVENTS:
                self.wfile.write((json.dumps(ev) + '\n').encode())

        def log_message(self, *a):
            pass

    server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        adapter = ClaudeRunnerAdapter(
            app_dir=tmp_path, runner_url=f'http://127.0.0.1:{server.server_port}')
        req = SkillRunRequest(skill='demo-skill', task={'instructions': 'go'})
        result = await adapter.run_skill(req, prompt)
    finally:
        server.shutdown()

    assert result.status == 'ok'
    assert received['path'] == '/run'
    assert received['body']['cwd'] == str(tmp_path)
    assert '--append-system-prompt' in received['body']['args']
    assert 'go' in received['body']['message']


def test_record_event(tmp_path, monkeypatch):
    rec = record_event('skill_run', {'run_id': 'r1', 'skill': 'demo'}, app_dir=tmp_path)
    assert rec['kind'] == 'skill_run'
    files = list((tmp_path / '.runtime-events').glob('*.jsonl'))
    assert len(files) == 1
    line = json.loads(files[0].read_text().strip())
    assert line['run_id'] == 'r1' and line['ts']
    with pytest.raises(ValueError):
        record_event('bogus', {}, app_dir=tmp_path)
