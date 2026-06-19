"""Mode-based version resolution rules."""

import pytest

from runtime.registry import RegistryError, load_registry, resolve
from tests.test_runtime_registry import make_tree


@pytest.fixture
def reg(tmp_path):
    root = make_tree(tmp_path, entries={
        'demo-skill': {'kind': 'skill', 'pinned': 'v1', 'latest': 'v2',
                       'versions': ['v1', 'v2'], 'policies': ['demo-policy']},
        'demo-policy': {'kind': 'policy'},
    })
    return load_registry(root)


def test_webapp_uses_pinned(reg):
    r = resolve(reg, 'demo-skill', mode='webapp')
    assert r.version == 'v1'
    assert 'demo-skill v1' in r.body


def test_webapp_explicit_version(reg):
    assert resolve(reg, 'demo-skill', version='v2', mode='webapp').version == 'v2'


def test_webapp_refuses_draft(reg):
    (reg.get('demo-skill').path / 'draft.md').write_text('# draft')
    with pytest.raises(RegistryError, match='pinned-only'):
        resolve(reg, 'demo-skill', version='draft', mode='webapp')


def test_interactive_prefers_draft(reg):
    entry = reg.get('demo-skill')
    assert resolve(reg, 'demo-skill', mode='interactive').version == 'v1'  # no draft yet
    (entry.path / 'draft.md').write_text('# draft body')
    r = resolve(reg, 'demo-skill', mode='interactive')
    assert r.version == 'draft'
    assert r.body == '# draft body'


def test_interactive_explicit_version_honored(reg):
    (reg.get('demo-skill').path / 'draft.md').write_text('# draft body')
    assert resolve(reg, 'demo-skill', version='v2', mode='interactive').version == 'v2'


def test_unknown_skill(reg):
    with pytest.raises(RegistryError, match='unknown'):
        resolve(reg, 'missing', mode='webapp')


def test_unknown_version(reg):
    with pytest.raises(RegistryError, match='not found'):
        resolve(reg, 'demo-skill', version='v9', mode='webapp')


def test_unknown_mode(reg):
    with pytest.raises(RegistryError, match='unknown mode'):
        resolve(reg, 'demo-skill', mode='batch')
