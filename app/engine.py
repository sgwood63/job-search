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


def get_data_root() -> Path:
    config = load_config()
    return (Path(__file__).parent / config["paths"]["data_root"]).resolve()


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
    apps_dir = get_data_root() / "applications"
    if not apps_dir.exists():
        return []
    return sorted(
        [d.name for d in apps_dir.iterdir() if d.is_dir()],
        reverse=True,
    )


def get_app_dir(application: str) -> Path:
    return get_data_root() / "applications" / application


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
    data_root = get_data_root()

    if not date:
        date = datetime.now().strftime(config["application"]["date_format"])

    folder_name = f"{date}-{slugify(company)}-{slugify(role)}"
    local_path = data_root / "applications" / folder_name
    local_path.mkdir(parents=True, exist_ok=True)

    gdrive_path: Optional[Path] = None
    try:
        gdrive_root = config["paths"]["gdrive_root"]
        gdrive_folder = Path(gdrive_root) / "applications" / folder_name
        gdrive_folder.mkdir(parents=True, exist_ok=True)
        gdrive_path = gdrive_folder
    except Exception:
        pass

    return local_path, gdrive_path


# ─── Context assembly ─────────────────────────────────────────────────────────


def extract_text(path: Path) -> Optional[str]:
    """Extract plain text from PDF, DOCX, MD, or TXT files. Returns None on failure."""
    suffix = path.suffix.lower()
    try:
        if suffix in (".md", ".txt"):
            return path.read_text(encoding="utf-8")
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
    """Return a flat list of Anthropic content blocks for all PDFs and images in the app folder.

    Each file is preceded by a text label so the model knows the filename.
    Returns an empty list if no supported binary files are present.
    """
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
    data_root = get_data_root()
    parts: list[str] = []

    # Base context files (always loaded)
    for rel_path in process.get("base_context", []):
        chunk = read_file_safe(data_root / rel_path, rel_path)
        if chunk:
            parts.append(chunk)

    # User-selected optional context files
    for rel_path in extra_context_paths or []:
        chunk = read_file_safe(data_root / rel_path, rel_path)
        if chunk:
            parts.append(chunk)

    # Application-specific files
    if application:
        app_dir = data_root / "applications" / application

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

        # All other uploaded text-based files (.docx, .doc, .md, .txt) not already loaded above.
        # PDFs and images are handled as native content blocks (see load_app_file_blocks),
        # so they are excluded here to avoid sending the same content twice.
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
    # exchange so the model has full native access to the file content.  This exchange
    # is not shown in the chat UI — it exists only in the API call.
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
    data_root = get_data_root()
    css_path = data_root / config["paths"]["resume_css"]
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
    data_root = get_data_root()
    gdrive_root = Path(config["paths"]["gdrive_root"])

    try:
        rel = local_path.relative_to(data_root)
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
    # Try exact language match first
    pattern = rf"```{re.escape(lang)}\n(.*?)```"
    m = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # Fallback: any fenced block
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


# ─── Agentic tool use (Update Memory process) ────────────────────────────────


def make_update_tools(app_folder_name: Optional[str] = None) -> list[dict]:
    """Build the write_file tool definition, including app folder paths when active."""
    allowed_paths = [
        "memory/FILENAME.md",
        "base-documents/EXPERIENCE-REFERENCE.md",
    ]
    app_note = ""
    if app_folder_name:
        allowed_paths.append(f"applications/{app_folder_name}/notes.md")
        allowed_paths.append(f"applications/{app_folder_name}/Sherman_Wood_*.md")
        app_note = (
            f" Active application: {app_folder_name}. "
            f"You may also write notes.md or the resume file for this application "
            f"using the full path applications/{app_folder_name}/FILENAME.md."
        )
    return [
        {
            "name": "write_file",
            "description": (
                "Write or update a project file. "
                f"Allowed paths from data root: {', '.join(allowed_paths)}."
                + app_note
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": (
                            "Path relative to the data root, e.g. "
                            "'memory/feedback_something.md' or "
                            f"'applications/{app_folder_name}/notes.md'."
                            if app_folder_name
                            else "Path relative to the data root."
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
    """
    data_root = get_data_root()
    p = path.strip().lstrip("/")

    # ── memory/ files ─────────────────────────────────────────────────────────
    if p.startswith("memory/"):
        dest = data_root / p
        dest.parent.mkdir(parents=True, exist_ok=True)
        original = dest.read_text(encoding="utf-8") if dest.exists() else None
        dest.write_text(content, encoding="utf-8")
        # Mirror to Claude's memory dir immediately
        claude_mem = (
            Path.home()
            / ".claude/projects/-Users-shermanwood-Documents-Job-Search-2026/memory"
        )
        try:
            (claude_mem / dest.name).write_text(content, encoding="utf-8")
        except Exception:
            pass
        return f"Written: {p}", dest, original

    # ── EXPERIENCE-REFERENCE.md ───────────────────────────────────────────────
    if p == "base-documents/EXPERIENCE-REFERENCE.md":
        dest = data_root / p
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
        "Use memory/, base-documents/EXPERIENCE-REFERENCE.md, "
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
        # Loop: send updated messages back to API

    return final_text, tool_records


# ─── Tracker parsing ──────────────────────────────────────────────────────────


def parse_tracker() -> list[dict]:
    """Parse the Active Applications table from application-tracker.md."""
    data_root = get_data_root()
    config = load_config()
    tracker_path = data_root / config["paths"]["tracker"]
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

        # Split on pipe, drop empty first/last
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

        # Flexible column mapping: some rows are missing the Source column
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

        # Extract recruiter from "(via XXXX)" or "(through XXXX)"
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

    # Reverse-chronological order
    jobs.sort(key=lambda j: j.get("date", ""), reverse=True)
    return jobs


def find_app_folder_for_job(company: str, date: str) -> Optional[Path]:
    """Find the application folder that best matches the given company and date."""
    apps_dir = get_data_root() / "applications"
    if not apps_dir.exists():
        return None

    company_slug = slugify(company)
    # Normalise date to YYYY-MM-DD if possible
    date_prefix = date[:10] if len(date) >= 10 and date[4] == "-" else ""

    for d in sorted(apps_dir.iterdir(), reverse=True):
        if not d.is_dir():
            continue
        name = d.name
        if date_prefix and name.startswith(date_prefix) and company_slug in name:
            return d

    # Fallback: any folder containing the company slug
    candidates = [
        d for d in apps_dir.iterdir()
        if d.is_dir() and company_slug in d.name
    ]
    return candidates[0] if len(candidates) == 1 else None


def list_app_files_recursive(app_dir: Path) -> list[dict]:
    """Return a flat tree of files/folders under app_dir as list of dicts."""
    if not app_dir.exists():
        return []

    result: list[dict] = []

    def _recurse(path: Path, depth: int, rel_prefix: str) -> None:
        try:
            # Folders first, then files, both alphabetically
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
