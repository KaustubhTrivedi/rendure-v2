# Graph Report - /Users/kaustubhtrivedi/Projects/jobs-tracker  (2026-05-09)

## Corpus Check
- 18 files · ~28,433 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 123 nodes · 182 edges · 11 communities detected
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]

## God Nodes (most connected - your core abstractions)
1. `run()` - 13 edges
2. `run()` - 13 edges
3. `run()` - 10 edges
4. `run()` - 9 edges
5. `_notify()` - 8 edges
6. `_handle_agent_error()` - 8 edges
7. `load_llm()` - 7 edges
8. `_process_jd_text()` - 6 edges
9. `OpenRouterLLM` - 6 edges
10. `run()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `run()`  [INFERRED]
  /Users/kaustubhtrivedi/Projects/jobs-tracker/run_agents.py → /Users/kaustubhtrivedi/Projects/jobs-tracker/agents/quality_analyst.py
- `run()` --calls--> `load_llm()`  [INFERRED]
  /Users/kaustubhtrivedi/Projects/jobs-tracker/agents/resume_tailor.py → /Users/kaustubhtrivedi/Projects/jobs-tracker/utils/llm.py
- `run()` --calls--> `load_llm()`  [INFERRED]
  /Users/kaustubhtrivedi/Projects/jobs-tracker/agents/job_scout.py → /Users/kaustubhtrivedi/Projects/jobs-tracker/utils/llm.py
- `run()` --calls--> `extract_json()`  [INFERRED]
  /Users/kaustubhtrivedi/Projects/jobs-tracker/agents/job_scout.py → /Users/kaustubhtrivedi/Projects/jobs-tracker/utils/llm.py
- `_process_jd_text()` --calls--> `load_llm()`  [INFERRED]
  /Users/kaustubhtrivedi/Projects/jobs-tracker/agents/orchestrator.py → /Users/kaustubhtrivedi/Projects/jobs-tracker/utils/llm.py

## Communities

### Community 0 - "Community 0"
Cohesion: 0.14
Nodes (27): _export_and_build_pdf(), _extract_json_from_text(), _get_conn(), _handle_agent_error(), _handle_pipeline_error(), _is_model_error(), _log_event(), _notify() (+19 more)

### Community 1 - "Community 1"
Cohesion: 0.15
Nodes (15): AgentError, _get_conn(), _notify(), Resume Tailor Agent — reads job description from DB, rewrites the resume Markdow, Dual-mode: always print for CLI, also call event_callback for web., Tailor the resume for the given job_id.     Returns {"outcome": "success", "job_, run(), _write_error_event() (+7 more)

### Community 2 - "Community 2"
Cohesion: 0.17
Nodes (14): AgentError, _compute_composite(), _get_conn(), _load_hard_constraints(), _notify(), Quality Analyst Agent — evaluates a tailored resume against the job description, Compute 6-dimension composite score.      Formula (weights sum to 1.00):       k, Load the candidate hard constraints. Returns empty string if missing (non-fatal (+6 more)

### Community 3 - "Community 3"
Cohesion: 0.2
Nodes (14): AgentError, _check_injection(), _get_conn(), _notify(), Job Scout Agent — scrapes a job posting URL, extracts structured fields via LLM,, Return True if the page contains likely prompt-injection content., Dual-mode: always print for CLI, also call event_callback for web., Scrape job_url, extract structured fields, write to DB.     Returns {"outcome": (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.18
Nodes (10): BaseLLM, extract_json(), _fix_json_newlines(), load_llm(), OpenRouterLLM, llm.py — LangChain BaseLLM wrapper for the OpenRouter API.  Wraps the OpenRouter, Create and return an OpenRouterLLM instance.      Args:         model_name:, Escape bare newlines/CRs inside JSON string values.      Some LLMs emit literal (+2 more)

### Community 5 - "Community 5"
Cohesion: 0.36
Nodes (7): decrypt(), encrypt(), _load_key(), loadKey(), crypto.py — AES-256-GCM encryption helpers for sensitive profile fields.  The en, Encrypt a string and return a base64-encoded nonce+ciphertext blob., Decrypt a base64-encoded nonce+ciphertext blob and return the plaintext.

### Community 6 - "Community 6"
Cohesion: 0.36
Nodes (7): AgentError, _get_conn(), _notify(), Confirmation Agent — final agent in the pipeline. Reads the approved job record,, Dual-mode: always print for CLI, also call event_callback for web., Verify the approved job record and assemble a completion payload.     Returns th, run()

### Community 7 - "Community 7"
Cohesion: 0.29
Nodes (1): first_test.py – Smoke-test for the OpenRouter + LangChain setup.  Run with:

### Community 8 - "Community 8"
Cohesion: 0.38
Nodes (0): 

### Community 9 - "Community 9"
Cohesion: 1.0
Nodes (0): 

### Community 10 - "Community 10"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **41 isolated node(s):** `CLI entry point for the Jobs Agency pipeline.  Usage:     uv run python run_agen`, `first_test.py – Smoke-test for the OpenRouter + LangChain setup.  Run with:`, `Resume Tailor Agent — reads job description from DB, rewrites the resume Markdow`, `Dual-mode: always print for CLI, also call event_callback for web.`, `Tailor the resume for the given job_id.     Returns {"outcome": "success", "job_` (+36 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 9`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 10`** (1 nodes): `app.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `load_llm()` connect `Community 4` to `Community 0`, `Community 1`, `Community 2`, `Community 3`?**
  _High betweenness centrality (0.420) - this node is a cross-community bridge._
- **Why does `_process_jd_text()` connect `Community 0` to `Community 4`?**
  _High betweenness centrality (0.319) - this node is a cross-community bridge._
- **Why does `run()` connect `Community 2` to `Community 1`, `Community 4`?**
  _High betweenness centrality (0.254) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `run()` (e.g. with `main()` and `load_llm()`) actually correct?**
  _`run()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `run()` (e.g. with `load_llm()` and `extract_json()`) actually correct?**
  _`run()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `run()` (e.g. with `toon_table()` and `load_llm()`) actually correct?**
  _`run()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `CLI entry point for the Jobs Agency pipeline.  Usage:     uv run python run_agen`, `first_test.py – Smoke-test for the OpenRouter + LangChain setup.  Run with:`, `Resume Tailor Agent — reads job description from DB, rewrites the resume Markdow` to the rest of the system?**
  _41 weakly-connected nodes found - possible documentation gaps or missing edges._