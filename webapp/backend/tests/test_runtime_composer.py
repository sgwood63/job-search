"""Prompt composition: skill body + policies in manifest order, deduped, with header."""

from runtime.composer import compose_prompt, render_task
from runtime.registry import load_registry, resolve
from tests.test_runtime_registry import make_tree


def _reg(tmp_path, policies):
    entries = {'demo-skill': {'kind': 'skill', 'policies': policies}}
    for p in dict.fromkeys(policies):
        entries[p] = {'kind': 'policy'}
    return load_registry(make_tree(tmp_path, entries=entries))


def test_composition_order_and_header(tmp_path):
    reg = _reg(tmp_path, ['pol-a', 'pol-b'])
    resolved = resolve(reg, 'demo-skill', mode='webapp')
    prompt = compose_prompt(resolved, reg, 'webapp')
    sp = prompt.system_prompt
    assert 'executing the skill `demo-skill` at version `v1` in webapp mode' in sp
    assert sp.index('body of demo-skill') < sp.index('body of pol-a') < sp.index('body of pol-b')
    assert prompt.policies == ['pol-a@v1', 'pol-b@v1']
    assert prompt.skill == 'demo-skill' and prompt.version == 'v1' and prompt.mode == 'webapp'


def test_duplicate_policies_deduped(tmp_path):
    reg = _reg(tmp_path, ['pol-a', 'pol-a'])
    resolved = resolve(reg, 'demo-skill', mode='webapp')
    prompt = compose_prompt(resolved, reg, 'webapp')
    assert prompt.policies == ['pol-a@v1']
    assert prompt.system_prompt.count('body of pol-a') == 1


def test_no_policies(tmp_path):
    reg = load_registry(make_tree(tmp_path, entries={'demo-skill': {'kind': 'skill'}}))
    resolved = resolve(reg, 'demo-skill', mode='webapp')
    prompt = compose_prompt(resolved, reg, 'webapp')
    assert prompt.policies == []
    assert 'body of demo-skill' in prompt.system_prompt


def test_oversize_prompt_warns(tmp_path, caplog):
    reg = load_registry(make_tree(tmp_path, entries={'demo-skill': {'kind': 'skill'}}))
    big = reg.get('demo-skill').path / 'v1.md'
    big.write_text('x' * 70_000)
    resolved = resolve(reg, 'demo-skill', mode='webapp')
    with caplog.at_level('WARNING'):
        compose_prompt(resolved, reg, 'webapp')
    assert any('skill bloat' in r.message for r in caplog.records)


def test_render_task():
    msg = render_task({'instructions': 'Screen this JD', 'jd_content': 'Acme SE role'})
    assert msg.startswith('Screen this JD')
    assert 'jd_content' in msg and 'Acme SE role' in msg
    assert render_task({}) == 'Execute the procedure with no additional inputs.'
