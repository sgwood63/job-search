"""HermesAdapter — fake hermes binary; unavailable-by-default contract."""

import stat

import pytest

from runtime.adapter import AdapterUnavailable
from runtime.composer import compose_prompt
from runtime.hermes_adapter import HermesAdapter
from runtime.models import SkillRunRequest
from runtime.registry import load_registry, resolve
from tests.test_runtime_registry import make_tree


@pytest.fixture
def prompt(tmp_path):
    reg = load_registry(make_tree(tmp_path / 'repo'))
    return compose_prompt(resolve(reg, 'demo-skill', mode='webapp'), reg, 'webapp')


async def test_unavailable_without_headless_cmd(tmp_path, prompt):
    adapter = HermesAdapter(app_dir=tmp_path, hermes_home=tmp_path / 'hermes', headless_cmd='')
    assert not await adapter.health()
    with pytest.raises(AdapterUnavailable, match='no documented headless invocation'):
        await adapter.run_skill(SkillRunRequest(skill='demo-skill'), prompt)


async def test_materializes_skill_and_runs(tmp_path, prompt):
    stub = tmp_path / 'fake-hermes'
    stub.write_text('#!/bin/sh\ncat > /dev/null\necho "hermes says: done $1"\n')
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    home = tmp_path / 'hermes-home'

    adapter = HermesAdapter(app_dir=tmp_path, hermes_home=home,
                            headless_cmd=f'{stub} {{skill}}')
    assert await adapter.health()
    result = await adapter.run_skill(
        SkillRunRequest(skill='demo-skill', task={'instructions': 'go'}), prompt)

    assert result.status == 'ok'
    assert result.adapter == 'hermes'
    assert 'job-search-demo-skill' in result.output_text

    skill_file = home / 'skills' / 'job-search-demo-skill' / 'SKILL.md'
    assert skill_file.is_file()
    content = skill_file.read_text()
    assert content.startswith('---\nname: job-search-demo-skill\n')
    assert 'body of demo-skill' in content


async def test_nonzero_exit_is_error(tmp_path, prompt):
    stub = tmp_path / 'fake-hermes'
    stub.write_text('#!/bin/sh\ncat > /dev/null\necho boom >&2\nexit 3\n')
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    adapter = HermesAdapter(app_dir=tmp_path, hermes_home=tmp_path / 'h',
                            headless_cmd=str(stub))
    result = await adapter.run_skill(SkillRunRequest(skill='demo-skill'), prompt)
    assert result.status == 'error'
    assert 'boom' in result.error


async def test_missing_binary_raises_unavailable(tmp_path, prompt):
    adapter = HermesAdapter(app_dir=tmp_path, hermes_home=tmp_path / 'h',
                            headless_cmd=str(tmp_path / 'nope'))
    with pytest.raises(AdapterUnavailable, match='binary not found'):
        await adapter.run_skill(SkillRunRequest(skill='demo-skill'), prompt)
