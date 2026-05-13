import re
from pathlib import Path


def slugify(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')


def match_folder(date: str, company: str, role: str, apps_dir: Path) -> str | None:
    if not apps_dir.exists():
        return None

    # Normalize company: strip agency suffixes like "(via Jobot)", "(agency)"
    company_clean = re.sub(r'\s*\(.*?\)', '', company).strip()
    company_slug = slugify(company_clean)

    role_slug = slugify(role)
    role_words = [w for w in role_slug.split('-') if len(w) > 3][:4]

    candidates = [
        d.name for d in apps_dir.iterdir()
        if d.is_dir() and not d.name.startswith('.')
    ]

    best: str | None = None
    best_score = -1

    for c in candidates:
        score = 0
        if c.startswith(date):
            score += 4
        if company_slug[:8] in c:
            score += 3
        for word in role_words:
            if word in c:
                score += 1

        if score > best_score:
            best_score = score
            best = c

    return best if best_score >= 3 else None


def parse_table(lines: list[str]) -> tuple[list[str], list[dict]]:
    headers: list[str] = []
    rows: list[dict] = []
    in_table = False

    for line in lines:
        line = line.strip()
        escaped = line.replace('\\|', '\x00')

        if escaped.startswith('|') and not in_table:
            parts = [p.strip().replace('\x00', '|') for p in escaped.strip('|').split('|')]
            headers = [h.lower().replace(' ', '_') for h in parts]
            in_table = True
        elif in_table and re.match(r'^\|[-| ]+\|$', escaped):
            continue
        elif in_table and escaped.startswith('|'):
            parts = [p.strip().replace('\x00', '|') for p in escaped.strip('|').split('|')]
            while len(parts) < len(headers):
                parts.append('')
            row = dict(zip(headers, parts[: len(headers)]))
            rows.append(row)
        elif in_table and not escaped.startswith('|'):
            break

    return headers, rows


def parse_tracker(content: str, applicant_dir: Path) -> dict:
    apps_dir = applicant_dir / 'applications'
    lines = content.split('\n')

    section_lines: dict[str, list[str]] = {}
    current: str | None = None

    for line in lines:
        m = re.match(r'^##\s+(.+)', line)
        if m:
            current = m.group(1).strip()
            section_lines[current] = []
        elif current is not None:
            section_lines[current].append(line)

    def make_active_row(row: dict, apps_dir: Path) -> dict:
        date = row.get('date', '')
        company = row.get('company', '')
        role = row.get('role', '')
        return {
            'date': date,
            'company': company,
            'role': role,
            'profile': row.get('profile', ''),
            'source': row.get('source', ''),
            'status': row.get('status', ''),
            'next_action': row.get('next_action', ''),
            'priority': row.get('priority', ''),
            'folder': match_folder(date, company, role, apps_dir),
        }

    def make_closed_row(row: dict, apps_dir: Path) -> dict:
        date = row.get('date', '')
        company = row.get('company', '')
        role = row.get('role', '')
        return {
            'date': date,
            'company': company,
            'role': role,
            'outcome': row.get('outcome', ''),
            'notes': row.get('notes', ''),
            'profile': row.get('profile', ''),
            'folder': match_folder(date, company, role, apps_dir),
        }

    active: list[dict] = []
    for key, slines in section_lines.items():
        if 'active' in key.lower():
            _, rows = parse_table(slines)
            active = [make_active_row(r, apps_dir) for r in rows]

    phase_d: list[dict] = []
    for key, slines in section_lines.items():
        if 'phase d' in key.lower() or 'sample' in key.lower():
            _, rows = parse_table(slines)
            for r in rows:
                date = r.get('date', '')
                company = r.get('company', '')
                role = r.get('role', '')
                phase_d.append({
                    'date': date,
                    'company': company,
                    'role': role,
                    'profile': r.get('profile', ''),
                    'fit': r.get('fit', ''),
                    'notes': r.get('notes', ''),
                    'folder': match_folder(date, company, role, apps_dir),
                })

    closed: list[dict] = []
    for key, slines in section_lines.items():
        if 'closed' in key.lower() or 'rejected' in key.lower():
            _, rows = parse_table(slines)
            closed = [make_closed_row(r, apps_dir) for r in rows]

    return {'active': active, 'phase_d': phase_d, 'closed': closed}
