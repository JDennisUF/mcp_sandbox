# Phase 5 MCP Code Review Plan

## Vision
- Deliver a Model Context Protocol server that augments human reviewers inside VS Code with actionable diagnostics, heuristics, and checklists.
- Optimise the flow for small, focused requests triggered from the editor (e.g. "review staged changes" or "assess this diff").
- Produce structured outputs that can be rendered as inline comments, panel summaries, or follow-up tasks.

## Milestones
1. **Server foundation (Week 1)** – finalise TypeScript build, stdio transport wiring, and baseline tool registry (initial version live with collect-context).
2. **Context acquisition (Week 2)** – add tools for gathering git status, diffs, per-file AST metadata, and project configuration.
3. **Analysis engine (Weeks 3-4)** – implement rule sets for risky patterns, test gaps, security smells, and dependency churn; design scoring model.
4. **Feedback orchestration (Week 5)** – group findings into thematic sections, attach remediation guidance, and prepare data contracts for VS Code UI.
5. **Integration polish (Week 6)** – validate with Copilot / MCP client flows, add configuration toggles, and write end-to-end smoke tests.

## Tooling Backlog
- `code-review.collect-context` *(implemented)*
  - Inputs: optional working directory, flags for git status and recent commit inclusion.
  - Output: repository root, branch divergence, staged/unstaged breakdown, optional recent commits.
- `code-review.diff-insights` *(implemented)*
  - Inputs: selection of staged vs working tree, optional path subset, patch inclusion toggle.
  - Output: per-file churn metrics, rename tracking, totals, and optional patch excerpts.
- `code-review.run-heuristics` *(implemented)*
  - Inputs: diff source, optional path focus, churn threshold configuration.
  - Output: categorised findings (risk, testing, dependencies) with actionable reviewer follow-ups.
- `code-review.diff-insights`
  - Inputs: explicit diff or reference to staged changes.
  - Output: per-file change summary, churn metrics, language classification.
- `code-review.run-heuristics`
  - Inputs: diff payload, context token.
  - Output: structured findings with severity, rationale, remediation, and suggested reviewer questions.
- `code-review.summarise`
  - Inputs: findings collection.
  - Output: executive summary, test checklist, follow-up actions.

## Engineering Notes
- Capture git data using child processes (e.g. `git diff --staged`, `git status --porcelain=v2`) with guards for non-git workspaces.
- Employ lightweight static analysis (regex, AST via `@typescript-eslint/typescript-estree`, `esbuild` parser, or language servers) behind feature flags.
- Normalise all tool outputs into JSON schemas to keep client integration deterministic.
- Preserve deterministic logging for reproducibility; emit debug traces behind `MCP_DEBUG` env.

## Validation Strategy
- Unit-test rule evaluators with curated code samples.
- Snapshot-test tool responses for representative diffs.
- Manual end-to-end checks inside VS Code using the MCP Inspector / Bruno STDIO bridge.
- Gather qualitative feedback from at least two review sessions before marking GA.

## Success Criteria
- Server responds to review requests in <3s for typical diffs (<500 LOC changed).
- Findings are grouped by category (correctness, security, maintainability, testing) with actionable remediation text.
- VS Code integration exposes at least two interaction modes: quick summary and detailed checklist.
- Documentation includes setup instructions, CLI examples, and extension configuration notes.