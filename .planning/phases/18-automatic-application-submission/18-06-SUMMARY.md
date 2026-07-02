---
phase: 18-automatic-application-submission
plan: 06
status: complete
completed_at: 2026-06-30
executor: codex-generic-agent-workaround
---

# Plan 18-06 Summary

## Outcome

Implemented the portal router dispatch point and wired it behind explicit
`auto_apply` / `--auto-apply` opt-in.

## Task Commits

- `eb2f934` - `test(18-06): add failing tests for portal_router.run()`
- `ad4e82d` - `feat(18-06): implement portal_router, orchestrator wiring, --auto-apply flag`

## Changed Files

- `agents/portal_router.py`
- `agents/spec/portal-router.md`
- `agents/orchestrator.py`
- `run_agents.py`
- `agents/__init__.py`
- `tests/test_portal_router.py`

## Verification

- `uv run pytest tests/test_portal_router.py --tb=short 2>&1 | grep -E "ERROR|FAILED|ImportError|ModuleNotFoundError" | head -5`
  - RED passed: reported `ModuleNotFoundError: No module named 'agents.portal_router'`.
- `uv run pytest tests/test_portal_router.py -v`
  - PASS: 8 passed, 2 warnings.
- `uv run pytest tests/ -v --tb=short`
  - PASS: 164 passed, 2 warnings.
- `uv run python run_agents.py --help | grep -i "auto-apply"`
  - PASS: help includes `--auto-apply`.
- `uv run python -c "from agents import run_portal_router; print('OK')"`
  - PASS: printed `OK`.
- `uv run python -c "from agents.orchestrator import run; import inspect; sig = inspect.signature(run); assert 'auto_apply' in sig.parameters; print('OK')"`
  - PASS: printed `OK`.

## Deviations

- None from the requested scope.
- Implementation note: `portal_router.py` resolves dispatch targets at call time so
  tests and future monkeypatching can replace module-level portal aliases without
  accidentally calling the real portal agents.

## Self-Check: PASSED

- Explicit opt-in preserved: `auto_apply` defaults to `False`; `run_agents.py` only
  passes `True` when `--auto-apply` is present.
- Unsupported ATS handling sets `submission_failed`, writes `pipeline_events`, and
  does not call portal agents.
- `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified by this plan.
