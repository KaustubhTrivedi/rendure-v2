# Contributing to Rendure

Thanks for your interest in contributing. This guide covers everything you need to get started.

## Getting Started

### Prerequisites

- Python 3.12
- `uv` package manager (`pip install uv` or `brew install uv`)
- PostgreSQL
- Docker (only for RenderCV PDF rendering)

### Setup

```bash
# Install dependencies
uv sync

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your database connection and API keys

# Initialise the database
psql $DATABASE_URL -f db/schema.sql

# Authenticate with the LLM gateway (run once)
uv run python main.py

# Verify everything works
uv run python first_test.py
```

Always use `uv` for dependency management — never `pip install` directly.

```bash
# Adding a new package
uv add <package-name>
```

Commit both `pyproject.toml` and `uv.lock` when adding or updating dependencies.

## Making Changes

### Branch Naming

- Features: `feat/<short-description>`
- Bug fixes: `fix/<short-description>`
- Docs: `docs/<short-description>`

### Code Style

- Python 3.12 with type annotations.
- PEP 8. Run `uv run ruff check .` before committing.
- Absolute imports from the project root.
- Keep changes focused — one concern per PR.

### Test-Driven Development

All production code follows TDD with vertical slices:

1. **RED** — Write one failing test for a single behavior.
2. **GREEN** — Write the minimal code to make it pass.
3. **REFACTOR** — Clean up while tests stay green.
4. Repeat.

Do not write all tests first, then all implementation. Work one behavior at a time.

```bash
# Run the full test suite
uv run pytest tests/

# Run a specific test file
uv run pytest tests/test_job_scout.py -v
```

A PR is not ready for review until all tests pass.

### Commit Messages

Write clear, concise commit messages. Use the imperative mood in the subject line.

```
feat: add skill canonicalisation to Job Scout
fix: prevent duplicate job_skills rows on retry
docs: clarify QA scoring formula in CLAUDE.md
test: add coverage for structure_valid gate
```

## Submitting a Pull Request

1. Fork the repo and create your branch from `main`.
2. Make your changes following the conventions above.
3. Ensure `uv run pytest tests/` passes with no failures.
4. Run `uv run ruff check .` and fix any lint issues.
5. Open a PR against `main` with:
   - A clear title describing the change.
   - A description explaining **what** changed and **why**.
   - Steps to test or verify, if applicable.

### What makes a good PR

- **Small and focused.** One logical change per PR. If you find an unrelated issue while working, open a separate PR for it.
- **Tested.** New behavior has tests. Bug fixes include a regression test.
- **Self-contained description.** A reviewer shouldn't need to read the linked issue to understand the PR. Summarise the context.

### Review process

PRs are reviewed for correctness, readability, and adherence to project conventions. Feedback is meant to improve the code, not criticise the author. Be open to suggestions and ask questions if anything is unclear.

## Reporting Issues

Before opening an issue, search existing issues to check it hasn't already been reported.

### Bug Reports

Include:

- What you expected to happen and what actually happened.
- Steps to reproduce (the smallest reliable example you can produce).
- Environment: OS, Docker version, Python version.
- Relevant logs: agent output, `pipeline_events` rows, browser console for frontend issues.
- Job URL or sanitised job description if pipeline-related (redact anything sensitive).

### Feature Requests

Describe the problem you're trying to solve before proposing a solution. "I want to do X but Y gets in the way" is more useful than "add a button that does Z."

### Security Vulnerabilities

**Do not open a public issue.** Email **kaus12tri@gmail.com** with details and reproduction steps. You'll receive a response within 72 hours.

## Architecture Notes

If you're contributing code that touches agents or the pipeline, read [CLAUDE.md](../CLAUDE.md) first. Key things to know:

- **All inter-agent state passes through the database.** Agents don't communicate directly.
- **Sub-agents are ephemeral.** They do their job, write to the DB, and terminate.
- **The Orchestrator owns model fallback.** Sub-agents never implement retry logic.
- **Never write to trigger-owned columns** (`jobs.qa_score`, `jobs.iteration_count`).
- **Never modify `utils/Antigravity.py` or `main.py`** without discussing it first.
- Agent specs in `agents/spec/` are the authoritative contracts — read the relevant spec before modifying an agent.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](.github/CODE_OF_CONDUCT.md). By participating, you agree to uphold it. Report violations to **kaus12tri@gmail.com**.
