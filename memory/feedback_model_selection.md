---
name: Model selection — Opus vs Sonnet; no auto-routing in Claude Code
description: When to use Opus vs Sonnet; opusplan alias for planning sessions; no built-in auto-routing is available
type: feedback
---

Claude Code has no built-in automatic model routing. The model runs for the entire session. The only mechanism available is specifying `model:` on subagents (already used for the Haiku screening agent).

## Default: Sonnet for all operational sessions

Use Sonnet for all normal job search work: JD processing, resume generation, notes.md, tracker updates, profile maintenance, interview prep. The current Haiku-for-screening + Sonnet-for-generation split is already optimal.

**Why:** Resume generation and document work are structured tasks with a known content library as input. Sonnet handles them well. Opus adds no quality gain and costs ~5x more per token.

## Opus for planning and strategic sessions only

Use Opus explicitly when:
- Designing or overhauling the app tooling (dev sessions like this one)
- Career strategy decisions with genuinely ambiguous tradeoffs requiring synthesis across many factors
- Evaluating a novel situation where the outcome depends on connecting non-obvious dots

**The opusplan alias** — start a session with the `opusplan` model when you need Opus-level reasoning for a planning task. This alias uses Opus in plan mode and Sonnet in execution, bounding Opus cost to the planning turn only.

## Cost warning

Opus is approximately 5x the token cost of Sonnet. An extended Opus session generating a full resume would cost 5x more for no quality gain. Extended thinking (if enabled) multiplies cost further — never enable it for document generation tasks.

**Never use Opus for:** Resume generation, notes.md creation, tracker updates, profile content editing, any task with a known content library as input.

## Model switching within a session

You cannot switch the main session model mid-session. If you start in Sonnet and need Opus-level reasoning, open a new session. Subagents can independently specify their model (`model: claude-haiku-4-5`) regardless of the main session model.
