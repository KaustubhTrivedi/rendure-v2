---
phase: 18-automatic-application-submission
plan: 02
subsystem: utilities
tags: [answer-engine, rendercv, yaml, llm, pytest]

requires:
  - phase: 18-automatic-application-submission
    provides: Phase 18 context and utility contracts for auto-apply portal agents
provides:
  - AnswerEngine stock answer lookup with LLM fallback prompt context
  - render_resume_to_pdf utility for RenderCV YAML to PDF bytes
  - answers.yaml screening answer template
affects: [automatic-application-submission, portal-agents, screening-questions, resume-rendering]

tech-stack:
  added: []
  patterns: [lazy LLM instantiation, PATH-checked subprocess wrapper, temp-file cleanup]

key-files:
  created:
    - answers.yaml
    - utils/answer_engine.py
    - utils/resume_render.py
    - tests/utils/test_answer_engine.py
    - tests/utils/test_resume_render.py
  modified: []

key-decisions:
  - "Stock answers use case-insensitive key substring matching in YAML order."
  - "AnswerEngine creates the LLM lazily only when no stock answer matches."
  - "render_resume_to_pdf returns PDF bytes and cleans up temporary YAML files in finally blocks."

patterns-established:
  - "Question answering: answers.yaml stock_answers first, then persona_context plus resume and JD prompt fallback."
  - "RenderCV invocation: check shutil.which('rendercv') before subprocess.run(['rendercv', 'render', yaml_path])."

requirements-completed: [ANSWER-ENGINE-01, RESUME-RENDER-01]

duration: 17min
completed: 2026-06-30
status: complete
---

# Phase 18-02: Answer Engine and Resume Rendering Summary

**Screening answer lookup and RenderCV PDF byte rendering utilities for opt-in portal submissions**

## Performance

- **Duration:** 17 min
- **Started:** 2026-06-30T11:04:00Z
- **Completed:** 2026-06-30T11:21:49Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `AnswerEngine.lookup()` with case-insensitive stock-answer substring matching and deterministic YAML-order priority.
- Added LLM fallback prompts containing `persona_context`, the question, resume content, and JD text while keeping LLM creation lazy.
- Added `render_resume_to_pdf()` with rendercv PATH validation, subprocess execution, PDF-byte return, and temporary YAML cleanup.
- Added `answers.yaml` with 10 stock answers and persona guidance for novel screening questions.

## Task Commits

Each task was committed atomically:

1. **Task 1: RED tests for AnswerEngine and render_resume_to_pdf** - `a54b3b1` (test)
2. **Task 2: GREEN implementation and answers.yaml template** - `c116f56` (feat)

**Plan metadata:** this SUMMARY commit

_Note: Adjacent 18-01 commits (`914b411`, `bcd6752`) landed between the 18-02 RED and GREEN commits. They touched separate scope and were left intact._

## Files Created/Modified

- `answers.yaml` - Project-root stock screening answers and persona context.
- `utils/answer_engine.py` - `AnswerEngine` class with stock lookup and LLM fallback.
- `utils/resume_render.py` - `render_resume_to_pdf()` utility around the rendercv CLI.
- `tests/utils/test_answer_engine.py` - Seven behavior tests for stock matching, LLM fallback, prompt contents, and missing YAML.
- `tests/utils/test_resume_render.py` - Five behavior tests for rendercv PATH errors, subprocess args, success bytes, nonzero exit, and cleanup on failure.

## Decisions Made

- Followed the plan's exact YAML shape and default answer set.
- Used `yaml.safe_load()` because PyYAML is already available in the project lockfile.
- Used `tempfile.mkstemp()` plus explicit `os.close()` so the rendercv input file is not left with an implicit open handle.

## Deviations from Plan

None - plan executed within the assigned scope.

## Issues Encountered

- Concurrent 18-01 worker commits appeared between task commits. No conflict occurred because they did not modify the 18-02 owned files.

## Verification

- `uv run pytest tests/utils/test_answer_engine.py tests/utils/test_resume_render.py --tb=short` during RED: failed with `ModuleNotFoundError` for `utils.answer_engine` and `utils.resume_render`, confirming RED.
- `uv run pytest tests/utils/test_answer_engine.py tests/utils/test_resume_render.py -v`: 12 passed, 2 warnings.
- `uv run pytest tests/`: 123 passed, 2 warnings.
- `uv run python -c "from utils.answer_engine import AnswerEngine; print('OK')"`: OK.
- `uv run python -c "from utils.resume_render import render_resume_to_pdf; print('OK')"`: OK.
- `grep "stock_answers" answers.yaml && grep "persona_context" answers.yaml`: both matched.

## User Setup Required

None - no external service configuration required for this utility slice. Runtime environments still need `rendercv` on PATH to render PDFs.

## Next Phase Readiness

Portal agents can now reuse `AnswerEngine` for screening questions and `render_resume_to_pdf()` immediately before upload.

## Self-Check: PASSED

---
*Phase: 18-automatic-application-submission*
*Completed: 2026-06-30*
