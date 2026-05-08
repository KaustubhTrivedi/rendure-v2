"""
llm.py — LangChain BaseLLM wrapper for the OpenRouter API.

Wraps the OpenRouter Python SDK to provide a LangChain-compatible LLM interface
used by all agents in the pipeline.

Usage:
    from utils.llm import load_llm

    llm = load_llm(temperature=0.1, max_tokens=8192)
    response = llm.invoke("Your prompt here")

Environment variables:
    OPENROUTER_API_KEY  — Required. Your OpenRouter API key.
    OPENROUTER_MODEL    — Model identifier (default: qwen/qwen3.5-9b)
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, List, Optional

from openrouter import OpenRouter
from langchain_core.language_models.llms import BaseLLM
from langchain_core.outputs import Generation, LLMResult

DEFAULT_MODEL = "qwen/qwen3.5-9b"


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


def load_llm(
    model_name: str | None = None,
    temperature: float = 0.1,
    max_tokens: int = 8192,
    reasoning_effort: str | None = None,
    reasoning_budget_tokens: int | None = None,
) -> OpenRouterLLM:
    """
    Create and return an OpenRouterLLM instance.

    Args:
        model_name:              OpenRouter model identifier (e.g. 'qwen/qwen3-8b').
                                 Falls back to OPENROUTER_MODEL env var, then 'qwen/qwen3.5-9b'.
        temperature:             Sampling temperature (0.0–1.0).
        max_tokens:              Maximum output tokens (includes reasoning tokens for thinking models).
        reasoning_effort:        "high" | "medium" | "low" | "none" | None.
                                 Controls the reasoning field sent to OpenRouter.
                                 None omits the field (model default, no explicit reasoning).
                                 "none" explicitly disables thinking (for Qwen3, etc.).
                                 Ignored when reasoning_budget_tokens is set.
        reasoning_budget_tokens: Explicit token budget for reasoning. When set, sends
                                 reasoning:{"max_tokens": N} and takes precedence over
                                 reasoning_effort.
    """
    resolved_model = model_name or os.getenv("OPENROUTER_MODEL", DEFAULT_MODEL)
    return OpenRouterLLM(
        model_name=resolved_model,
        temperature=temperature,
        max_tokens=max_tokens,
        reasoning_effort=reasoning_effort,
        reasoning_budget_tokens=reasoning_budget_tokens,
    )
