"""
first_test.py – Smoke-test for the OpenRouter + LangChain setup.

Run with:
    python first_test.py

Make sure OPENROUTER_API_KEY is set in your .env or environment.
"""

import os
import sys

# ── Path setup ────────────────────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
from utils.llm import load_llm, DEFAULT_MODEL

load_dotenv()

# ── ANSI colours ──────────────────────────────────────────────────────────────
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def ok(msg):   print(f"  {GREEN}✓{RESET} {msg}")
def warn(msg): print(f"  {YELLOW}⚠{RESET}  {msg}")
def fail(msg): print(f"  {RED}✗{RESET} {msg}")
def info(msg): print(f"  {CYAN}ℹ{RESET}  {msg}")
def section(title):
    print(f"\n{BOLD}{title}{RESET}")
    print("  " + "─" * 50)


# ════════════════════════════════════════════════════════════════════════════════
# 1. Environment variables
# ════════════════════════════════════════════════════════════════════════════════
section("1 · Environment")

api_key = os.getenv("OPENROUTER_API_KEY")
model_name = os.getenv("OPENROUTER_MODEL", DEFAULT_MODEL)

if api_key:
    ok(f"OPENROUTER_API_KEY : set (ends …{api_key[-4:]})")
else:
    fail("OPENROUTER_API_KEY is not set — add it to your .env file.")
    sys.exit(1)

if os.getenv("OPENROUTER_MODEL"):
    ok(f"OPENROUTER_MODEL   : {model_name}")
else:
    info(f"OPENROUTER_MODEL not set — using default: {model_name}")


# ════════════════════════════════════════════════════════════════════════════════
# 2. OpenRouter API reachability
# ════════════════════════════════════════════════════════════════════════════════
section("2 · OpenRouter API reachability")

import requests as _requests

try:
    resp = _requests.get(
        "https://openrouter.ai/api/v1/models",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    model_ids = [m.get("id", "?") for m in data.get("data", [])]
    ok(f"OpenRouter API reachable ({len(model_ids)} models available)")
    if model_name in model_ids:
        ok(f"Target model '{model_name}' is available")
    else:
        warn(f"Target model '{model_name}' not found in model list — check OPENROUTER_MODEL.")
except _requests.exceptions.ConnectionError:
    fail("Cannot connect to openrouter.ai — check your network connection.")
    sys.exit(1)
except Exception as exc:
    fail(f"API reachability check failed: {exc}")
    sys.exit(1)


# ════════════════════════════════════════════════════════════════════════════════
# 3. LLM initialisation
# ════════════════════════════════════════════════════════════════════════════════
section("3 · LLM initialisation")

try:
    llm = load_llm(temperature=0.7, max_tokens=256)
    ok("OpenRouterLLM loaded successfully")
except Exception as exc:
    fail(f"Failed to load LLM: {exc}")
    sys.exit(1)

info(f"Model      : {llm.model_name}")
info(f"Max tokens : {llm.max_tokens}")
info(f"Temperature: {llm.temperature}")


# ════════════════════════════════════════════════════════════════════════════════
# 4. Live API call
# ════════════════════════════════════════════════════════════════════════════════
section("4 · Live API call")

PROMPT = "Reply with exactly one sentence confirming you are working correctly."

print(f"  Prompt: {PROMPT!r}\n")

try:
    response = llm.invoke(PROMPT)
    ok("API call succeeded")
    print(f"\n  {BOLD}Response:{RESET}")
    for line in str(response).splitlines():
        print(f"    {line}")
except Exception as exc:
    fail(f"API call failed: {exc}")
    hint = str(exc)
    if "OPENROUTER_API_KEY" in hint or "401" in hint or "403" in hint:
        warn("Authentication error — check that OPENROUTER_API_KEY is valid.")
    elif "429" in hint:
        warn("Rate limit hit — wait a moment and retry.")
    elif "Connection" in hint or "refused" in hint.lower():
        warn("Connection error — check your network connection.")
    sys.exit(1)


# ════════════════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════════════════
print(f"\n{BOLD}{GREEN}All checks passed.{RESET} Your OpenRouter setup is working correctly.\n")
