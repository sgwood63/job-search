"""/api/skills endpoints — TestClient + FakeAdapter (mirrors mock_ob_rest pattern)."""

import json

import pytest

from runtime.adapter import AdapterUnavailable
from runtime.models import SkillRunResult


class FakeAdapter:
    name = 'fake'

    def __init__(self):
        self.calls = []
        self.unavailable = False

    async def run_skill(self, req, prompt):
        if self.unavailable:
            raise AdapterUnavailable('fake adapter down')
        self.calls.append((req, prompt))
        return SkillRunResult(
            status='ok', skill=req.skill, version=prompt.version, adapter=self.name,
            output_text='fake output',
        )

    async def health(self):
        return not self.unavailable

    def iter_events(self, req, prompt):
        self.calls.append((req, prompt))
        yield {'type': 'system', 'subtype': 'init'}
        yield {'type': 'result', 'subtype': 'success', 'result': 'streamed'}


@pytest.fixture
def skills_client(client, monkeypatch, tmp_path):
    """TestClient with the real repo registry and a FakeAdapter; events to tmp."""
    import main as main_mod
    fake = FakeAdapter()
    monkeypatch.setattr(main_mod, '_adapter', fake)
    monkeypatch.setattr(main_mod, '_registry', None)       # force fresh load from real repo
    orig_record = main_mod.runtime_pkg.record_event
    monkeypatch.setattr(main_mod.runtime_pkg, 'record_event',
                        lambda kind, payload, app_dir=None: orig_record(kind, payload, app_dir=tmp_path))
    return client, fake, tmp_path


def test_list_skills(skills_client):
    client, _, _ = skills_client
    resp = client.get('/api/skills')
    assert resp.status_code == 200
    rows = resp.json()
    names = {r['name'] for r in rows}
    assert {'jd-evaluation', 'resume-generation', 'storage-routing', 'create-application'} <= names
    rg = next(r for r in rows if r['name'] == 'resume-generation')
    assert rg['kind'] == 'skill' and rg['pinned'] == 'v1' and rg['has_draft'] is False
    assert 'factuality' in rg['policies']


def test_get_skill(skills_client):
    client, _, _ = skills_client
    resp = client.get('/api/skills/factuality')
    assert resp.status_code == 200
    assert resp.json()['kind'] == 'policy'
    assert client.get('/api/skills/nope').status_code == 404


def test_run_skill_forces_webapp_mode(skills_client):
    client, fake, _ = skills_client
    resp = client.post('/api/skills/jd-evaluation/run',
                       json={'task': {'instructions': 'screen this', 'jd_content': 'x'}})
    assert resp.status_code == 200
    body = resp.json()
    assert body['status'] == 'ok' and body['version'] == 'v1' and body['adapter'] == 'fake'
    req, prompt = fake.calls[0]
    assert req.mode == 'webapp'
    assert prompt.mode == 'webapp'
    assert 'jd-evaluation' in prompt.system_prompt


def test_run_skill_records_event(skills_client):
    client, _, tmp_path = skills_client
    client.post('/api/skills/jd-evaluation/run', json={'task': {}})
    events_dir = tmp_path / '.runtime-events'
    lines = [json.loads(l) for f in events_dir.glob('*.jsonl') for l in f.read_text().splitlines()]
    assert any(e['kind'] == 'skill_run' and e['skill'] == 'jd-evaluation' for e in lines)


def test_run_skill_draft_refused_by_default(skills_client):
    client, _, _ = skills_client
    resp = client.post('/api/skills/jd-evaluation/run', json={'version': 'draft'})
    assert resp.status_code == 403


def test_run_unknown_skill_404(skills_client):
    client, _, _ = skills_client
    assert client.post('/api/skills/nope/run', json={}).status_code == 404


def test_run_adapter_unavailable_503(skills_client):
    client, fake, _ = skills_client
    fake.unavailable = True
    resp = client.post('/api/skills/jd-evaluation/run', json={})
    assert resp.status_code == 503


def test_run_stream(skills_client):
    client, fake, _ = skills_client
    resp = client.post('/api/skills/jd-evaluation/run?stream=1', json={'task': {}})
    assert resp.status_code == 200
    lines = [json.loads(l) for l in resp.text.strip().splitlines()]
    assert lines[-1]['result'] == 'streamed'


def test_corrections_endpoint(skills_client):
    client, _, tmp_path = skills_client
    resp = client.post('/api/skills/resume-generation/corrections',
                       json={'run_id': 'r1', 'correction': 'add company descriptions'})
    assert resp.status_code == 200
    assert resp.json()['ok'] is True
    events = [json.loads(l) for f in (tmp_path / '.runtime-events').glob('*.jsonl')
              for l in f.read_text().splitlines()]
    assert any(e['kind'] == 'correction' and e['run_id'] == 'r1' for e in events)

    assert client.post('/api/skills/resume-generation/corrections',
                       json={'correction': 'x'}).status_code == 422
    assert client.post('/api/skills/nope/corrections',
                       json={'run_id': 'r1', 'correction': 'x'}).status_code == 404
