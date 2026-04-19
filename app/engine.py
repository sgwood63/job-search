"""
engine.py — context loading, API calls, and file operations for the Job Search Assistant.
"""

import base64
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional

import anthropic
import yaml
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# ─── Config ──────────────────────────────────────────────────────────────────


def load_config() -> dict:
    config_path = Path(__file__).parent / "config.yaml"
    with open(config_path) as f:
        return yaml.safe_load(f)


def get_app_root() -> Path:
    """The $SOURCE_DIRECTORY/ repo root (app source tree, git-tracked)."""
    return (Path(__file__).parent.parent).resolve()


def get_applicant_dir() -> Path:
    """
    APPLICANT_DIR env var — where applicant data lives (not git-tracked).
    Raises RuntimeError if not set or does not exist.
    """
    d = os.environ.get("APPLICANT_DIR", "").strip()
    if not d:
        raise RuntimeError(
            "APPLICANT_DIR is not set.\n"
            "Add it to app/.env:\n"
            "  APPLICANT_DIR=/path/to/your/applicant/data\n"
            "See app/.env.example for reference."
        )
    p = Path(d).resolve()
    if not p.exists():
        raise RuntimeError(
            f"APPLICANT_DIR does not exist: {p}\n"
            "Create the directory and populate it per QUICK-START.md."
        )
    return p


# Backward-compat shim — callers that haven't been updated use this
def get_data_root() -> Path:
    return get_applicant_dir()


# ─── Process definitions ─────────────────────────────────────────────────────


def load_process(name: str) -> dict:
    process_path = Path(__file__).parent / "processes" / f"{name}.yaml"
    with open(process_path) as f:
        return yaml.safe_load(f)


def list_processes() -> list[dict]:
    process_dir = Path(__file__).parent / "processes"
    order = [
        "screen-jd",
        "generate-resume",
        "review-resume",
        "interview-prep",
        "practical-exam",
        "debrief",
        "update-memory",
    ]
    processes = []
    for name in order:
        p = process_dir / f"{name}.yaml"
        if p.exists():
            try:
                processes.append(load_process(p.stem))
            except Exception:
                pass
    # Append any extras not in the ordered list
    for p in sorted(process_dir.glob("*.yaml")):
        if p.stem not in order:
            try:
                processes.append(load_process(p.stem))
            except Exception:
                pass
    return processes


# ─── Applications ────────────────────────────────────────────────────────────


def list_applications() -> list[str]:
    apps_dir = get_applicant_dir() / "applications"
    if not apps_dir.exists():
        return []
    return sorted(
        [d.name for d in apps_dir.iterdir() if d.is_dir()],
        reverse=True,
    )


def get_app_dir(application: str) -> Path:
    return get_applicant_dir() / "applications" / application


def slugify(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s[:30].strip("-")


def create_application_folder(
    company: str, role: str, date: Optional[str] = None
) -> tuple[Path, Optional[Path]]:
    config = load_config()
    applicant_dir = get_applicant_dir()

    if not date:
        date = datetime.now().strftime(config["application"]["date_format"])

    folder_name = f"{date}-{slugify(company)}-{slugify(role)}"
    local_path = applicant_dir / "applications" / folder_name
    local_path.mkdir(parents=True, exist_ok=True)

    gdrive_path: Optional[Path] = None
    try:
        gdrive_root = config["applicant"]["gdrive_root"]
        gdrive_folder = Path(gdrive_root) / "applications" / folder_name
        gdrive_folder.mkdir(parents=True, exist_ok=True)
        gdrive_path = gdrive_folder
    except Exception:
        pass

    return local_path, gdrive_path


def create_temp_folder() -> Path:
    """Create a temporary staging folder for a new JD session (_temp-YYYYMMDD-HHMMSS)."""
    applicant_dir = get_applicant_dir()
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    temp_path = applicant_dir / "applications" / f"_temp-{ts}"
    temp_path.mkdir(parents=True, exist_ok=True)
    return temp_path


def promote_temp_folder(
    temp_path: Path,
    final_path: Path,
    gdrive_path: Optional[Path] = None,
) -> None:
    """Move all files from the temp staging folder into the final application folder."""
    final_path.mkdir(parents=True, exist_ok=True)
    for src in sorted(temp_path.iterdir()):
        if src.is_file():
            shutil.copy2(src, final_path / src.name)
            if gdrive_path:
                try:
                    gdrive_path.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, gdrive_path / src.name)
                except Exception:
                    pass
    shutil.rmtree(temp_path, ignore_errors=True)


def cleanup_temp_folder(temp_path: Path) -> None:
    """Delete a temp staging folder if it still exists."""
    if temp_path and temp_path.exists() and temp_path.name.startswith("_temp-"):
        shutil.rmtree(temp_path, ignore_errors=True)


def load_temp_file_blocks(temp_path: Path) -> list[dict]:
    """Return Anthropic content blocks for all files in the temp staging folder."""
    if not temp_path or not temp_path.exists():
        return []
    blocks: list[dict] = []
    for fpath in sorted(temp_path.iterdir()):
        if not fpath.is_file():
            continue
        suffix = fpath.suffix.lower()
        header = {"type": "text", "text": f"=== {fpath.name} ==="}
        if suffix == ".pdf" or suffix in _IMAGE_TYPES:
            block = file_to_content_block(fpath)
            if block:
                blocks.append(header)
                blocks.append(block)
        else:
            text = extract_text(fpath)
            if text:
                blocks.append(header)
                blocks.append({"type": "text", "text": text})
    return blocks


# ─── Context assembly ─────────────────────────────────────────────────────────


def _resolve_context_path(raw_path: str) -> tuple[Path, str]:
    """
    Resolve a base_context path string to (full_path, display_label).

    Prefix convention:
      app:PATH        → resolved relative to get_app_root()
      applicant:PATH  → resolved relative to get_applicant_dir()
      (no prefix)     → legacy; treated as applicant:
    """
    if raw_path.startswith("app:"):
        rel = raw_path[4:]
        return get_app_root() / rel, rel
    elif raw_path.startswith("applicant:"):
        rel = raw_path[10:]
        return get_applicant_dir() / rel, rel
    else:
        # Legacy: resolve against applicant dir
        return get_applicant_dir() / raw_path, raw_path


def extract_text(path: Path) -> Optional[str]:
    """Extract plain text from PDF, DOCX, MD, TXT, or HTML files. Returns None on failure."""
    suffix = path.suffix.lower()
    try:
        if suffix in (".md", ".txt"):
            return path.read_text(encoding="utf-8")
        if suffix in (".html", ".htm"):
            from html.parser import HTMLParser

            class _Stripper(HTMLParser):
                def __init__(self) -> None:
                    super().__init__()
                    self.reset()
                    self._skip = False
                    self.fed: list[str] = []

                def handle_starttag(self, tag: str, attrs: object) -> None:
                    if tag.lower() in ("script", "style", "noscript"):
                        self._skip = True

                def handle_endtag(self, tag: str) -> None:
                    if tag.lower() in ("script", "style", "noscript"):
                        self._skip = False

                def handle_data(self, d: str) -> None:
                    if not self._skip:
                        self.fed.append(d)

            s = _Stripper()
            s.feed(path.read_text(encoding="utf-8", errors="replace"))
            text = "".join(s.fed).strip()
            return text or None
        if suffix == ".pdf":
            result = subprocess.run(
                ["pdftotext", "-layout", str(path), "-"],
                capture_output=True, text=True,
            )
            text = result.stdout.strip()
            if not text:
                # Fallback: try without -layout
                result = subprocess.run(
                    ["pdftotext", str(path), "-"],
                    capture_output=True, text=True,
                )
                text = result.stdout.strip()
            return text if text else None
        if suffix in (".docx", ".doc"):
            import docx  # python-docx
            doc = docx.Document(str(path))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception:
        pass
    return None


def fetch_url_text(url: str) -> Optional[str]:
    """Fetch a URL and return its stripped text content. Returns None on failure."""
    import urllib.request
    from html.parser import HTMLParser

    class _Stripper(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.reset()
            self._skip = False
            self.fed: list[str] = []

        def handle_starttag(self, tag: str, attrs: object) -> None:
            if tag.lower() in ("script", "style", "noscript"):
                self._skip = True

        def handle_endtag(self, tag: str) -> None:
            if tag.lower() in ("script", "style", "noscript"):
                self._skip = False

        def handle_data(self, d: str) -> None:
            if not self._skip:
                self.fed.append(d)

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read().decode("utf-8", errors="replace")
        if "html" in content_type:
            s = _Stripper()
            s.feed(raw)
            text = "".join(s.fed).strip()
            return text or None
        return raw.strip() or None
    except Exception:
        return None


_IMAGE_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def file_to_content_block(path: Path) -> Optional[dict]:
    """Return an Anthropic API content block for a PDF or image file, or None."""
    suffix = path.suffix.lower()
    try:
        data = base64.standard_b64encode(path.read_bytes()).decode("utf-8")
        if suffix == ".pdf":
            return {
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": data},
                "title": path.name,
            }
        if suffix in _IMAGE_TYPES:
            return {
                "type": "image",
                "source": {"type": "base64", "media_type": _IMAGE_TYPES[suffix], "data": data},
            }
    except Exception:
        pass
    return None


def load_app_file_blocks(app_dir: Path) -> list[dict]:
    """Return a flat list of Anthropic content blocks for all PDFs and images in the app folder."""
    if not app_dir.exists():
        return []

    blocks: list[dict] = []
    for fpath in sorted(app_dir.iterdir()):
        if not fpath.is_file():
            continue
        suffix = fpath.suffix.lower()
        if suffix not in {".pdf"} | set(_IMAGE_TYPES):
            continue
        block = file_to_content_block(fpath)
        if block:
            blocks.append({"type": "text", "text": f"=== {fpath.name} ==="})
            blocks.append(block)

    return blocks


def read_file_safe(path: Path, label: str) -> Optional[str]:
    """Read a file and return its content with a section header, or None if missing."""
    if path.exists():
        return f"=== {label} ===\n{path.read_text(encoding='utf-8')}"
    return None


def assemble_context(
    process: dict,
    application: Optional[str] = None,
    extra_context_paths: Optional[list[str]] = None,
) -> str:
    applicant_dir = get_applicant_dir()
    parts: list[str] = []

    # Base context files (always loaded)
    for raw_path in process.get("base_context", []):
        full, label = _resolve_context_path(raw_path)
        chunk = read_file_safe(full, label)
        if chunk:
            parts.append(chunk)

    # User-selected optional context files
    for raw_path in extra_context_paths or []:
        full, label = _resolve_context_path(raw_path)
        chunk = read_file_safe(full, label)
        if chunk:
            parts.append(chunk)

    # Application-specific files
    if application:
        app_dir = applicant_dir / "applications" / application

        # Fixed files first (deterministic order)
        for fname in ["job-description.md", "notes.md"]:
            chunk = read_file_safe(app_dir / fname, f"applications/{application}/{fname}")
            if chunk:
                parts.append(chunk)

        # Resume drafts (any Sherman_Wood_*.md)
        for fpath in sorted(app_dir.glob("Sherman_Wood_*.md")):
            chunk = read_file_safe(fpath, f"applications/{application}/{fpath.name}")
            if chunk:
                parts.append(chunk)

        # All other uploaded text-based files not already loaded above.
        already_loaded = {
            "job-description.md", "notes.md",
        } | {p.name for p in app_dir.glob("Sherman_Wood_*.md")}

        text_only = {".docx", ".doc", ".md", ".txt"}
        for fpath in sorted(app_dir.iterdir()):
            if (
                fpath.is_file()
                and fpath.name not in already_loaded
                and fpath.suffix.lower() in text_only
            ):
                text = extract_text(fpath)
                if text:
                    label = f"applications/{application}/{fpath.name}"
                    parts.append(f"=== {label} ===\n{text}")

    return "\n\n".join(parts)


def build_system_prompt(process: dict, context: str) -> str:
    guidance = (process.get("guidance") or "").strip()
    system = (process.get("system_prompt") or "").strip()

    parts: list[str] = []

    # Prepend accumulated guidance if it has content beyond the placeholder header
    if guidance and guidance not in ("", "# Accumulated Guidance"):
        parts.append(f"## Accumulated Process Guidance\n\n{guidance}")

    parts.append(system)

    if context:
        parts.append(f"## Loaded Context Files\n\n{context}")

    return "\n\n---\n\n".join(parts)


# ─── API ─────────────────────────────────────────────────────────────────────


def call_api(
    system_prompt: str,
    messages: list[dict],
    model: str,
    temperature: float,
    max_tokens: int = 8192,
    file_blocks: Optional[list[dict]] = None,
) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set. Add it to app/.env")

    client = anthropic.Anthropic(api_key=api_key)

    # If binary files (PDFs, images) were uploaded, prepend a synthetic user/assistant
    # exchange so the model has full native access to the file content.
    api_messages = messages
    if file_blocks:
        n = sum(1 for b in file_blocks if b["type"] != "text")
        file_user: dict = {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"The following {n} file(s) have been uploaded for this application. "
                        "Read and retain them — I will refer to them in my questions."
                    ),
                },
                *file_blocks,
            ],
        }
        file_ack: dict = {
            "role": "assistant",
            "content": f"I've read all {n} uploaded file(s) and am ready to help.",
        }
        api_messages = [file_user, file_ack, *messages]

    # Use prompt caching on the (large) system prompt to reduce cost
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=api_messages,
        temperature=temperature,
    )
    return response.content[0].text


# ─── File operations ─────────────────────────────────────────────────────────


def save_file(
    folder: Path,
    filename: str,
    content: str,
    gdrive_folder: Optional[Path] = None,
) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    file_path = folder / filename
    file_path.write_text(content, encoding="utf-8")

    if gdrive_folder:
        try:
            gdrive_folder.mkdir(parents=True, exist_ok=True)
            (gdrive_folder / filename).write_text(content, encoding="utf-8")
        except Exception:
            pass

    return file_path


def append_to_file(file_path: Path, content: str) -> None:
    existing = file_path.read_text(encoding="utf-8") if file_path.exists() else ""
    separator = "\n\n" if existing.strip() else ""
    file_path.write_text(existing + separator + content, encoding="utf-8")


def generate_pdf(md_path: Path) -> tuple[bool, str]:
    config = load_config()
    # CSS lives in the app source tree, not APPLICANT_DIR
    css_path = get_app_root() / "templates" / "resume.css"
    pdf_path = md_path.with_suffix(".pdf")

    cmd = config["pdf"]["pandoc_cmd"].format(
        input=str(md_path),
        output=str(pdf_path),
        css=str(css_path),
    )
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode == 0:
        return True, str(pdf_path)
    return False, (result.stderr or result.stdout or "Unknown error").strip()


def sync_to_gdrive(local_path: Path) -> tuple[bool, str]:
    config = load_config()
    applicant_dir = get_applicant_dir()
    gdrive_root = Path(config["applicant"]["gdrive_root"])

    try:
        rel = local_path.relative_to(applicant_dir)
        gdrive_dest = gdrive_root / rel
        if local_path.is_file():
            gdrive_dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(local_path, gdrive_dest)
        elif local_path.is_dir():
            shutil.copytree(str(local_path), str(gdrive_dest), dirs_exist_ok=True)
        return True, str(gdrive_dest)
    except Exception as e:
        return False, str(e)


def save_uploaded_file(
    app_path: Path,
    filename: str,
    content: bytes,
    gdrive_path: Optional[Path] = None,
) -> Path:
    """Write an uploaded file's bytes to the application folder (and GDrive if set)."""
    app_path.mkdir(parents=True, exist_ok=True)
    dest = app_path / filename
    dest.write_bytes(content)
    if gdrive_path:
        try:
            gdrive_path.mkdir(parents=True, exist_ok=True)
            (gdrive_path / filename).write_bytes(content)
        except Exception:
            pass
    return dest


def list_uploaded_files(app_path: Path) -> list[Path]:
    """Return all non-generated files in the application folder, newest first."""
    if not app_path.exists():
        return []
    return sorted(
        [f for f in app_path.iterdir() if f.is_file()],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )


def find_resume_md(app_local_path: Path) -> Optional[Path]:
    """Return the most recently modified Sherman_Wood_*.md in the app folder."""
    candidates = sorted(
        app_local_path.glob("Sherman_Wood_*.md"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


# ─── Process guidance persistence ────────────────────────────────────────────


def save_guidance(process_name: str, new_guidance: str) -> bool:
    process_path = Path(__file__).parent / "processes" / f"{process_name}.yaml"
    if not process_path.exists():
        return False

    content = process_path.read_text(encoding="utf-8")
    new_guidance = new_guidance.strip()
    indented = "\n".join(f"  {line}" for line in new_guidance.split("\n"))

    if "guidance: |" in content:
        idx = content.find("guidance: |")
        insert_pos = content.find("\n", idx) + 1
        content = content[:insert_pos] + indented + "\n" + content[insert_pos:]
    else:
        content += f"\nguidance: |\n{indented}\n"

    process_path.write_text(content, encoding="utf-8")
    return True


# ─── Content extraction helpers ──────────────────────────────────────────────


def extract_fenced_block(text: str, lang: str = "markdown") -> Optional[str]:
    """Return the first fenced code block matching the given language hint."""
    pattern = rf"```{re.escape(lang)}\n(.*?)```"
    m = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()
    m = re.search(r"```(?:\w*)\n(.*?)```", text, re.DOTALL)
    if m:
        return m.group(1).strip()
    return None


def extract_json_block(text: str) -> Optional[str]:
    """Return the first JSON fenced block."""
    m = re.search(r"```json\n(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return None


def detect_guidance_in_message(text: str) -> bool:
    """Return True if the message looks like corrective or confirmatory guidance."""
    triggers = [
        r"\bdon'?t\b", r"\bdo not\b", r"\bnever\b", r"\bstop\b",
        r"\balways\b", r"\bremember\b", r"\bmake sure\b",
        r"\bkeep doing\b", r"\byes[,\s]+exactly\b", r"\bperfect\b",
    ]
    lower = text.lower()
    return any(re.search(p, lower) for p in triggers)


def extract_jd_sections(messages: list[dict]) -> dict[str, str]:
    """
    Scan all assistant messages (newest first) for screen-jd output sections.
    Returns dict: folder_name, jd_content, notes, tracker_row (each "" if not found).
    """
    result = {"folder_name": "", "jd_content": "", "notes": "", "tracker_row": ""}
    needed = set(result.keys())

    for msg in reversed(messages):
        if msg["role"] != "assistant" or not needed:
            continue
        text = msg["content"]

        if "folder_name" in needed:
            m = re.search(r"\*\*FOLDER NAME:\*\*\s*`?([^`\n]+)`?", text, re.IGNORECASE)
            if m:
                result["folder_name"] = m.group(1).strip()
                needed.discard("folder_name")

        if "tracker_row" in needed:
            m = re.search(
                r"\*\*TRACKER ROW\*\*[^\n]*\n+([^\n]*\|[^\n]+)", text, re.IGNORECASE
            )
            if m:
                result["tracker_row"] = m.group(1).strip()
                needed.discard("tracker_row")

        if "jd_content" in needed:
            m = re.search(
                r"\*\*JD CONTENT\*\*[^\n]*\n+(.*?)(?=\n\*\*NOTES\*\*|\n\*\*TRACKER|\Z)",
                text, re.DOTALL | re.IGNORECASE,
            )
            if m:
                result["jd_content"] = m.group(1).strip()
                needed.discard("jd_content")

        if "notes" in needed:
            m = re.search(
                r"\*\*NOTES\*\*[^\n]*\n+(.*?)(?=\n\*\*TRACKER ROW\*\*|\Z)",
                text, re.DOTALL | re.IGNORECASE,
            )
            if m:
                raw = m.group(1).strip()
                fence = re.search(r"```(?:markdown)?\n(.*?)```", raw, re.DOTALL)
                result["notes"] = fence.group(1).strip() if fence else raw
                needed.discard("notes")

        if not needed:
            break

    return result


# ─── Default browser detection (cross-platform) ──────────────────────────────


def _detect_default_browser_macos() -> dict:
    """
    Detect the macOS default HTTPS browser.
    Returns dict: executable_path, user_data_dir, channel (or None).
    Raises RuntimeError if the browser or its profile cannot be found.
    """
    # ── Step 1: get bundle ID from LaunchServices ─────────────────────────────
    try:
        out = subprocess.run(
            [
                "defaults", "read",
                "com.apple.LaunchServices/com.apple.launchservices.secure",
                "LSHandlers",
            ],
            capture_output=True, text=True, timeout=5,
        ).stdout
        # LSHandlerRoleAll appears immediately before LSHandlerURLScheme at the
        # same indentation level. Backreference \1 skips the deeper-indented
        # LSHandlerPreferredVersions entry (which always holds sentinel "-").
        m = re.search(
            r'^( +)LSHandlerRoleAll = "([^"]+)"\s*;\s*\n\1LSHandlerURLScheme = https',
            out, re.MULTILINE,
        )
        bundle_id = m.group(2).lower() if (m and m.group(2) != "-") else ""
    except Exception:
        bundle_id = ""

    if not bundle_id:
        raise RuntimeError("Could not determine default browser bundle ID from LaunchServices.")

    # ── Step 2: find the .app executable via mdfind + Info.plist ─────────────
    exe_path: Optional[str] = None
    try:
        found = subprocess.run(
            ["mdfind", f'kMDItemCFBundleIdentifier == "{bundle_id}"'],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip().split("\n")
        # Prefer /Applications/ paths
        found.sort(key=lambda p: (0 if p.startswith("/Applications/") else 1))
        for app in found:
            app = app.strip()
            if not app.endswith(".app"):
                continue
            plist = Path(app) / "Contents" / "Info.plist"
            if not plist.exists():
                continue
            r = subprocess.run(
                ["plutil", "-extract", "CFBundleExecutable", "raw", str(plist)],
                capture_output=True, text=True, timeout=5,
            )
            exe_name = r.stdout.strip()
            if exe_name:
                exe = Path(app) / "Contents" / "MacOS" / exe_name
                if exe.exists():
                    exe_path = str(exe)
                    break
    except Exception:
        pass

    if not exe_path:
        raise RuntimeError(
            f"Could not find executable for default browser '{bundle_id}'. "
            "Is the application installed in /Applications/?"
        )

    # ── Step 3: find Chromium user data dir ───────────────────────────────────
    home = Path.home()
    support = home / "Library" / "Application Support"

    # Known paths for browsers that don't store data under their bundle ID dir
    KNOWN_PROFILES = {
        "com.google.chrome": support / "Google" / "Chrome",
        "com.microsoft.edgemac": support / "Microsoft Edge",
        "com.brave.browser": support / "BraveSoftware" / "Brave-Browser",
        "com.vivaldi.vivaldi": support / "Vivaldi",
        "com.operasoftware.opera": support / "com.operasoftware.Opera",
    }

    user_data: Optional[Path] = None
    if bundle_id in KNOWN_PROFILES:
        p = KNOWN_PROFILES[bundle_id]
        if (p / "Default" / "Preferences").exists():
            user_data = p

    if not user_data:
        # Discovery: search under bundle-ID-named dirs and Containers
        search_roots = [
            support / bundle_id,
            home / "Library" / "Containers" / bundle_id / "Data" / "Library" / "Application Support",
        ]
        for root in search_roots:
            if not root.exists():
                continue
            for prefs in sorted(root.rglob("Default/Preferences")):
                if prefs.is_file():
                    user_data = prefs.parent.parent  # grandparent = user data dir
                    break
            if user_data:
                break

    if not user_data:
        raise RuntimeError(
            f"Could not find a Chromium profile for '{bundle_id}'. "
            "The browser may not be Chromium-based, or its profile is in an unexpected location."
        )

    # Only Chrome and Edge have named Playwright channels; others use executable_path
    channel = {"com.google.chrome": "chrome", "com.microsoft.edgemac": "msedge"}.get(bundle_id)

    return {
        "executable_path": exe_path if not channel else None,
        "user_data_dir": str(user_data),
        "channel": channel,
    }


def _detect_default_browser_windows() -> dict:
    """
    Detect the Windows default HTTPS browser via the registry.
    Returns dict: executable_path (or None), user_data_dir, channel (or None).
    """
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice",
        )
        prog_id: str = winreg.QueryValueEx(key, "ProgId")[0]
        winreg.CloseKey(key)
    except Exception:
        raise RuntimeError("Could not read default browser from the Windows registry.")

    home = Path.home()
    prog_lower = prog_id.lower()

    WINDOWS_BROWSERS: dict[str, dict] = {
        "chromehtml": {
            "channel": "chrome",
            "user_data_dir": str(home / "AppData/Local/Google/Chrome/User Data"),
        },
        "msedgehtm": {
            "channel": "msedge",
            "user_data_dir": str(home / "AppData/Local/Microsoft/Edge/User Data"),
        },
        "bravehtml": {
            "executable_path": str(Path("C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe")),
            "user_data_dir": str(home / "AppData/Local/BraveSoftware/Brave-Browser/User Data"),
        },
        "chromiumhtm": {
            "user_data_dir": str(home / "AppData/Local/Chromium/User Data"),
        },
    }

    cfg: Optional[dict] = None
    for key_prefix, val in WINDOWS_BROWSERS.items():
        if prog_lower.startswith(key_prefix):
            cfg = dict(val)
            break

    if not cfg:
        raise RuntimeError(
            f"Default browser ProgId '{prog_id}' is not a supported Chromium-based browser. "
            "Set your default browser to Chrome, Edge, or Brave."
        )
    if not Path(cfg["user_data_dir"]).exists():
        raise RuntimeError(
            f"Browser profile not found at {cfg['user_data_dir']}. Is the browser installed?"
        )
    cfg.setdefault("channel", None)
    cfg.setdefault("executable_path", None)
    return cfg


def _detect_default_browser_linux() -> dict:
    """
    Detect the Linux default HTTPS browser via xdg-settings.
    Returns dict: executable_path (or None), user_data_dir, channel (or None).
    """
    try:
        desktop = subprocess.run(
            ["xdg-settings", "get", "default-web-browser"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip().lower()
    except Exception:
        desktop = ""

    home = Path.home()
    LINUX_BROWSERS: dict[str, dict] = {
        "google-chrome": {
            "channel": "chrome",
            "user_data_dir": str(home / ".config/google-chrome"),
        },
        "chromium": {
            "user_data_dir": str(home / ".config/chromium"),
        },
        "brave-browser": {
            "executable_path": "/usr/bin/brave-browser",
            "user_data_dir": str(home / ".config/BraveSoftware/Brave-Browser"),
        },
        "microsoft-edge": {
            "channel": "msedge",
            "user_data_dir": str(home / ".config/microsoft-edge"),
        },
    }

    cfg: Optional[dict] = None
    for key, val in LINUX_BROWSERS.items():
        if key in desktop:
            cfg = dict(val)
            break

    if not cfg:
        raise RuntimeError(
            f"Default browser '{desktop}' is not a supported Chromium-based browser. "
            "Set your default browser to Chrome, Chromium, Brave, or Edge."
        )
    if not Path(cfg["user_data_dir"]).exists():
        raise RuntimeError(f"Browser profile not found at {cfg['user_data_dir']}.")
    cfg.setdefault("channel", None)
    cfg.setdefault("executable_path", None)
    return cfg


def _detect_default_browser() -> dict:
    """
    Detect the system's default Chromium-based browser across macOS, Windows, and Linux.
    Returns dict with: executable_path, user_data_dir, channel (any may be None).
    Raises RuntimeError with a clear message if detection or profile lookup fails.
    """
    import platform as _plat
    system = _plat.system()
    if system == "Darwin":
        return _detect_default_browser_macos()
    if system == "Windows":
        return _detect_default_browser_windows()
    return _detect_default_browser_linux()


def _expand_page_content(page) -> None:
    """Click 'show more' / expand buttons and scroll to reveal full page content."""
    EXPAND_SELECTORS = [
        "button.show-more-less-html__button",   # LinkedIn job description
        "button:has-text('See more')",
        "button:has-text('Show more')",
        "button:has-text('Read more')",
        "button:has-text('View more')",
        "button:has-text('Load more')",
        "button:has-text('Expand')",
        "[aria-label*='see more' i]",
        "[aria-label*='show more' i]",
        "[data-testid*='show-more']",
        ".show-more-button",
        ".see-more-link",
    ]
    for selector in EXPAND_SELECTORS:
        try:
            for btn in page.query_selector_all(selector):
                if btn.is_visible():
                    btn.click()
                    page.wait_for_timeout(400)
        except Exception:
            pass
    # Scroll to bottom to trigger lazy loading, then back to top for PDF capture
    try:
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(800)
        page.wait_for_load_state("networkidle", timeout=5000)
        page.evaluate("window.scrollTo(0, 0)")
    except Exception:
        pass


def _get_playwright_profile_dir() -> Path:
    """
    Return a dedicated Playwright profile directory that is separate from the
    user's live browser profile (which would be locked if the browser is open).
    Created on first use; session data persists across fetches.
    """
    profile_dir = Path.home() / ".job-search-assistant" / "playwright-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    return profile_dir


def fetch_url_browser(url: str, temp_path: Path, filename_stem: str = "jd-from-url") -> tuple[str, Path]:
    """
    Fetch a URL using the system's default browser executable — no fallback.
    Uses a dedicated Playwright profile dir (not the live browser profile, which
    would be locked if the browser is already open). On first use the user logs in
    manually; the session is reused on subsequent fetches.
    Expands 'show more' content, then saves a US Letter PDF and extracted text.
    Returns (extracted_text, pdf_path).
    Raises RuntimeError if the browser is non-Chromium or detection fails.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError(
            "playwright not installed. Run:\n"
            "  pip install playwright\n"
            "  playwright install chromium"
        )

    pdf_path = temp_path / f"{filename_stem}.pdf"

    with sync_playwright() as p:
        # Use Playwright's own bundled Chromium, headless, no persistent context.
        # launch_persistent_context acquires a user-data-dir lock that conflicts with
        # other Chromium-based apps (e.g. ChatGPT Atlas), causing them to crash.
        # A plain launch() has no shared lock and no per-user singleton.
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-gpu",           # skip GPU process (avoids IOKit conflict with Atlas)
                "--disable-crash-reporter", # skip Crashpad handler (avoids Mach port conflict)
            ],
        )
        try:
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2000)
            _expand_page_content(page)
            pdf_bytes = page.pdf(format="Letter", print_background=True)
            pdf_path.write_bytes(pdf_bytes)
            text = page.inner_text("body")
        finally:
            browser.close()

    (temp_path / f"{filename_stem}.txt").write_text(text, encoding="utf-8")
    return text, pdf_path


def stamp_update(content: str, date: str, label: str = "") -> str:
    """Prepend an update datestamp line to file content."""
    tag = f"_Updated: {date}{' — ' + label if label else ''}_\n\n"
    return tag + content


def analyze_file_implications(
    file_name: str,
    file_content: str,
    app_context: str,
    model: str = "claude-haiku-4-5-20251001",
) -> str:
    """
    Run a quick AI pass on a saved file to identify implications for the application.
    Returns the AI's proposals as a markdown string.
    """
    system = (
        "You are reviewing a recently saved job application file to identify "
        "actionable implications for the broader application.\n\n"
        "Based on the file content and application context provided, identify:\n"
        "1. Whether the application **status** should change (e.g., after interview notes → Phone Interview)\n"
        "2. A **next action** with a suggested date\n"
        "3. Any **notes** worth appending to notes.md\n\n"
        "Output ONLY these labeled sections (omit any that don't apply):\n\n"
        "**STATUS UPDATE:**\n"
        "New status: [status] — Reason: [one line]\n\n"
        "**NEXT ACTION:**\n"
        "[action] by [YYYY-MM-DD]\n\n"
        "**NOTES TO ADD:**\n"
        "[markdown content]\n\n"
        "Be concise. Do not fabricate details not in the file."
    )
    messages = [
        {
            "role": "user",
            "content": (
                f"## Saved file: {file_name}\n\n{file_content}\n\n"
                f"## Application context\n\n{app_context}"
            ),
        }
    ]
    return call_api(system, messages, model=model, temperature=0.0, max_tokens=1024)


# ─── Agentic tool use (Update Memory process) ────────────────────────────────


def make_update_tools(app_folder_name: Optional[str] = None) -> list[dict]:
    """Build the write_file tool definition, including app folder paths when active."""
    allowed_paths = [
        "memory/FILENAME.md         (app-process memory, git-tracked)",
        "applicant-memory/FILENAME.md  (applicant memory, saved to $APPLICANT_DIR/memory/)",
        "base-documents/EXPERIENCE-REFERENCE.md",
    ]
    app_note = ""
    if app_folder_name:
        allowed_paths.append(f"applications/{app_folder_name}/notes.md")
        allowed_paths.append(f"applications/{app_folder_name}/Sherman_Wood_*.md")
        app_note = (
            f" Active application: {app_folder_name}. "
            f"You may also write notes.md or the resume file for this application."
        )
    return [
        {
            "name": "write_file",
            "description": (
                "Write or update a project file. "
                f"Allowed paths: {'; '.join(allowed_paths)}."
                + app_note
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": (
                            "Path using the prefix scheme: "
                            "'memory/FILENAME.md' for app-process memory (git-tracked), "
                            "'applicant-memory/FILENAME.md' for applicant memory (not git), "
                            "'base-documents/EXPERIENCE-REFERENCE.md' for experience facts, "
                            f"or 'applications/{app_folder_name}/FILENAME.md' for app files."
                            if app_folder_name
                            else "Path relative to the appropriate root."
                        ),
                    },
                    "content": {
                        "type": "string",
                        "description": "Complete file content.",
                    },
                },
                "required": ["path", "content"],
            },
        }
    ]


# Keep alias so existing callers don't break
MEMORY_WRITE_TOOLS = make_update_tools()



def execute_project_write(
    path: str,
    content: str,
    app_local_path: Optional[Path] = None,
    app_gdrive_path: Optional[Path] = None,
) -> tuple[str, Optional[Path], Optional[str]]:
    """
    Write a project file (memory, experience reference, or application document).
    Returns (status_message, dest_path_or_None, original_content_or_None).
    original_content is the pre-existing file content before overwrite (for Revert).

    Path routing:
      memory/FILENAME.md          → get_app_root()/memory/ (git-tracked)
      applicant-memory/FILENAME.md → get_applicant_dir()/memory/ (not git)
      base-documents/EXPERIENCE-REFERENCE.md → get_applicant_dir()/base-documents/
      applications/{folder}/*.md  → get_applicant_dir()/applications/...
    """
    app_root = get_app_root()
    applicant_dir = get_applicant_dir()
    p = path.strip().lstrip("/")

    # ── App-process memory (git-tracked) ─────────────────────────────────────
    if p.startswith("memory/"):
        dest = app_root / p
        dest.parent.mkdir(parents=True, exist_ok=True)
        original = dest.read_text(encoding="utf-8") if dest.exists() else None
        dest.write_text(content, encoding="utf-8")
        return f"Written: {p} (app-process memory)", dest, original

    # ── Applicant memory (not git-tracked) ────────────────────────────────────
    if p.startswith("applicant-memory/"):
        filename = p[len("applicant-memory/"):]
        dest = applicant_dir / "memory" / filename
        dest.parent.mkdir(parents=True, exist_ok=True)
        original = dest.read_text(encoding="utf-8") if dest.exists() else None
        dest.write_text(content, encoding="utf-8")
        return f"Written: {p} (applicant memory)", dest, original

    # ── EXPERIENCE-REFERENCE.md ───────────────────────────────────────────────
    if p == "base-documents/EXPERIENCE-REFERENCE.md":
        dest = applicant_dir / p
        original = dest.read_text(encoding="utf-8") if dest.exists() else None
        dest.write_text(content, encoding="utf-8")
        return f"Written: {p}", dest, original

    # ── Application files (notes.md, resume .md) ──────────────────────────────
    if app_local_path:
        app_prefix = f"applications/{app_local_path.name}/"
        if p.startswith(app_prefix):
            filename = p[len(app_prefix):]
            if "/" not in filename and filename.endswith((".md", ".txt")):
                dest = app_local_path / filename
                original = dest.read_text(encoding="utf-8") if dest.exists() else None
                dest.write_text(content, encoding="utf-8")
                if app_gdrive_path:
                    try:
                        (app_gdrive_path / filename).write_text(content, encoding="utf-8")
                    except Exception:
                        pass
                return f"Written: {p}", dest, original

    return (
        f"BLOCKED: '{p}' is not an allowed path. "
        "Use memory/, applicant-memory/, base-documents/EXPERIENCE-REFERENCE.md, "
        f"or applications/{app_local_path.name}/ for app files."
        if app_local_path
        else f"BLOCKED: '{p}' is not an allowed path.",
        None,
        None,
    )


# Keep old name as thin wrapper for any remaining callers
def execute_memory_write(relative_path: str, content: str) -> tuple[str, Optional[Path]]:
    msg, dest, _ = execute_project_write(relative_path, content)
    return msg, dest


def call_api_agentic(
    system_prompt: str,
    messages: list[dict],
    model: str,
    temperature: float,
    max_tokens: int = 8192,
    file_blocks: Optional[list[dict]] = None,
    tools: Optional[list[dict]] = None,
    on_tool_call: Optional[callable] = None,
) -> tuple[str, list[dict]]:
    """
    API call with tool-use agentic loop.

    Continues calling the API until stop_reason is 'end_turn' (or not 'tool_use').
    Returns (final_text_response, list_of_tool_call_records).
    on_tool_call(name, input_dict) -> str: called for each tool use, returns result string.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set. Add it to app/.env")

    client = anthropic.Anthropic(api_key=api_key)

    # Build initial api_messages, optionally prepending file blocks
    api_messages: list[dict] = list(messages)
    if file_blocks:
        n = sum(1 for b in file_blocks if b.get("type") != "text")
        file_user: dict = {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"The following {n} file(s) have been uploaded. "
                        "Read and retain them."
                    ),
                },
                *file_blocks,
            ],
        }
        file_ack: dict = {
            "role": "assistant",
            "content": f"I've read all {n} uploaded file(s) and am ready to help.",
        }
        api_messages = [file_user, file_ack, *api_messages]

    call_kwargs: dict = dict(
        model=model,
        max_tokens=max_tokens,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        temperature=temperature,
    )
    if tools:
        call_kwargs["tools"] = tools

    tool_records: list[dict] = []
    final_text = ""

    while True:
        response = client.messages.create(messages=api_messages, **call_kwargs)

        # Collect any text blocks from this response turn
        text_parts = [b.text for b in response.content if b.type == "text"]
        if text_parts:
            final_text = "\n".join(text_parts)

        if response.stop_reason != "tool_use":
            break

        # Add assistant turn (may contain both text and tool_use blocks)
        assistant_content = []
        for b in response.content:
            if b.type == "text":
                assistant_content.append({"type": "text", "text": b.text})
            elif b.type == "tool_use":
                assistant_content.append(
                    {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
                )
        api_messages.append({"role": "assistant", "content": assistant_content})

        # Execute tool calls, build tool_result blocks
        result_blocks = []
        for b in response.content:
            if b.type != "tool_use":
                continue
            result = on_tool_call(b.name, b.input) if on_tool_call else f"{b.name} called"
            tool_records.append({"name": b.name, "input": b.input, "result": result})
            result_blocks.append(
                {"type": "tool_result", "tool_use_id": b.id, "content": result}
            )

        api_messages.append({"role": "user", "content": result_blocks})

    return final_text, tool_records


# ─── Tracker parsing ──────────────────────────────────────────────────────────


def parse_tracker() -> list[dict]:
    """Parse the Active Applications table from application-tracker.md."""
    applicant_dir = get_applicant_dir()
    config = load_config()
    tracker_path = applicant_dir / config["applicant"]["tracker"]
    if not tracker_path.exists():
        return []

    content = tracker_path.read_text(encoding="utf-8")
    jobs: list[dict] = []
    in_active = False
    header_done = False
    separator_done = False

    for line in content.split("\n"):
        stripped = line.strip()

        if stripped.startswith("## "):
            in_active = "Active Applications" in stripped
            header_done = False
            separator_done = False
            continue

        if not in_active or not stripped.startswith("|"):
            continue

        parts = [p.strip() for p in stripped.split("|")]
        parts = [p for p in parts if p != ""]

        if not header_done:
            header_done = True
            continue
        if not separator_done:
            separator_done = True
            continue

        if len(parts) < 5:
            continue

        date = parts[0] if len(parts) > 0 else ""
        company_raw = parts[1] if len(parts) > 1 else ""
        role = parts[2] if len(parts) > 2 else ""
        profile = parts[3] if len(parts) > 3 else ""

        if len(parts) >= 8:
            source = parts[4]
            status = parts[5]
            next_action = parts[6]
            priority = parts[7]
        elif len(parts) == 7:
            source = parts[4]
            status = parts[5]
            next_action = ""
            priority = parts[6]
        else:
            source = ""
            status = parts[4] if len(parts) > 4 else ""
            next_action = parts[5] if len(parts) > 5 else ""
            priority = parts[6] if len(parts) > 6 else ""

        recruiter = ""
        company = company_raw
        via_match = re.search(r"\((?:via|through)\s+([^)]+)\)", company_raw, re.IGNORECASE)
        if via_match:
            recruiter = via_match.group(1).strip()
            company = re.sub(r"\s*\((?:via|through)\s+[^)]+\)", "", company_raw).strip()

        jobs.append(
            {
                "date": date,
                "company": company,
                "company_raw": company_raw,
                "recruiter": recruiter,
                "role": role,
                "profile": profile,
                "source": source,
                "status": status,
                "next_action": next_action,
                "priority": priority,
            }
        )

    jobs.sort(key=lambda j: j.get("date", ""), reverse=True)
    return jobs


def find_app_folder_for_job(company: str, date: str) -> Optional[Path]:
    """Find the application folder that best matches the given company and date."""
    apps_dir = get_applicant_dir() / "applications"
    if not apps_dir.exists():
        return None

    company_slug = slugify(company)
    date_prefix = date[:10] if len(date) >= 10 and date[4] == "-" else ""

    # Pass 1: exact company slug + date prefix
    for d in sorted(apps_dir.iterdir(), reverse=True):
        if not d.is_dir():
            continue
        name = d.name
        if date_prefix and name.startswith(date_prefix) and company_slug in name:
            return d

    # Pass 2: exact company slug, any date
    candidates = [
        d for d in apps_dir.iterdir()
        if d.is_dir() and company_slug in d.name
    ]
    if len(candidates) == 1:
        return candidates[0]

    # Pass 3: first word of company slug + date prefix
    # Handles "Temporal Technologies" → folder slug "temporal-..." (created with short name)
    first_word_slug = slugify(company.split()[0]) if company.split() else company_slug
    if date_prefix and first_word_slug != company_slug:
        date_candidates = [
            d for d in apps_dir.iterdir()
            if d.is_dir() and d.name.startswith(date_prefix) and first_word_slug in d.name
        ]
        if len(date_candidates) == 1:
            return date_candidates[0]

    return None


def list_app_files_recursive(app_dir: Path) -> list[dict]:
    """Return a flat tree of files/folders under app_dir as list of dicts."""
    if not app_dir.exists():
        return []

    result: list[dict] = []

    def _recurse(path: Path, depth: int, rel_prefix: str) -> None:
        try:
            items = sorted(
                path.iterdir(),
                key=lambda p: (p.is_file(), p.name.lower()),
            )
        except PermissionError:
            return
        for item in items:
            rel_path = f"{rel_prefix}{item.name}"
            if item.is_dir():
                result.append(
                    {
                        "name": item.name,
                        "rel_path": rel_path,
                        "is_dir": True,
                        "depth": depth,
                        "full_path": item,
                    }
                )
                _recurse(item, depth + 1, rel_path + "/")
            else:
                result.append(
                    {
                        "name": item.name,
                        "rel_path": rel_path,
                        "is_dir": False,
                        "depth": depth,
                        "full_path": item,
                        "suffix": item.suffix.lower(),
                    }
                )

    _recurse(app_dir, 0, "")
    return result
