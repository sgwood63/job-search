"""Skill registry: load skills/registry.yaml + per-entry skill.yaml manifests.

Resolution rules:
  webapp:      explicit version or `pinned`; 'draft' is refused (pinned-only guarantee)
  interactive: explicit version honored; else draft.md if present; else `pinned`
"""

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

KINDS = ('skill', 'policy', 'workflow')
_VERSION_RE = re.compile(r'^v(\d+)$')


class RegistryError(Exception):
    pass


@dataclass
class Entry:
    name: str
    kind: str
    path: Path                       # absolute directory of the entry
    manifest: dict = field(default_factory=dict)

    @property
    def pinned(self) -> str:
        return str(self.manifest.get('pinned', ''))

    @property
    def latest(self) -> str:
        return str(self.manifest.get('latest', ''))

    @property
    def status(self) -> str:
        return str(self.manifest.get('status', 'active'))

    @property
    def policies(self) -> list[str]:
        return list(self.manifest.get('policies') or [])

    def versions(self) -> list[str]:
        """Committed versions on disk, ascending (v1, v2, ...)."""
        found = []
        for f in self.path.glob('v*.md'):
            m = _VERSION_RE.match(f.stem)
            if m:
                found.append((int(m.group(1)), f.stem))
        return [name for _, name in sorted(found)]

    def has_draft(self) -> bool:
        return (self.path / 'draft.md').is_file()

    def version_file(self, version: str) -> Path:
        return self.path / ('draft.md' if version == 'draft' else f'{version}.md')


@dataclass
class Registry:
    root: Path                       # repo root ($APP_DIR)
    entries: dict[str, Entry] = field(default_factory=dict)

    def get(self, name: str) -> Entry:
        try:
            return self.entries[name]
        except KeyError:
            raise RegistryError(f'unknown skill/policy/workflow: {name!r}') from None


@dataclass
class ResolvedSkill:
    name: str
    kind: str
    version: str                     # 'vN' or 'draft'
    body: str
    manifest: dict
    path: Path


def load_registry(root: Path) -> Registry:
    """Parse skills/registry.yaml and every entry's skill.yaml; validate consistency."""
    root = Path(root)
    index_path = root / 'skills' / 'registry.yaml'
    if not index_path.is_file():
        raise RegistryError(f'registry not found: {index_path}')
    index = yaml.safe_load(index_path.read_text()) or {}

    reg = Registry(root=root)
    for raw in index.get('entries', []):
        name, kind, rel = raw.get('name'), raw.get('kind'), raw.get('path')
        if not (name and kind and rel):
            raise RegistryError(f'registry entry missing name/kind/path: {raw!r}')
        if kind not in KINDS:
            raise RegistryError(f'{name}: invalid kind {kind!r} (expected one of {KINDS})')
        entry_dir = root / rel
        manifest_path = entry_dir / 'skill.yaml'
        if not manifest_path.is_file():
            raise RegistryError(f'{name}: manifest not found: {manifest_path}')
        manifest = yaml.safe_load(manifest_path.read_text()) or {}
        if manifest.get('name') != name:
            raise RegistryError(f"{name}: manifest name {manifest.get('name')!r} does not match registry")
        if manifest.get('kind') != kind:
            raise RegistryError(f"{name}: manifest kind {manifest.get('kind')!r} does not match registry kind {kind!r}")
        entry = Entry(name=name, kind=kind, path=entry_dir, manifest=manifest)
        if entry.pinned == 'draft':
            raise RegistryError(f'{name}: pinned must never be a draft')
        if not entry.version_file(entry.pinned).is_file():
            raise RegistryError(f'{name}: pinned version file missing: {entry.version_file(entry.pinned)}')
        if name in reg.entries:
            raise RegistryError(f'duplicate registry entry: {name}')
        reg.entries[name] = entry

    # Second pass: every referenced policy must exist and be kind=policy
    for entry in reg.entries.values():
        for pol in entry.policies:
            target = reg.entries.get(pol)
            if target is None:
                raise RegistryError(f'{entry.name}: references unknown policy {pol!r}')
            if target.kind != 'policy':
                raise RegistryError(f'{entry.name}: {pol!r} is kind={target.kind}, not a policy')
    return reg


def resolve(reg: Registry, name: str, version: str | None = None,
            mode: str = 'webapp') -> ResolvedSkill:
    entry = reg.get(name)

    if mode == 'webapp':
        if version == 'draft':
            raise RegistryError(f'{name}: draft versions cannot run in webapp mode (pinned-only)')
        chosen = version or entry.pinned
    elif mode == 'interactive':
        if version:
            chosen = version
        elif entry.has_draft():
            chosen = 'draft'
        else:
            chosen = entry.pinned
    else:
        raise RegistryError(f'unknown mode: {mode!r}')

    vfile = entry.version_file(chosen)
    if not vfile.is_file():
        raise RegistryError(f'{name}: version {chosen!r} not found at {vfile}')
    return ResolvedSkill(
        name=name, kind=entry.kind, version=chosen,
        body=vfile.read_text(), manifest=entry.manifest, path=entry.path,
    )
