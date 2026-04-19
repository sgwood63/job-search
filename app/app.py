"""
app.py — Streamlit entry point for the Job Search Assistant.

UI flow:
  Home (tracker table with filters) → Job Application page
  Job page: file browser (left) + process bar + file viewer / chat (right)
"""

import re
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional

import streamlit as st
import engine

# ─── Page config ─────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="Job Search Assistant",
    page_icon="💼",
    layout="wide",
)

# ─── Constants ────────────────────────────────────────────────────────────────

_config = engine.load_config()
APP_URL = _config.get("app_url", "http://localhost:8501")

CLOSED_STATUSES = {"not pursued", "closed", "rejected", "withdrawn"}

STATUS_EMOJI = {
    "applied": "🟢",
    "phone": "🔵",
    "screening": "🔵",
    "onsite": "🔵",
    "offer": "🏆",
    "awaiting": "🟡",
    "ready": "🟡",
    "hold": "🟠",
    "researching": "🟠",
    "rejected": "🔴",
    "not": "⚫",
    "closed": "⚫",
    "withdrawn": "⚫",
}


def _status_emoji(status: str) -> str:
    first = status.lower().split()[0] if status else ""
    return STATUS_EMOJI.get(first, "")


def _is_closed(status: str) -> bool:
    return status.lower().strip() in CLOSED_STATUSES


# ─── Session state ────────────────────────────────────────────────────────────


def _init():
    defaults: dict = {
        # Navigation
        "page": "home",
        # Current job (job page)
        "current_app_row": None,      # tracker dict or None (new JD)
        "current_app_name": None,     # folder name string
        "app_local_path": None,       # Path
        "app_gdrive_path": None,      # Path or None
        "temp_app_path": None,        # Path to _temp-* staging folder for new JD intake
        # Active process + chat
        "active_process": None,
        "chat_messages": [],
        "chat_system_prompt": "",
        "chat_file_blocks": [],
        "pending_guidance": None,
        "last_response": "",
        # JD evaluation gate — True after AI completes first screen-jd evaluation
        "jd_eval_complete": False,
        # Post-save analysis — dict with file_rel/content keys, or None
        "post_save_analysis_pending": None,
        # Update-memory tool tracking
        "memory_written_files": [],   # rel_paths written this session
        "session_file_backups": {},   # {rel_path: original_content or None}
        # File browser
        "selected_file": None,        # rel_path within app folder
        "expanded_dirs": set(),
        # View layout
        "view_mode": "both",          # "both" | "file_only" | "chat_only"
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v


_init()


# ─── Navigation ───────────────────────────────────────────────────────────────


def _reset_job_state():
    # Clean up any abandoned temp staging folder
    temp = st.session_state.get("temp_app_path")
    if temp:
        engine.cleanup_temp_folder(temp)
    st.session_state.temp_app_path = None
    st.session_state.active_process = None
    st.session_state.chat_messages = []
    st.session_state.chat_system_prompt = ""
    st.session_state.chat_file_blocks = []
    st.session_state.pending_guidance = None
    st.session_state.last_response = ""
    st.session_state.jd_eval_complete = False
    st.session_state.post_save_analysis_pending = None
    st.session_state.memory_written_files = []
    st.session_state.session_file_backups = {}
    st.session_state.selected_file = None
    st.session_state.expanded_dirs = set()
    st.session_state.view_mode = "both"


def nav_to_home():
    _reset_job_state()
    st.session_state.page = "home"
    st.session_state.current_app_row = None
    st.session_state.current_app_name = None
    st.session_state.app_local_path = None
    st.session_state.app_gdrive_path = None
    st.rerun()


def _resolve_app_paths(app_local: Optional[Path]):
    if not app_local:
        st.session_state.app_local_path = None
        st.session_state.app_gdrive_path = None
        st.session_state.current_app_name = None
        return
    config = engine.load_config()
    gdrive_root = Path(config["applicant"]["gdrive_root"])
    candidate = gdrive_root / "applications" / app_local.name
    st.session_state.app_local_path = app_local
    st.session_state.app_gdrive_path = candidate if candidate.exists() else None
    st.session_state.current_app_name = app_local.name


def nav_to_job(row: Optional[dict], process: Optional[dict] = None):
    _reset_job_state()
    st.session_state.page = "job"
    st.session_state.current_app_row = row

    app_local = None
    if row:
        app_local = engine.find_app_folder_for_job(row["company"], row["date"])
    _resolve_app_paths(app_local)

    if process:
        _activate_process_internal(process, app_local)
        st.session_state.view_mode = "both" if app_local else "chat_only"
    st.rerun()


def nav_to_new_job():
    _reset_job_state()
    st.session_state.page = "job"
    st.session_state.current_app_row = None
    _resolve_app_paths(None)
    st.session_state.view_mode = "chat_only"

    try:
        proc = engine.load_process("screen-jd")
        _activate_process_internal(proc, None)
    except Exception:
        pass
    st.rerun()


def _activate_process_internal(process: dict, app_path: Optional[Path]):
    context = engine.assemble_context(
        process,
        application=app_path.name if app_path else None,
    )
    system_prompt = engine.build_system_prompt(process, context)
    file_blocks = engine.load_app_file_blocks(app_path) if app_path else []

    desc = process.get("description", "")
    intro = (
        f"**{process['display_name']}**\n\n{desc}\n\n"
        "Context files are loaded. Ready to help — what would you like to do?"
    )

    st.session_state.active_process = process
    st.session_state.chat_system_prompt = system_prompt
    st.session_state.chat_file_blocks = file_blocks
    st.session_state.pending_guidance = None
    st.session_state.last_response = ""
    st.session_state.chat_messages = [{"role": "assistant", "content": intro}]


# ─── Query-param handler (new-tab support) ────────────────────────────────────


def _handle_query_params():
    params = st.query_params
    if "app" in params and st.session_state.page == "home":
        app_name = params["app"]
        app_path = engine.get_app_dir(app_name)
        if app_path.exists():
            _reset_job_state()
            st.session_state.page = "job"
            _resolve_app_paths(app_path)
            if "file" in params:
                st.session_state.selected_file = params["file"]
                st.session_state.view_mode = "file_only"
            if "chat" in params:
                try:
                    proc = engine.load_process(params["chat"])
                    _activate_process_internal(proc, app_path)
                    st.session_state.view_mode = "chat_only"
                except Exception:
                    pass


_handle_query_params()


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _last_assistant_text() -> str:
    for msg in reversed(st.session_state.chat_messages):
        if msg["role"] == "assistant":
            return msg["content"]
    return ""


def _model_and_temp(process: dict) -> tuple[str, float]:
    config = engine.load_config()
    model = process.get("model", config["models"]["default"])
    factual = {"screen-jd", "debrief", "update-memory"}
    temp = (
        config["api"]["temperature_factual"]
        if process["name"] in factual
        else config["api"]["temperature_generative"]
    )
    return model, temp


def _get_or_create_temp_folder() -> Path:
    """Return the current temp staging folder, creating one if needed."""
    if not st.session_state.temp_app_path:
        st.session_state.temp_app_path = engine.create_temp_folder()
    return st.session_state.temp_app_path


def _reload_temp_file_blocks() -> None:
    """Refresh chat_file_blocks from the current temp staging folder."""
    temp = st.session_state.temp_app_path
    if temp:
        st.session_state.chat_file_blocks = engine.load_temp_file_blocks(temp)


def _send_message(user_text: str):
    process = st.session_state.active_process
    if not process:
        return
    if process["name"] == "update-memory":
        _send_message_agentic(user_text)
    else:
        _send_message_standard(user_text)


def _send_message_standard(user_text: str):
    process = st.session_state.active_process
    model, temp = _model_and_temp(process)
    config = engine.load_config()

    # In new JD mode, save the first pasted message as jd-paste.txt in the temp folder
    if st.session_state.app_local_path is None:
        is_first_user_msg = not any(
            m["role"] == "user" for m in st.session_state.chat_messages
        )
        if is_first_user_msg:
            jd_temp = _get_or_create_temp_folder()
            engine.save_file(jd_temp, "jd-paste.txt", user_text)
            _reload_temp_file_blocks()

    st.session_state.chat_messages.append({"role": "user", "content": user_text})

    with st.spinner("Thinking…"):
        try:
            reply = engine.call_api(
                system_prompt=st.session_state.chat_system_prompt,
                messages=st.session_state.chat_messages,
                model=model,
                temperature=temp,
                max_tokens=config["api"]["max_tokens"],
                file_blocks=st.session_state.chat_file_blocks or None,
            )
        except Exception as exc:
            reply = f"**API error:** {exc}"

    st.session_state.chat_messages.append({"role": "assistant", "content": reply})
    st.session_state.last_response = reply

    # Unlock save buttons after first real AI evaluation in screen-jd
    if process.get("name") == "screen-jd" and not st.session_state.get("jd_eval_complete"):
        st.session_state.jd_eval_complete = True

    if engine.detect_guidance_in_message(user_text) and not st.session_state.pending_guidance:
        st.session_state.pending_guidance = user_text


def _send_message_agentic(user_text: str):
    """Send message using agentic tool-use loop (update-memory process)."""
    process = st.session_state.active_process
    model, temp = _model_and_temp(process)
    config = engine.load_config()

    app_local: Optional[Path] = st.session_state.app_local_path
    app_gdrive: Optional[Path] = st.session_state.app_gdrive_path
    app_folder_name: Optional[str] = app_local.name if app_local else None

    st.session_state.chat_messages.append({"role": "user", "content": user_text})

    written_this_call: list[str] = []

    def on_tool_call(name: str, tool_input: dict) -> str:
        if name == "write_file":
            path = tool_input.get("path", "")
            content = tool_input.get("content", "")
            msg, dest, original = engine.execute_project_write(
                path, content, app_local, app_gdrive
            )
            if dest:
                rp = path.strip().lstrip("/")
                written_this_call.append(rp)
                # Store backup only if not already backed up (first write wins)
                if rp not in st.session_state.session_file_backups:
                    st.session_state.session_file_backups[rp] = original
            return msg
        return f"Unknown tool: {name}"

    tools = engine.make_update_tools(app_folder_name)

    with st.spinner("Working…"):
        try:
            reply, _ = engine.call_api_agentic(
                system_prompt=st.session_state.chat_system_prompt,
                messages=st.session_state.chat_messages,
                model=model,
                temperature=temp,
                max_tokens=config["api"]["max_tokens"],
                file_blocks=st.session_state.chat_file_blocks or None,
                tools=tools,
                on_tool_call=on_tool_call,
            )
        except Exception as exc:
            reply = f"**API error:** {exc}"

    for rp in written_this_call:
        if rp not in st.session_state.memory_written_files:
            st.session_state.memory_written_files.append(rp)

    st.session_state.chat_messages.append({"role": "assistant", "content": reply})
    st.session_state.last_response = reply


# ─── Dialogs ─────────────────────────────────────────────────────────────────


@st.dialog("Create Application Folder", width="large")
def dialog_create_folder():
    row = st.session_state.current_app_row or {}
    company = st.text_input("Company name", value=row.get("company", ""))
    role = st.text_input("Role title", value=row.get("role", ""))
    default_date = row.get("date", datetime.now().strftime("%Y-%m-%d"))[:10]
    date_str = st.text_input("Date (YYYY-MM-DD)", value=default_date)
    if st.button("Create", type="primary"):
        if not company or not role:
            st.error("Company and role are required.")
        else:
            local_path, gdrive_path = engine.create_application_folder(
                company, role, date_str or None
            )
            # Move any staged files from the temp folder into the new folder
            temp = st.session_state.get("temp_app_path")
            if temp and isinstance(temp, Path) and temp.exists():
                engine.promote_temp_folder(temp, local_path, gdrive_path)
                st.session_state.temp_app_path = None
            st.session_state.app_local_path = local_path
            st.session_state.app_gdrive_path = gdrive_path
            st.session_state.current_app_name = local_path.name
            st.success(f"Created: `{local_path.name}`")
            st.rerun()


@st.dialog("Save Job Description", width="large")
def dialog_save_jd():
    app_path: Optional[Path] = st.session_state.app_local_path
    today = datetime.now().strftime("%Y-%m-%d")
    sections = engine.extract_jd_sections(st.session_state.chat_messages)

    jd_content = sections.get("jd_content") or next(
        (m["content"] for m in st.session_state.chat_messages if m["role"] == "user"), ""
    )

    if not app_path:
        # Create folder inline before saving
        st.markdown("**No application folder yet — create one:**")
        row = st.session_state.current_app_row or {}

        # Try to parse date from AI-suggested folder name
        date_default = today
        folder_name = sections.get("folder_name", "")
        if folder_name:
            parts = folder_name.split("-")
            if len(parts) >= 3 and len(parts[0]) == 4:
                date_default = "-".join(parts[:3])

        company = st.text_input("Company", value=row.get("company", ""), key="sjd_company")
        role = st.text_input("Role", value=row.get("role", ""), key="sjd_role")
        save_date = st.text_input("Date (YYYY-MM-DD)", value=date_default, key="sjd_date")
        st.divider()
        content = st.text_area("Job description content:", value=jd_content, height=300)

        if st.button("Create Folder & Save JD", type="primary"):
            if not company or not role:
                st.error("Company and role are required.")
            else:
                local_path, gdrive_path = engine.create_application_folder(
                    company, role, save_date or None
                )
                temp = st.session_state.get("temp_app_path")
                if temp and isinstance(temp, Path) and temp.exists():
                    engine.promote_temp_folder(temp, local_path, gdrive_path)
                    st.session_state.temp_app_path = None
                st.session_state.app_local_path = local_path
                st.session_state.app_gdrive_path = gdrive_path
                st.session_state.current_app_name = local_path.name
                stamped = engine.stamp_update(content, save_date or today, "Initial JD")
                engine.save_file(local_path, "job-description.md", stamped, gdrive_path)
                st.success(f"Created `{local_path.name}` and saved job-description.md")
                st.rerun()
    else:
        save_date = st.text_input("Date (YYYY-MM-DD)", value=today, key="sjd_date_existing")
        content = st.text_area("Job description content:", value=jd_content, height=400)
        if st.button("Save", type="primary"):
            stamped = engine.stamp_update(content, save_date or today)
            engine.save_file(app_path, "job-description.md", stamped, st.session_state.app_gdrive_path)
            st.success(f"Saved to `{app_path.name}/job-description.md`")
            st.rerun()


@st.dialog("Save Notes", width="large")
def dialog_save_notes():
    app_path: Optional[Path] = st.session_state.app_local_path
    if not app_path:
        st.error("No application folder. Use Save JD to create one first.")
        return
    today = datetime.now().strftime("%Y-%m-%d")
    save_date = st.text_input("Date (YYYY-MM-DD)", value=today, key="sn_date")
    notes_path = app_path / "notes.md"
    sections = engine.extract_jd_sections(st.session_state.chat_messages)
    notes_content = sections.get("notes") or (
        engine.extract_fenced_block(_last_assistant_text(), "markdown") or _last_assistant_text()
    )
    content = st.text_area("Notes content:", value=notes_content, height=400)
    mode = st.radio("Write mode:", ["Append to existing notes.md", "Overwrite notes.md"])
    if st.button("Save", type="primary"):
        gdrive = st.session_state.app_gdrive_path
        used_date = save_date or today
        if mode.startswith("Append") and notes_path.exists():
            timestamped = f"\n\n**{used_date}** —\n\n{content}"
            engine.append_to_file(notes_path, timestamped)
            if gdrive:
                engine.append_to_file(gdrive / "notes.md", timestamped)
        else:
            stamped = engine.stamp_update(content, used_date)
            engine.save_file(app_path, "notes.md", stamped, gdrive)
        st.success("Notes saved.")
        st.rerun()


@st.dialog("Save Resume (Markdown)", width="large")
def dialog_save_resume():
    app_path: Optional[Path] = st.session_state.app_local_path
    if not app_path:
        st.error("No application folder. Create one first.")
        return
    default = (
        engine.extract_fenced_block(_last_assistant_text(), "markdown")
        or _last_assistant_text()
    )
    content = st.text_area("Resume markdown:", value=default, height=500)
    filename = st.text_input("Filename:", value="Sherman_Wood_Resume.md")
    if st.button("Save", type="primary"):
        if not filename.endswith(".md"):
            filename += ".md"
        engine.save_file(app_path, filename, content, st.session_state.app_gdrive_path)
        st.success(f"Saved: `{filename}`")
        st.rerun()


@st.dialog("Generate PDF", width="small")
def dialog_generate_pdf():
    app_path: Optional[Path] = st.session_state.app_local_path
    if not app_path:
        st.error("No application folder selected.")
        return
    resume_md = engine.find_resume_md(app_path)
    if not resume_md:
        st.error(f"No `Sherman_Wood_*.md` found in `{app_path.name}/`.")
        return
    st.markdown(f"Generate PDF from: `{resume_md.name}`")
    if st.button("Generate", type="primary"):
        with st.spinner("Running pandoc / weasyprint…"):
            ok, msg = engine.generate_pdf(resume_md)
        if ok:
            pdf_path = resume_md.with_suffix(".pdf")
            if st.session_state.app_gdrive_path:
                engine.sync_to_gdrive(pdf_path)
            st.success(f"PDF written: `{pdf_path.name}`")
        else:
            st.error(f"PDF generation failed:\n```\n{msg}\n```")
        st.rerun()


@st.dialog("Update Application Tracker", width="large")
def dialog_update_tracker():
    config = engine.load_config()
    tracker_rel = config["applicant"]["tracker"]
    tracker_path = engine.get_applicant_dir() / tracker_rel
    today = datetime.now().strftime("%Y-%m-%d")
    save_date = st.text_input("Date (YYYY-MM-DD)", value=today, key="ut_date")
    sections = engine.extract_jd_sections(st.session_state.chat_messages)
    tracker_row = sections.get("tracker_row") or engine.extract_fenced_block(_last_assistant_text()) or ""
    st.markdown(f"Append a row to `{tracker_rel}`.")
    entry = st.text_area("Tracker entry (markdown table row):", value=tracker_row, height=150)
    note = st.text_area(
        "Note to append to notes.md (optional):",
        height=100,
        placeholder="e.g. Status changed to Applied — submitted via LinkedIn.",
        key="ut_note",
    )
    if st.button("Append to Tracker", type="primary"):
        used_date = save_date or today
        dated_entry = entry
        if used_date != today and entry.startswith("|"):
            dated_entry = re.sub(
                r"^\|\s*\d{4}-\d{2}-\d{2}\s*\|",
                f"| {used_date} |",
                entry,
            )
        engine.append_to_file(tracker_path, dated_entry)
        engine.sync_to_gdrive(tracker_path)
        # Append note to notes.md if provided
        app_path = st.session_state.app_local_path
        if note.strip() and app_path:
            gdrive = st.session_state.app_gdrive_path
            notes_path = app_path / "notes.md"
            timestamped_note = f"\n\n**{used_date}** — Status update\n\n{note.strip()}"
            engine.append_to_file(notes_path, timestamped_note)
            if gdrive:
                engine.append_to_file(gdrive / "notes.md", timestamped_note)
        st.success("Tracker updated." + (" Note appended to notes.md." if note.strip() and app_path else ""))
        st.rerun()


@st.dialog("Sync to Google Drive", width="small")
def dialog_sync_gdrive():
    app_path: Optional[Path] = st.session_state.app_local_path
    if not app_path:
        st.error("No application folder selected.")
        return
    st.markdown(f"Sync `{app_path.name}/` to Google Drive?")
    if st.button("Sync", type="primary"):
        with st.spinner("Syncing…"):
            ok, msg = engine.sync_to_gdrive(app_path)
        if ok:
            st.success(f"Synced to: `{msg}`")
        else:
            st.error(f"Sync failed: {msg}")
        st.rerun()


@st.dialog("Save Memory File", width="large")
def dialog_save_memory():
    default = (
        engine.extract_fenced_block(_last_assistant_text(), "markdown")
        or _last_assistant_text()
    )
    content = st.text_area("Memory file content:", value=default, height=400)
    filename = st.text_input("Filename:", placeholder="e.g. feedback_something.md")
    mem_type = st.radio(
        "Memory type:",
        ["Applicant (personal facts, preferences)", "App-process (workflow rules, git-tracked)"],
        index=0,
    )
    if st.button("Save", type="primary"):
        if not filename:
            st.error("Filename required.")
        else:
            if not filename.endswith(".md"):
                filename += ".md"
            app_process = mem_type.startswith("App-process")
            if app_process:
                mem_dir = engine.get_app_root() / "memory"
                label = f"memory/{filename} (git-tracked)"
            else:
                mem_dir = engine.get_applicant_dir() / "memory"
                label = f"$APPLICANT_DIR/memory/{filename}"
            (mem_dir / filename).write_text(content, encoding="utf-8")
            claude_mem = engine._claude_memory_dir()
            try:
                (claude_mem / filename).write_text(content, encoding="utf-8")
            except Exception:
                pass
            st.success(f"Saved: `{label}`")
            st.rerun()


@st.dialog("Upload Files", width="large")
def dialog_upload_files():
    app_path: Optional[Path] = st.session_state.app_local_path
    if not app_path:
        st.error("No application folder selected.")
        return

    all_items = engine.list_app_files_recursive(app_path)
    subfolders = ["(root)"] + [
        item["rel_path"] for item in all_items if item["is_dir"]
    ]
    target_folder = st.selectbox("Upload to:", subfolders)

    uploaded = st.file_uploader(
        "Select files",
        type=["pdf", "docx", "doc", "md", "txt", "png", "jpg", "jpeg", "gif", "webp"],
        accept_multiple_files=True,
        label_visibility="collapsed",
    )

    existing = engine.list_uploaded_files(app_path)
    if existing:
        with st.expander(f"Files already in folder ({len(existing)})", expanded=False):
            for f in existing:
                st.caption(f.name)

    if uploaded and st.button("Save to folder", type="primary"):
        dest_dir = app_path if target_folder == "(root)" else app_path / target_folder
        gdrive_base = st.session_state.app_gdrive_path
        gdrive_dest = (
            (gdrive_base / target_folder if target_folder != "(root)" else gdrive_base)
            if gdrive_base
            else None
        )
        saved = []
        for uf in uploaded:
            engine.save_uploaded_file(dest_dir, uf.name, uf.read(), gdrive_dest)
            saved.append(uf.name)
        st.success(f"Saved {len(saved)} file(s): {', '.join(saved)}")
        st.rerun()


@st.dialog("Implications of Recent Save", width="large")
def dialog_analyze_implications():
    pending = st.session_state.get("post_save_analysis_pending")
    if not pending:
        st.session_state.post_save_analysis_pending = None
        return

    app_path: Optional[Path] = st.session_state.app_local_path
    file_rel = pending["file_rel"]
    file_content = pending["content"]

    st.markdown(f"Analyzing implications of saving **{file_rel}**…")

    # Assemble lightweight app context (notes + JD only)
    app_context_parts = []
    if app_path:
        for fname in ("job-description.md", "notes.md"):
            p = app_path / fname
            if p.exists() and p.name != Path(file_rel).name:
                app_context_parts.append(f"=== {fname} ===\n{p.read_text(encoding='utf-8')}")
    app_context = "\n\n".join(app_context_parts)

    with st.spinner("Reviewing…"):
        try:
            analysis = engine.analyze_file_implications(file_rel, file_content, app_context)
        except Exception as exc:
            st.error(f"Analysis failed: {exc}")
            if st.button("Dismiss"):
                st.session_state.post_save_analysis_pending = None
                st.rerun()
            return

    st.markdown(analysis)
    st.divider()

    # Parse proposals to offer targeted apply buttons
    today = datetime.now().strftime("%Y-%m-%d")
    notes_to_add = ""
    m = re.search(r"\*\*NOTES TO ADD:\*\*\s*\n+(.*?)(?=\n\*\*|\Z)", analysis, re.DOTALL | re.IGNORECASE)
    if m:
        notes_to_add = m.group(1).strip()

    col1, col2 = st.columns(2)
    with col1:
        if notes_to_add and app_path:
            if st.button("📝 Append to notes.md", type="primary"):
                notes_path = app_path / "notes.md"
                gdrive = st.session_state.app_gdrive_path
                entry = f"\n\n**{today}** — AI implications\n\n{notes_to_add}"
                engine.append_to_file(notes_path, entry)
                if gdrive:
                    engine.append_to_file(gdrive / "notes.md", entry)
                st.toast("Notes updated.")
    with col2:
        if st.button("Dismiss"):
            st.session_state.post_save_analysis_pending = None
            st.rerun()


@st.dialog("Add URL to Application", width="large")
def dialog_add_url_to_app():
    app_path: Optional[Path] = st.session_state.app_local_path
    if not app_path:
        st.error("No application folder selected.")
        return
    url = st.text_input("URL", placeholder="https://…", key="add_url_input")
    filename_stem = st.text_input(
        "Save as (filename without extension)", value="document-from-url", key="add_url_stem"
    )
    st.caption("Saves a PDF and extracted text file to the application folder.")
    if st.button("Fetch & Save", type="primary"):
        if not url or not filename_stem:
            st.error("URL and filename are required.")
        else:
            gdrive = st.session_state.app_gdrive_path
            fetched = False
            with st.spinner("Fetching URL…"):
                try:
                    engine.fetch_url_browser(url.strip(), app_path, filename_stem.strip())
                    fetched = True
                except Exception:
                    pass
            if not fetched:
                with st.spinner("Trying simple fetch…"):
                    try:
                        text = engine.fetch_url_text(url.strip())
                        if text:
                            engine.save_file(app_path, f"{filename_stem}.txt", text, gdrive)
                            fetched = True
                    except Exception:
                        pass
            if fetched:
                if gdrive:
                    for ext in (".pdf", ".txt"):
                        p = app_path / f"{filename_stem}{ext}"
                        if p.exists():
                            engine.sync_to_gdrive(p)
                st.success(f"Saved `{filename_stem}.pdf` / `.txt` to `{app_path.name}/`")
                st.rerun()
            else:
                st.error("Could not fetch URL.")


@st.dialog("Create Subfolder", width="small")
def dialog_create_subfolder():
    app_path: Optional[Path] = st.session_state.app_local_path
    if not app_path:
        st.error("No application folder selected.")
        return
    folder_name = st.text_input("Subfolder name:")
    if st.button("Create", type="primary"):
        if not folder_name:
            st.error("Name required.")
        else:
            (app_path / folder_name).mkdir(exist_ok=True)
            gdrive = st.session_state.app_gdrive_path
            if gdrive:
                try:
                    (gdrive / folder_name).mkdir(exist_ok=True)
                except Exception:
                    pass
            st.success(f"Created: `{folder_name}/`")
            st.rerun()


@st.dialog("Update Memory Index", width="large")
def dialog_update_memory_index():
    index_type = st.radio(
        "Which index?",
        ["APPLICANT-MEMORY.md (applicant memory index)", "MEMORY.md (app-process rules, git-tracked)"],
        index=0,
    )
    if index_type.startswith("APPLICANT"):
        mem_index = engine.get_applicant_dir() / "memory" / "APPLICANT-MEMORY.md"
        label = "APPLICANT-MEMORY.md"
    else:
        mem_index = engine.get_app_root() / "memory" / "MEMORY.md"
        label = "MEMORY.md"
    current = mem_index.read_text(encoding="utf-8") if mem_index.exists() else ""
    content = st.text_area(f"{label} content:", value=current, height=400)
    if st.button("Save", type="primary"):
        mem_index.write_text(content, encoding="utf-8")
        claude_mem = engine._claude_memory_dir()
        try:
            (claude_mem / mem_index.name).write_text(content, encoding="utf-8")
        except Exception:
            pass
        st.success(f"{label} updated.")
        st.rerun()


@st.dialog("Sync Memory to Claude & Git", width="small")
def dialog_sync_memory():
    st.markdown(
        "This will:\n"
        "1. Copy `Job-Search-2026/memory/*.md` → Claude auto-memory\n"
        "2. Copy `$APPLICANT_DIR/memory/*.md` → Claude auto-memory\n"
        "3. `git add memory/ && git commit` (app-process memory only)"
    )
    commit_msg = st.text_input("Commit message:", value="Update memory: ")
    if st.button("Run Sync", type="primary"):
        app_root = engine.get_app_root()
        applicant_dir = engine.get_applicant_dir()
        claude_mem = engine._claude_memory_dir()
        errors = []
        # Copy app-process memory files
        for f in (app_root / "memory").glob("*.md"):
            try:
                (claude_mem / f.name).write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
            except Exception as e:
                errors.append(f"app memory/{f.name}: {e}")
        # Copy applicant memory files
        for f in (applicant_dir / "memory").glob("*.md"):
            try:
                (claude_mem / f.name).write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
            except Exception as e:
                errors.append(f"applicant memory/{f.name}: {e}")
        if errors:
            st.error("Copy errors:\n" + "\n".join(errors))
            return
        # Git commit only app-process memory (app_root/memory/)
        result = subprocess.run(
            f'git -C "{app_root}" add memory/ && git -C "{app_root}" commit -m "{commit_msg}"',
            shell=True,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            st.success("Memory synced and committed.")
        else:
            st.warning(f"Git output:\n```\n{result.stdout}\n{result.stderr}\n```")
        st.rerun()


@st.dialog("Commit Memory Changes", width="large")
def dialog_commit_memory():
    app_root = engine.get_app_root()
    written = st.session_state.get("memory_written_files", [])

    # Show only app-process memory files (the ones that go to git)
    app_mem_written = [f for f in written if f.startswith("memory/")]
    applicant_mem_written = [f for f in written if f.startswith("applicant-memory/") or f.startswith("base-documents/")]

    if app_mem_written:
        st.markdown("**App-process memory files (git-tracked):**")
        for f in app_mem_written:
            st.code(f)
    if applicant_mem_written:
        st.caption("Applicant memory files written this session (not git-tracked — saved to APPLICANT_DIR):")
        for f in applicant_mem_written:
            st.caption(f"`{f}`")
    if not app_mem_written and not applicant_mem_written:
        st.info("No files written in this session — committing any staged changes.")

    commit_msg = st.text_input("Commit message:", value="Update memory: ")

    if st.button("Commit", type="primary"):
        # Only commit app-process memory (Job-Search-2026/memory/)
        result = subprocess.run(
            f'git -C "{app_root}" add memory/ && git -C "{app_root}" commit -m "{commit_msg}"',
            shell=True,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            st.success("App-process memory committed to git.")
            st.session_state.memory_written_files = []
        else:
            st.warning(f"Git output:\n```\n{result.stdout}\n{result.stderr}\n```")
        st.rerun()


@st.dialog("Revert Memory Changes", width="large")
def dialog_revert_memory():
    app_root = engine.get_app_root()
    applicant_dir = engine.get_applicant_dir()
    written: list[str] = st.session_state.get("memory_written_files", [])
    backups: dict = st.session_state.get("session_file_backups", {})

    st.markdown("**This will discard all file changes made in this session.**")
    if written:
        st.markdown("Files that will be reverted:")
        for f in written:
            existed_before = f in backups and backups.get(f) is not None
            label = f if existed_before else f"{f} *(new — will be deleted)*"
            st.code(label)
    else:
        st.info("No files written in this session.")

    if st.button("Revert", type="primary"):
        claude_mem = engine._claude_memory_dir()
        for rel_path in written:
            original = backups.get(rel_path)  # None means file didn't exist before

            if rel_path.startswith("memory/"):
                # App-process memory — git-tracked in app_root
                full_path = app_root / rel_path
                tracked = subprocess.run(
                    ["git", "-C", str(app_root), "ls-files", "--error-unmatch", rel_path],
                    capture_output=True,
                )
                if tracked.returncode != 0:
                    full_path.unlink(missing_ok=True)
                    try:
                        (claude_mem / full_path.name).unlink(missing_ok=True)
                    except Exception:
                        pass
                else:
                    subprocess.run(
                        ["git", "-C", str(app_root), "restore", rel_path],
                        capture_output=True,
                    )
                    if full_path.exists():
                        try:
                            (claude_mem / full_path.name).write_text(
                                full_path.read_text(encoding="utf-8"), encoding="utf-8"
                            )
                        except Exception:
                            pass

            elif rel_path.startswith("applicant-memory/"):
                # Applicant memory — not git-tracked; use stored backup
                filename = rel_path[len("applicant-memory/"):]
                full_path = applicant_dir / "memory" / filename
                if original is None:
                    full_path.unlink(missing_ok=True)
                    try:
                        (claude_mem / filename).unlink(missing_ok=True)
                    except Exception:
                        pass
                else:
                    full_path.write_text(original, encoding="utf-8")
                    try:
                        (claude_mem / filename).write_text(original, encoding="utf-8")
                    except Exception:
                        pass

            elif rel_path.startswith("base-documents/") or rel_path.startswith("applications/"):
                # Applicant data — not git-tracked; use stored backup
                full_path = applicant_dir / rel_path
                if original is None:
                    full_path.unlink(missing_ok=True)
                else:
                    full_path.write_text(original, encoding="utf-8")

        st.session_state.memory_written_files = []
        st.session_state.session_file_backups = {}
        st.success("Changes reverted.")
        st.rerun()


# Output button registry
OUTPUT_LABELS = {
    "create_application_folder": "Create Folder",
    "save_jd": "Save JD",
    "save_notes": "Save Notes",
    "save_resume_md": "Save Resume",
    "generate_pdf": "Generate PDF",
    "update_tracker": "Update Tracker",
    "sync_gdrive": "Sync GDrive",
    "save_memory_file": "Save Memory",
    "update_memory_index": "Update Index",
    "sync_memory": "Sync Memory",
    "upload_files": "Upload Files",
    "commit_memory": "Commit",
    "revert_memory": "Revert",
}
OUTPUT_DIALOGS = {
    "create_application_folder": dialog_create_folder,
    "save_jd": dialog_save_jd,
    "save_notes": dialog_save_notes,
    "save_resume_md": dialog_save_resume,
    "generate_pdf": dialog_generate_pdf,
    "update_tracker": dialog_update_tracker,
    "sync_gdrive": dialog_sync_gdrive,
    "save_memory_file": dialog_save_memory,
    "update_memory_index": dialog_update_memory_index,
    "sync_memory": dialog_sync_memory,
    "upload_files": dialog_upload_files,
    "commit_memory": dialog_commit_memory,
    "revert_memory": dialog_revert_memory,
}


# ─── File viewer ──────────────────────────────────────────────────────────────


def render_file_viewer(app_path: Path, file_rel: str, maximized: bool = False):
    file_path = app_path / file_rel

    # Header row with controls
    title_col, ctrl_col = st.columns([5, 1])
    with title_col:
        st.markdown(f"**📄 {file_rel}**")
    with ctrl_col:
        c1, c2 = st.columns(2)
        with c1:
            if maximized:
                if st.button("⊟", key="fv_restore", help="Restore split view"):
                    st.session_state.view_mode = "both"
                    st.rerun()
            else:
                if st.button("⊞", key="fv_max", help="Maximize file viewer"):
                    st.session_state.view_mode = "file_only"
                    st.rerun()
        with c2:
            app_name = st.session_state.current_app_name or ""
            st.link_button(
                "⬚",
                url=f"{APP_URL}?app={app_name}&file={file_rel}",
                help="Open in new tab",
            )

    if not file_path.exists():
        st.warning(f"File not found: `{file_rel}`")
        return

    suffix = file_path.suffix.lower()
    text_height = 550 if maximized else 320

    if suffix in (".md", ".txt"):
        current = file_path.read_text(encoding="utf-8")
        editor_key = f"editor_{file_rel}"

        # Split-pane: edit on left, rendered preview on right
        edit_col, prev_col = st.columns(2)
        with edit_col:
            new_content = st.text_area(
                "Edit",
                value=current,
                height=text_height,
                label_visibility="collapsed",
                key=editor_key,
            )
        with prev_col:
            preview_text = st.session_state.get(editor_key, current)
            with st.container(height=text_height, border=True):
                st.markdown(preview_text)

        sv_col, rs_col, _ = st.columns([1, 1, 5])
        with sv_col:
            if st.button("💾 Save", key=f"save_{file_rel}"):
                file_path.write_text(new_content, encoding="utf-8")
                if st.session_state.app_gdrive_path:
                    engine.sync_to_gdrive(file_path)
                # Queue post-save analysis for non-JD files in existing apps
                if (
                    st.session_state.app_local_path
                    and file_path.name not in ("job-description.md",)
                    and file_path.suffix.lower() == ".md"
                ):
                    st.session_state.post_save_analysis_pending = {
                        "file_rel": file_rel,
                        "content": new_content,
                    }
                st.toast(f"Saved {file_path.name}")
                st.rerun()
        with rs_col:
            if st.button("↩ Reset", key=f"reset_{file_rel}"):
                st.rerun()

    elif suffix == ".pdf":
        st.info(f"PDF — download to view: `{file_rel}`")
        with open(file_path, "rb") as fh:
            st.download_button(
                "Download PDF",
                data=fh,
                file_name=file_path.name,
                mime="application/pdf",
                key=f"dl_pdf_{file_rel}",
            )

    elif suffix in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        st.image(str(file_path))

    else:
        try:
            st.code(file_path.read_text(encoding="utf-8"))
        except Exception:
            with open(file_path, "rb") as fh:
                st.download_button(
                    "Download File",
                    data=fh,
                    file_name=file_path.name,
                    key=f"dl_{file_rel}",
                )


# ─── Chat panel ───────────────────────────────────────────────────────────────


def render_chat(maximized: bool = False):
    process = st.session_state.active_process
    if not process:
        return

    # Header
    title_col, ctrl_col = st.columns([5, 1])
    with title_col:
        st.markdown(f"**💬 {process['display_name']}**")
    with ctrl_col:
        c1, c2 = st.columns(2)
        with c1:
            if maximized:
                if st.button("⊟", key="chat_restore", help="Restore split view"):
                    st.session_state.view_mode = "both"
                    st.rerun()
            else:
                if st.button("⊞", key="chat_max", help="Maximize chat"):
                    st.session_state.view_mode = "chat_only"
                    st.rerun()
        with c2:
            app_name = st.session_state.current_app_name or ""
            st.link_button(
                "⬚",
                url=f"{APP_URL}?app={app_name}&chat={process['name']}",
                help="Open in new tab",
            )

    # Message history
    chat_height = 460 if maximized else 280
    with st.container(height=chat_height, border=True):
        for msg in st.session_state.chat_messages:
            with st.chat_message(msg["role"]):
                st.markdown(msg["content"])

    # Pending guidance banner
    if st.session_state.pending_guidance:
        pg = st.session_state.pending_guidance
        with st.container(border=True):
            st.caption("Save as process guidance?")
            st.markdown(f"> {pg[:300]}{'…' if len(pg) > 300 else ''}")
            gc1, gc2 = st.columns([1, 4])
            with gc1:
                if st.button("Save guidance", type="primary", key="save_guidance"):
                    engine.save_guidance(process["name"], pg)
                    st.session_state.pending_guidance = None
                    st.toast("Guidance saved.")
                    st.rerun()
            with gc2:
                if st.button("Dismiss", key="dismiss_guidance"):
                    st.session_state.pending_guidance = None
                    st.rerun()

    # File / URL intake section — shown in new JD mode (no folder yet)
    if st.session_state.app_local_path is None:
        temp_path: Optional[Path] = st.session_state.temp_app_path
        staged = (
            [f for f in sorted(temp_path.iterdir()) if f.is_file()]
            if temp_path and temp_path.exists()
            else []
        )
        label = (
            f"📎 Attach files ({len(staged)} staged)"
            if staged
            else "📎 Attach JD files"
        )
        with st.expander(label, expanded=not staged):
            # URL fetch
            url_col, btn_col = st.columns([5, 1])
            with url_col:
                jd_url = st.text_input(
                    "JD URL",
                    placeholder="https://…",
                    label_visibility="collapsed",
                    key="jd_url_input",
                )
            with btn_col:
                if st.button("Fetch", key="fetch_jd_url", use_container_width=True):
                    if jd_url.strip():
                        jd_temp = _get_or_create_temp_folder()
                        fetched = False
                        with st.spinner("Fetching URL…"):
                            try:
                                engine.fetch_url_browser(jd_url.strip(), jd_temp)
                                fetched = True
                            except Exception:
                                pass
                        if not fetched:
                            with st.spinner("Trying simple fetch…"):
                                try:
                                    text = engine.fetch_url_text(jd_url.strip())
                                    if text:
                                        engine.save_file(jd_temp, "jd-from-url.txt", text)
                                        fetched = True
                                except Exception:
                                    pass
                        if fetched:
                            _reload_temp_file_blocks()
                            st.toast("URL content saved to context.")
                            st.rerun()
                        else:
                            st.error("Could not fetch URL — try pasting the text instead.")

            # File uploader
            uploaded_files = st.file_uploader(
                "Upload files",
                type=["pdf", "docx", "doc", "html", "htm", "txt", "md"],
                accept_multiple_files=True,
                key="jd_file_uploader",
                label_visibility="collapsed",
            )
            if uploaded_files and st.button(
                "Add to context", type="primary", key="save_jd_files", use_container_width=True
            ):
                jd_temp = _get_or_create_temp_folder()
                for uf in uploaded_files:
                    engine.save_uploaded_file(jd_temp, uf.name, uf.read())
                _reload_temp_file_blocks()
                st.toast(f"{len(uploaded_files)} file(s) added to context.")
                st.rerun()

            # Show staged files
            if staged:
                st.caption("Staged: " + ", ".join(f.name for f in staged))

    # Output action buttons
    outputs = process.get("outputs", [])
    if outputs:
        is_new_jd_screen = (
            st.session_state.app_local_path is None
            and process.get("name") == "screen-jd"
        )
        jd_eval_done = st.session_state.get("jd_eval_complete", False)
        save_outputs = {"save_jd", "save_notes", "update_tracker"}

        out_cols = st.columns(len(outputs))
        for i, output in enumerate(outputs):
            with out_cols[i]:
                gated = is_new_jd_screen and not jd_eval_done and output in save_outputs
                disabled = gated or (
                    not st.session_state.chat_messages
                    and output != "create_application_folder"
                )
                help_text = "Send the JD first — unlocks after AI evaluation" if gated else None
                if st.button(
                    OUTPUT_LABELS.get(output, output),
                    key=f"out_{output}",
                    disabled=disabled,
                    use_container_width=True,
                    help=help_text,
                ):
                    dialog_fn = OUTPUT_DIALOGS.get(output)
                    if dialog_fn:
                        dialog_fn()

        if is_new_jd_screen and not jd_eval_done:
            st.caption("💡 Paste or fetch the JD and send it — save buttons unlock after AI evaluation.")

    # Re-evaluate chip — screen-jd only, after initial evaluation
    if (
        process.get("name") == "screen-jd"
        and st.session_state.get("jd_eval_complete")
    ):
        if st.button("↻ Re-evaluate JD", key="reevaluate_jd"):
            _send_message(
                "Please re-evaluate the JD with any feedback you've received "
                "and output updated FOLDER NAME, JD CONTENT, NOTES, and TRACKER ROW sections."
            )
            st.rerun()

    # Chat input (form so it clears on submit)
    with st.form(key=f"chatform_{process['name']}", clear_on_submit=True):
        user_input = st.text_area(
            "msg",
            height=80,
            label_visibility="collapsed",
            placeholder="Type your message…",
        )
        submitted = st.form_submit_button("Send →", type="primary", use_container_width=True)

    if submitted and user_input.strip():
        _send_message(user_input.strip())
        st.rerun()


# ─── File browser ─────────────────────────────────────────────────────────────


def render_file_browser(app_path: Optional[Path]):
    st.markdown("### Files")

    if not app_path or not app_path.exists():
        st.caption("No application folder yet.")
        if st.button("📁 Create Folder", key="create_folder_fb", use_container_width=True):
            dialog_create_folder()
        return

    items = engine.list_app_files_recursive(app_path)
    selected_file = st.session_state.get("selected_file")
    expanded_dirs: set = st.session_state.expanded_dirs

    if not items:
        st.caption("Empty folder.")

    for item in items:
        # Determine if this item's ancestors are all expanded
        rel = item["rel_path"]
        parts = rel.split("/")
        ancestors = ["/".join(parts[:j]) for j in range(1, len(parts))]
        if any(anc not in expanded_dirs for anc in ancestors):
            continue  # parent is collapsed

        pad = "\u00a0" * 4 * item["depth"]  # non-breaking spaces for indent

        if item["is_dir"]:
            expanded = rel in expanded_dirs
            icon = "📂" if expanded else "📁"
            dir_key = f"dir_{rel.replace('/', '_')}"
            label = f"{pad}{icon} {item['name']}"
            if st.button(label, key=dir_key, use_container_width=True):
                if expanded:
                    expanded_dirs.discard(rel)
                else:
                    expanded_dirs.add(rel)
                st.session_state.expanded_dirs = expanded_dirs
                st.rerun()
        else:
            sfx = item["suffix"]
            icon = (
                "📋" if sfx == ".pdf"
                else "🖼️" if sfx in (".png", ".jpg", ".jpeg", ".gif", ".webp")
                else "📝" if sfx in (".md", ".txt")
                else "📎"
            )
            is_sel = selected_file == rel
            label = f"{pad}{'▶ ' if is_sel else ''}{icon} {item['name']}"
            file_key = f"f_{rel.replace('/', '__').replace('.', '_')}"
            if st.button(label, key=file_key, use_container_width=True):
                st.session_state.selected_file = None if is_sel else rel
                # When a file is selected, ensure file viewer is visible
                if not is_sel and st.session_state.view_mode == "chat_only":
                    st.session_state.view_mode = "both"
                st.rerun()

    st.divider()
    uc, urlc, fc = st.columns(3)
    with uc:
        if st.button("⬆ Upload", key="upload_btn", use_container_width=True):
            dialog_upload_files()
    with urlc:
        if st.button("🌐 URL", key="add_url_btn", use_container_width=True, help="Fetch a URL and save as PDF"):
            dialog_add_url_to_app()
    with fc:
        if st.button("+ Folder", key="new_dir_btn", use_container_width=True):
            dialog_create_subfolder()


# ─── Job application page ─────────────────────────────────────────────────────


def render_job_page():
    row = st.session_state.current_app_row
    app_path: Optional[Path] = st.session_state.app_local_path

    # Auto-trigger implications analysis after a file save
    if st.session_state.get("post_save_analysis_pending"):
        dialog_analyze_implications()

    # ── Top bar ───────────────────────────────────────────────────────────────
    back_col, title_col, status_col = st.columns([1, 5, 2])
    with back_col:
        if st.button("← Jobs"):
            nav_to_home()
    with title_col:
        if row:
            st.markdown(f"## {row['company']} — {row['role']}")
        else:
            st.markdown("## New Application")
    with status_col:
        if row:
            status = row.get("status", "")
            em = _status_emoji(status)
            st.markdown(f"**{em} {status}**" if em else f"**{status}**")

    # ── Summary ───────────────────────────────────────────────────────────────
    if row:
        s1, s2, s3, s4 = st.columns(4)
        with s1:
            st.caption(f"**Profile:** {row.get('profile', '—')}")
        with s2:
            st.caption(f"**Date:** {row.get('date', '—')[:10]}")
        with s3:
            st.caption(f"**Priority:** {row.get('priority', '—')}")
        with s4:
            na = row.get("next_action", "")
            st.caption(f"**Next:** {na[:60]}{'…' if len(na) > 60 else ''}" if na else "**Next:** —")
    elif app_path:
        st.caption(f"Folder: `{app_path.name}`")

    st.divider()

    # ── Process bar ───────────────────────────────────────────────────────────
    processes = engine.list_processes()
    active_proc = st.session_state.active_process

    proc_cols = st.columns(len(processes))
    for i, proc in enumerate(processes):
        with proc_cols[i]:
            is_active = active_proc is not None and active_proc["name"] == proc["name"]
            if st.button(
                proc["display_name"],
                key=f"procbtn_{proc['name']}",
                type="primary" if is_active else "secondary",
                use_container_width=True,
                help=proc.get("description", ""),
            ):
                if is_active:
                    # Deactivate (toggle off)
                    st.session_state.active_process = None
                    st.session_state.chat_messages = []
                    vm = st.session_state.view_mode
                    if vm == "chat_only":
                        st.session_state.view_mode = "both"
                else:
                    _activate_process_internal(proc, app_path)
                    if not st.session_state.selected_file:
                        st.session_state.view_mode = "chat_only"
                    else:
                        st.session_state.view_mode = "both"
                st.rerun()

    st.divider()

    # ── Two-column layout ─────────────────────────────────────────────────────
    left_col, right_col = st.columns([1, 3])

    with left_col:
        render_file_browser(app_path)

    with right_col:
        view_mode = st.session_state.view_mode
        selected_file = st.session_state.selected_file
        has_process = active_proc is not None

        show_file = bool(selected_file) and view_mode != "chat_only"
        show_chat = has_process and view_mode != "file_only"
        file_max = view_mode == "file_only"
        chat_max = view_mode == "chat_only"

        if show_file:
            render_file_viewer(app_path, selected_file, maximized=file_max)
            if show_chat:
                st.divider()

        if show_chat:
            render_chat(maximized=chat_max)

        if not show_file and not show_chat:
            st.info(
                "Select a **file** from the left panel to view it, "
                "or click a **process** button above to start a chat session."
            )


# ─── Home page ────────────────────────────────────────────────────────────────


def _default_process_idx(status: str, processes: list[dict]) -> int:
    """Pick a sensible default process index based on the application status."""
    sl = status.lower()
    name_priority = []
    if "interview" in sl:
        name_priority = ["interview-prep", "debrief"]
    elif "applied" in sl or "ready" in sl or "researching" in sl:
        name_priority = ["generate-resume", "review-resume"]
    elif "debrief" in sl or "offer" in sl:
        name_priority = ["debrief"]
    else:
        name_priority = ["screen-jd"]

    for target in name_priority:
        for j, p in enumerate(processes):
            if p["name"] == target:
                return j
    return 0


def render_home_page():
    # ── Header ───────────────────────────────────────────────────────────────
    hc1, hc2 = st.columns([7, 1])
    with hc1:
        st.title("Job Search Assistant")
    with hc2:
        if st.button("+ Add JD", type="primary", use_container_width=True):
            nav_to_new_job()

    # ── Filters ───────────────────────────────────────────────────────────────
    fc1, fc2, fc3 = st.columns(3)
    with fc1:
        status_filter = st.selectbox(
            "Status",
            ["Active (default)", "All", "Closed only"],
            key="home_status_filter",
        )
    with fc2:
        company_filter = st.text_input(
            "Company", key="home_company_filter", placeholder="Filter by company…"
        )
    with fc3:
        recruiter_filter = st.text_input(
            "Recruiter / Agency",
            key="home_recruiter_filter",
            placeholder="Filter by recruiting company…",
        )

    # ── Load jobs ─────────────────────────────────────────────────────────────
    try:
        jobs = engine.parse_tracker()
    except Exception as e:
        st.error(f"Failed to load tracker: {e}")
        return

    if not jobs:
        st.info("No applications found in tracker.")
        return

    # ── Apply filters ─────────────────────────────────────────────────────────
    filtered = []
    for job in jobs:
        closed = _is_closed(job["status"])
        if status_filter == "Active (default)" and closed:
            continue
        if status_filter == "Closed only" and not closed:
            continue
        cf = company_filter.lower()
        if cf and cf not in job["company"].lower() and cf not in job.get("company_raw", "").lower():
            continue
        rf = recruiter_filter.lower()
        if rf and rf not in job.get("recruiter", "").lower():
            continue
        filtered.append(job)

    st.caption(f"{len(filtered)} application{'s' if len(filtered) != 1 else ''}")

    # ── Table header ──────────────────────────────────────────────────────────
    processes = engine.list_processes()
    proc_display_names = [p["display_name"] for p in processes]
    proc_map = {p["display_name"]: p for p in processes}

    COLS = [1.3, 2.2, 2.8, 2.5, 2.0, 0.8, 2.8, 1.6]
    hd = st.columns(COLS)
    for col, label in zip(
        hd, ["**Date**", "**Company**", "**Role**", "**Profile**", "**Status**", "**★**", "**Process**", "**Actions**"]
    ):
        col.markdown(label)
    st.divider()

    # ── Rows ─────────────────────────────────────────────────────────────────
    for i, job in enumerate(filtered):
        cd, cc, cr, cp, cs, cpr, cproc, cact = st.columns(COLS)

        with cd:
            date_str = job["date"]
            # Trim to YYYY-MM-DD if full ISO date
            if len(date_str) >= 10 and date_str[4] == "-":
                # Show MM-DD only to save space
                date_str = date_str[5:10]
            st.caption(date_str)

        with cc:
            st.markdown(job["company"])
            if job.get("recruiter"):
                st.caption(f"via {job['recruiter']}")

        with cr:
            st.markdown(job["role"])

        with cp:
            profile = job.get("profile", "")
            st.caption(profile[:38] + "…" if len(profile) > 38 else profile)

        with cs:
            status = job["status"]
            em = _status_emoji(status)
            st.caption(f"{em} {status}" if em else status)

        with cpr:
            st.markdown(job.get("priority", ""))

        with cproc:
            default_idx = _default_process_idx(job["status"], processes)
            sel_key = f"psel_{i}"
            st.selectbox(
                "proc",
                proc_display_names,
                index=default_idx,
                key=sel_key,
                label_visibility="collapsed",
            )

        with cact:
            oc, gc = st.columns(2)
            with oc:
                if st.button("Open", key=f"open_{i}", use_container_width=True):
                    nav_to_job(job)
            with gc:
                if st.button("→", key=f"go_{i}", use_container_width=True, help="Open with selected process"):
                    chosen_display = st.session_state.get(sel_key, proc_display_names[0])
                    nav_to_job(job, process=proc_map.get(chosen_display))

        # Subtle divider between rows (no full st.divider to keep it compact)
        st.markdown(
            "<hr style='margin:2px 0;border:none;border-top:1px solid #eee'>",
            unsafe_allow_html=True,
        )


# ─── Router ───────────────────────────────────────────────────────────────────

if st.session_state.page == "home":
    render_home_page()
else:
    render_job_page()
