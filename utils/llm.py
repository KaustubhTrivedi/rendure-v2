"""
llm.py — LangChain BaseLLM wrappers for the pipeline.

Supports two providers:
  - OpenRouter (default): uses OPENROUTER_API_KEY env var
  - Codex OAuth: uses ChatGPT Plus/Pro OAuth tokens from ~/.codex/auth.json

Usage:
    from utils.llm import load_llm

    llm = load_llm(temperature=0.1, max_tokens=8192)
    response = llm.invoke("Your prompt here")

Environment variables:
    LLM_PROVIDER        — "openrouter" (default) or "codex-oauth"
    OPENROUTER_API_KEY   — Required when provider is openrouter
    OPENROUTER_MODEL     — Model identifier (default: qwen/qwen3.5-9b)
    CODEX_AUTH_FILE      — Path to auth.json (default: ~/.codex/auth.json)
    CODEX_DEFAULT_MODEL  — Model for Codex OAuth (default: gpt-4o)
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, List, Optional

import httpx
from langchain_core.language_models.llms import BaseLLM
from langchain_core.outputs import Generation, LLMResult

DEFAULT_MODEL = "qwen/qwen3.5-9b"
_openrouter_mod = None


def _get_openrouter():
    global _openrouter_mod
    if _openrouter_mod is None:
        from openrouter import OpenRouter
        _openrouter_mod = OpenRouter
    return _openrouter_mod
DEFAULT_CODEX_MODEL = "gpt-4o"
CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token"
CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
REFRESH_MARGIN_SECONDS = 5 * 60


def _fix_json_newlines(text: str) -> str:
    """Escape bare newlines/CRs inside JSON string values.

    Some LLMs emit literal newlines in string values, producing invalid JSON.
    Walks the text character-by-character, tracks string context (honouring
    backslash escapes), and replaces raw \\n/\\r with \\\\n/\\\\r.
    """
    result: list[str] = []
    in_string = False
    i = 0
    while i < len(text):
        c = text[i]
        if c == "\\" and in_string:
            result.append(c)
            i += 1
            if i < len(text):
                result.append(text[i])
        elif c == '"':
            in_string = not in_string
            result.append(c)
        elif c == "\n" and in_string:
            result.append("\\n")
        elif c == "\r" and in_string:
            result.append("\\r")
        else:
            result.append(c)
        i += 1
    return "".join(result)


def extract_json(text: str) -> dict:
    """Extract the first JSON object from LLM output.

    Handles:
    - Markdown code fences (```json ... ```)
    - <think>...</think> reasoning blocks (Qwen3, DeepSeek-R1, Nemotron-Super, etc.)
    - Unescaped newlines/CRs inside JSON string values
    """
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    text = _fix_json_newlines(text)
    start = text.find("{")
    if start == -1:
        raise ValueError(f"No JSON object found in LLM output: {text[:300]}")
    try:
        obj, _ = json.JSONDecoder().raw_decode(text, start)
        return obj
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse JSON from LLM output: {e}\nRaw: {text[:300]}") from e


class OpenRouterLLM(BaseLLM):
    """LangChain BaseLLM wrapper for the OpenRouter API."""

    model_name: str = DEFAULT_MODEL
    temperature: float = 0.1
    max_tokens: int = 8192
    # reasoning_effort: "high" | "medium" | "low" | "none" | None
    #   "none"  → pass reasoning:{"effort":"none"} (disables thinking for Qwen3, etc.)
    #   "high" / "medium" / "low" → pass reasoning:{"effort": value} (enables reasoning)
    #   None    → omit the reasoning field entirely (model default)
    reasoning_effort: Optional[str] = None
    # reasoning_budget_tokens: explicit token budget for reasoning (takes precedence over effort)
    reasoning_budget_tokens: Optional[int] = None

    @property
    def _llm_type(self) -> str:
        return "openrouter"

    def _call(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> str:
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise RuntimeError("OPENROUTER_API_KEY environment variable is not set.")
        send_kwargs: dict = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        if stop:
            send_kwargs["stop"] = stop
        if self.reasoning_budget_tokens is not None:
            send_kwargs["reasoning"] = {"max_tokens": self.reasoning_budget_tokens}
        elif self.reasoning_effort is not None:
            send_kwargs["reasoning"] = {"effort": self.reasoning_effort}
        OpenRouter = _get_openrouter()
        with OpenRouter(api_key=api_key) as client:
            response = client.chat.send(**send_kwargs)
        choice = response.choices[0]
        content = choice.message.content
        # Some reasoning models (e.g. deepseek-r1, qwen3) return None or ""
        # for content and put their output in a separate reasoning_content field.
        if not content:
            content = getattr(choice.message, "reasoning_content", None) or ""
        if not isinstance(content, str):
            raise RuntimeError(
                f"OpenRouter returned non-string content: {type(content).__name__!r} "
                f"(finish_reason={getattr(choice, 'finish_reason', '?')})"
            )
        return content

    def _generate(
        self,
        prompts: List[str],
        stop: Optional[List[str]] = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> LLMResult:
        generations = []
        for prompt in prompts:
            text = self._call(prompt, stop=stop, run_manager=run_manager, **kwargs)
            generations.append([Generation(text=text)])
        return LLMResult(generations=generations)


def _resolve_codex_auth_paths(custom_path: str | None = None) -> list[str]:
    """Return candidate paths for auth.json, in priority order."""
    home = Path.home()
    candidates = []
    if custom_path:
        candidates.append(custom_path)
    env_home = os.environ.get("CHATGPT_LOCAL_HOME")
    codex_home = os.environ.get("CODEX_HOME")
    if env_home:
        candidates.append(str(Path(env_home) / "auth.json"))
    if codex_home:
        candidates.append(str(Path(codex_home) / "auth.json"))
    candidates.append(str(home / ".chatgpt-local" / "auth.json"))
    candidates.append(str(home / ".codex" / "auth.json"))
    seen: set[str] = set()
    unique: list[str] = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    return unique


def _decode_jwt_exp(token: str) -> int | None:
    """Extract exp claim from a JWT without verification."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = parts[1]
        padding = (-len(payload) % 4 + 4) % 4
        decoded = json.loads(
            __import__("base64").urlsafe_b64decode(payload + "=" * padding)
        )
        exp = decoded.get("exp")
        return int(exp) if exp is not None else None
    except Exception:
        return None


def _derive_account_id(id_token: str | None) -> str | None:
    """Extract chatgpt_account_id from an OpenAI id_token."""
    if not id_token:
        return None
    parts = id_token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = parts[1]
        padding = (-len(payload) % 4 + 4) % 4
        decoded = json.loads(
            __import__("base64").urlsafe_b64decode(payload + "=" * padding)
        )
        auth_claim = decoded.get("https://api.openai.com/auth", {})
        aid = auth_claim.get("chatgpt_account_id")
        return aid if isinstance(aid, str) and aid else None
    except Exception:
        return None


class _CodexTokenManager:
    """Reads, caches, and refreshes Codex OAuth tokens."""

    def __init__(self, auth_file_path: str | None = None):
        self._custom_path = auth_file_path or os.environ.get("CODEX_AUTH_FILE")
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._id_token: str | None = None
        self._account_id: str | None = None
        self._source_path: str | None = None
        self._loaded = False

    def _load(self) -> None:
        candidates = _resolve_codex_auth_paths(self._custom_path)
        for path in candidates:
            try:
                with open(path) as f:
                    data = json.load(f)
                tokens = data.get("tokens", {})
                self._access_token = tokens.get("access_token")
                self._refresh_token = tokens.get("refresh_token")
                self._id_token = tokens.get("id_token")
                self._account_id = tokens.get("account_id") or _derive_account_id(self._id_token)
                self._source_path = path
                self._loaded = True
                return
            except (FileNotFoundError, json.JSONDecodeError, KeyError):
                continue
        raise RuntimeError(
            f"Codex auth.json not found. Searched: {candidates}. "
            "Run `npx @openai/codex login` to authenticate."
        )

    def _needs_refresh(self) -> bool:
        if not self._access_token:
            return True
        exp = _decode_jwt_exp(self._access_token)
        if exp is None:
            return False
        return exp <= int(time.time()) + REFRESH_MARGIN_SECONDS

    def _refresh(self) -> None:
        if not self._refresh_token:
            raise RuntimeError(
                "Codex access token expired and no refresh_token available. "
                "Run `npx @openai/codex login` to re-authenticate."
            )
        resp = httpx.post(
            CODEX_TOKEN_URL,
            json={
                "grant_type": "refresh_token",
                "refresh_token": self._refresh_token,
                "client_id": CODEX_CLIENT_ID,
                "scope": "openid profile email offline_access",
            },
            headers={"Content-Type": "application/json"},
            timeout=30,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Codex token refresh failed ({resp.status_code}): {resp.text[:200]}"
            )
        payload = resp.json()
        self._access_token = payload["access_token"]
        self._id_token = payload.get("id_token", self._id_token)
        self._refresh_token = payload.get("refresh_token", self._refresh_token)
        self._account_id = _derive_account_id(self._id_token) or self._account_id

        if self._source_path:
            try:
                with open(self._source_path) as f:
                    data = json.load(f)
                data["tokens"] = {
                    "access_token": self._access_token,
                    "id_token": self._id_token,
                    "refresh_token": self._refresh_token,
                    "account_id": self._account_id,
                }
                data["last_refresh"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                p = Path(self._source_path)
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(data, indent=2))
                p.chmod(0o600)
            except Exception:
                pass

    def ensure_valid(self) -> tuple[str, str]:
        """Return (access_token, account_id), refreshing if needed."""
        if not self._loaded:
            self._load()
        if self._needs_refresh():
            self._refresh()
        if not self._access_token:
            raise RuntimeError("No valid Codex access token.")
        if not self._account_id:
            raise RuntimeError(
                "No account_id in Codex auth. Run `npx @openai/codex login`."
            )
        return self._access_token, self._account_id


class CodexOAuthLLM(BaseLLM):
    """LangChain BaseLLM wrapper for OpenAI Codex OAuth (ChatGPT Plus/Pro)."""

    model_name: str = DEFAULT_CODEX_MODEL
    temperature: float = 0.1
    max_tokens: int = 8192
    auth_file_path: Optional[str] = None
    reasoning_effort: Optional[str] = None

    _token_manager: _CodexTokenManager | None = None

    class Config:
        underscore_attrs_are_private = True

    def _get_token_manager(self) -> _CodexTokenManager:
        if self._token_manager is None:
            self._token_manager = _CodexTokenManager(self.auth_file_path)
        return self._token_manager

    @property
    def _llm_type(self) -> str:
        return "codex-oauth"

    def _call(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> str:
        access_token, account_id = self._get_token_manager().ensure_valid()

        body: dict[str, Any] = {
            "model": self.model_name,
            "input": prompt,
            "instructions": "",
            "stream": False,
            "store": False,
        }
        if self.temperature is not None:
            body["temperature"] = self.temperature
        if self.max_tokens is not None:
            body["max_output_tokens"] = self.max_tokens
        if self.reasoning_effort and self.reasoning_effort != "none":
            body["reasoning"] = {"effort": self.reasoning_effort}

        resp = httpx.post(
            f"{CODEX_BASE_URL}/responses",
            json=body,
            headers={
                "Authorization": f"Bearer {access_token}",
                "chatgpt-account-id": account_id,
                "OpenAI-Beta": "responses=experimental",
                "Content-Type": "application/json",
            },
            timeout=300,
        )

        if resp.status_code == 401:
            self._get_token_manager()._refresh()
            access_token, account_id = self._get_token_manager().ensure_valid()
            resp = httpx.post(
                f"{CODEX_BASE_URL}/responses",
                json=body,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "chatgpt-account-id": account_id,
                    "OpenAI-Beta": "responses=experimental",
                    "Content-Type": "application/json",
                },
                timeout=300,
            )

        if resp.status_code != 200:
            raise RuntimeError(
                f"Codex API error ({resp.status_code}): {resp.text[:500]}"
            )

        data = resp.json()
        output = data.get("output", [])
        for item in output:
            if item.get("type") == "message":
                content_parts = item.get("content", [])
                for part in content_parts:
                    if part.get("type") == "output_text":
                        return part.get("text", "")
        text = data.get("output_text")
        if isinstance(text, str):
            return text
        raise RuntimeError(
            f"Unexpected Codex response structure: {json.dumps(data)[:500]}"
        )

    def _generate(
        self,
        prompts: List[str],
        stop: Optional[List[str]] = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> LLMResult:
        generations = []
        for prompt in prompts:
            text = self._call(prompt, stop=stop, run_manager=run_manager, **kwargs)
            generations.append([Generation(text=text)])
        return LLMResult(generations=generations)


def load_llm(
    model_name: str | None = None,
    temperature: float = 0.1,
    max_tokens: int = 8192,
    reasoning_effort: str | None = None,
    reasoning_budget_tokens: int | None = None,
    provider: str | None = None,
) -> BaseLLM:
    """
    Create and return an LLM instance based on the configured provider.

    Provider resolution: provider arg → LLM_PROVIDER env var → "openrouter"

    For openrouter: model defaults to OPENROUTER_MODEL env var → "qwen/qwen3.5-9b"
    For codex-oauth: model defaults to CODEX_DEFAULT_MODEL env var → "gpt-4o"
    """
    resolved_provider = provider or os.getenv("LLM_PROVIDER", "openrouter")

    if resolved_provider == "codex-oauth":
        resolved_model = model_name or os.getenv("CODEX_DEFAULT_MODEL", DEFAULT_CODEX_MODEL)
        return CodexOAuthLLM(
            model_name=resolved_model,
            temperature=temperature,
            max_tokens=max_tokens,
            auth_file_path=os.environ.get("CODEX_AUTH_FILE"),
            reasoning_effort=reasoning_effort,
        )

    resolved_model = model_name or os.getenv("OPENROUTER_MODEL", DEFAULT_MODEL)
    return OpenRouterLLM(
        model_name=resolved_model,
        temperature=temperature,
        max_tokens=max_tokens,
        reasoning_effort=reasoning_effort,
        reasoning_budget_tokens=reasoning_budget_tokens,
    )
