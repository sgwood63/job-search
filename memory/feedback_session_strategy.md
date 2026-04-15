---
name: Session Strategy — Short Scoped Sessions
description: Use short task-scoped Claude Code sessions, not one long session. Memory files carry context across sessions.
type: feedback
originSessionId: 6d481a27-2bbf-40d8-a734-b1dc20abff39
---
One long Claude Code session degrades after repeated context compression — summaries lose nuance, rules get forgotten, behavior drifts.

**Rule**: Use short, focused sessions scoped to one task (one application, one interview prep, one memory update). End sessions when the task is done.

**Why:** Context window fills fast with tool calls and file reads. Auto-compression produces lossy summaries. Multiple compressions in one session compound the degradation.

**What survives session boundaries**: Everything in MEMORY.md and the individual memory files. The memory system was built for exactly this — it's reliable across sessions.

**What doesn't survive without help**: In-progress work state, mid-session corrections not yet saved to memory, contextual reasoning built up during the session.

**How to apply:**
- Start a new session per task rather than continuing an old long one
- Before ending a session, save anything important that isn't already in memory files
- If something important came up mid-session, explicitly write a memory file before closing
- The app/ being built will enforce this pattern structurally — each sub-process is a fresh API call
