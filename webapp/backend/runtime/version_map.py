"""Build/load/write name -> version snapshots of a skill/policy/workflow registry.

The DEFAULT map is always computed live from a loaded Registry (never a
committed static file) so it can't itself go stale after a promotion. A
generated/committed map file is only for the opt-in "freeze or override a
specific combination" use case (see load_version_map / merge_version_map).
"""

from pathlib import Path
import argparse
import json

from .registry import Registry, load_registry

VersionMap = dict[str, str]


def build_version_map(reg: Registry, mode: str = 'pinned') -> VersionMap:
    """Snapshot every entry's pinned or latest version, keyed by name."""
    if mode not in ('pinned', 'latest'):
        raise ValueError(f"mode must be 'pinned' or 'latest', got {mode!r}")
    return {
        name: (entry.pinned if mode == 'pinned' else entry.latest)
        for name, entry in reg.entries.items()
    }


def load_version_map(path: Path | str) -> VersionMap:
    """Read a previously-written version map JSON file."""
    data = json.loads(Path(path).read_text())
    if not isinstance(data, dict) or not all(isinstance(v, str) for v in data.values()):
        raise ValueError(f'{path}: expected a flat {{name: version}} JSON object')
    return data


def write_version_map(vmap: VersionMap, path: Path | str) -> None:
    """Write a version map as sorted, human-diffable JSON."""
    Path(path).write_text(json.dumps(vmap, indent=2, sort_keys=True) + '\n')


def merge_version_map(default: VersionMap, override: VersionMap) -> VersionMap:
    """Overlay override entries on top of default; unknown override keys pass through."""
    return {**default, **override}


def _main() -> None:
    import os

    ap = argparse.ArgumentParser(
        description='Snapshot the skill/policy/workflow registry to a version map JSON file.'
    )
    ap.add_argument('--app-dir', type=Path, default=None, help='repo root (default: $APP_DIR)')
    ap.add_argument('--mode', choices=('pinned', 'latest'), default='pinned')
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()

    root = args.app_dir or Path(os.environ['APP_DIR'])
    reg = load_registry(root)
    vmap = build_version_map(reg, mode=args.mode)
    write_version_map(vmap, args.out)
    print(f'wrote {len(vmap)} entries ({args.mode}) to {args.out}')


if __name__ == '__main__':
    _main()
