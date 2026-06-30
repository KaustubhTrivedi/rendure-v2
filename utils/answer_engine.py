from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from utils.llm import load_llm

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class AnswerEngine:
    def __init__(
        self,
        path: str | Path = PROJECT_ROOT / "answers.yaml",
        llm: Any | None = None,
        model_name: str | None = None,
    ) -> None:
        self.path = Path(path)
        if not self.path.exists():
            raise FileNotFoundError(self.path)

        data = yaml.safe_load(self.path.read_text()) or {}
        stock_answers = data.get("stock_answers") or {}
        if not isinstance(stock_answers, dict):
            raise ValueError("answers.yaml stock_answers must be a mapping")

        persona_context = data.get("persona_context") or ""
        if not isinstance(persona_context, str):
            raise ValueError("answers.yaml persona_context must be a string")

        self.stock_answers = stock_answers
        self.persona_context = persona_context
        self._llm = llm
        self._model_name = model_name

    def lookup(self, question: str, resume_content: str = "", jd_text: str = "") -> str:
        normalized_question = question.lower()
        for key, answer in self.stock_answers.items():
            if str(key).lower() in normalized_question:
                return str(answer)

        prompt = self._build_prompt(
            question=question,
            resume_content=resume_content,
            jd_text=jd_text,
        )
        return str(self._get_llm().invoke(prompt)).strip()

    def _get_llm(self) -> Any:
        if self._llm is None:
            self._llm = load_llm(
                model_name=self._model_name,
                temperature=0.1,
                max_tokens=512,
            )
        return self._llm

    def _build_prompt(self, question: str, resume_content: str, jd_text: str) -> str:
        return (
            "Answer this job application screening question using only the provided context.\n"
            "If the context is insufficient, follow the persona guidance and avoid fabrication.\n\n"
            f"Persona guidance:\n{self.persona_context}\n\n"
            f"Question:\n{question}\n\n"
            f"Resume content:\n{resume_content[:3000]}\n\n"
            f"Job description:\n{jd_text[:2000]}\n\n"
            "Return only the concise answer text."
        )
