"""Registry parsing/validation — fixture tree + real-repo anti-drift checks."""

import os
from pathlib import Path

import pytest
import yaml

from runtime.registry import RegistryError, load_registry

REPO_ROOT = Path(os.environ['APP_DIR'])


def make_tree(root: Path, entries=None, registry_entries=None):
    """Write a minimal skills tree. entries: dict name -> manifest overrides."""
    defaults = {
        'demo-skill': {'kind': 'skill', 'policies': ['demo-policy']},
        'demo-policy': {'kind': 'policy'},
    }
    entries = entries if entries is not None else defaults
    reg_rows = []
    for name, spec in entries.items():
        kind = spec.get('kind', 'skill')
        subdir = {'skill': 'skills', 'policy': 'policies', 'workflow': 'workflows'}[kind]
        d = root / subdir / name
        d.mkdir(parents=True, exist_ok=True)
        manifest = {
            'name': name, 'kind': kind, 'description': 'test', 'status': 'active',
            'pinned': 'v1', 'latest': 'v1', **{k: v for k, v in spec.items() if k != 'versions'},
        }
        (d / 'skill.yaml').write_text(yaml.safe_dump(manifest))
        for v in spec.get('versions', ['v1']):
            (d / f'{v}.md').write_text(f'# {name} {v}\nbody of {name} {v}\n')
        reg_rows.append({'name': name, 'kind': kind, 'path': f'{subdir}/{name}'})
    (root / 'skills').mkdir(exist_ok=True)
    (root / 'skills' / 'registry.yaml').write_text(
        yaml.safe_dump({'version': 1, 'entries': registry_entries if registry_entries is not None else reg_rows}))
    return root


def test_load_fixture_tree(tmp_path):
    reg = load_registry(make_tree(tmp_path))
    assert set(reg.entries) == {'demo-skill', 'demo-policy'}
    entry = reg.get('demo-skill')
    assert entry.pinned == 'v1'
    assert entry.versions() == ['v1']
    assert not entry.has_draft()


def test_missing_manifest_fails(tmp_path):
    make_tree(tmp_path)
    (tmp_path / 'skills' / 'demo-skill' / 'skill.yaml').unlink()
    with pytest.raises(RegistryError, match='manifest not found'):
        load_registry(tmp_path)


def test_pinned_file_missing_fails(tmp_path):
    make_tree(tmp_path, entries={'demo-skill': {'kind': 'skill', 'pinned': 'v2'}})
    with pytest.raises(RegistryError, match='pinned version file missing'):
        load_registry(tmp_path)


def test_pinned_draft_fails(tmp_path):
    make_tree(tmp_path, entries={'demo-skill': {'kind': 'skill', 'pinned': 'draft'}})
    with pytest.raises(RegistryError, match='pinned must never be a draft'):
        load_registry(tmp_path)


def test_unknown_policy_reference_fails(tmp_path):
    make_tree(tmp_path, entries={'demo-skill': {'kind': 'skill', 'policies': ['nope']}})
    with pytest.raises(RegistryError, match="unknown policy 'nope'"):
        load_registry(tmp_path)


def test_policy_reference_to_non_policy_fails(tmp_path):
    make_tree(tmp_path, entries={
        'a': {'kind': 'skill', 'policies': ['b']},
        'b': {'kind': 'skill'},
    })
    with pytest.raises(RegistryError, match='not a policy'):
        load_registry(tmp_path)


def test_name_mismatch_fails(tmp_path):
    root = make_tree(tmp_path)
    manifest_path = root / 'skills' / 'demo-skill' / 'skill.yaml'
    m = yaml.safe_load(manifest_path.read_text())
    m['name'] = 'other'
    manifest_path.write_text(yaml.safe_dump(m))
    with pytest.raises(RegistryError, match='does not match registry'):
        load_registry(tmp_path)


# --- Real repo validation (anti-drift) -------------------------------------

def test_real_repo_registry_loads():
    reg = load_registry(REPO_ROOT)
    assert len(reg.entries) >= 10


def test_real_repo_registry_matches_directories():
    """Every registry entry has a dir; every skill-shaped dir is registered."""
    reg = load_registry(REPO_ROOT)
    registered_dirs = {e.path.resolve() for e in reg.entries.values()}
    on_disk = set()
    for sub in ('skills', 'policies', 'workflows'):
        base = REPO_ROOT / sub
        if not base.is_dir():
            continue
        for d in base.iterdir():
            if d.is_dir() and (d / 'skill.yaml').is_file():
                on_disk.add(d.resolve())
    assert registered_dirs == on_disk, (
        f'registry/disk drift: only-registered={registered_dirs - on_disk}, '
        f'only-on-disk={on_disk - registered_dirs}')


def test_real_repo_pinned_versions_exist():
    reg = load_registry(REPO_ROOT)
    for entry in reg.entries.values():
        assert entry.version_file(entry.pinned).is_file(), entry.name
        assert entry.pinned != 'draft'
        assert entry.latest in entry.versions(), f'{entry.name}: latest not on disk'
