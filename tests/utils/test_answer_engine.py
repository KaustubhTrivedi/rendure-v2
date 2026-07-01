from pathlib import Path
from unittest.mock import Mock

import pytest
import yaml

from utils.answer_engine import AnswerEngine


def write_answers_yaml(path: Path, stock_answers: dict[str, str], persona_context: str = "Be concise.") -> Path:
    path.write_text(
        yaml.safe_dump(
            {
                "stock_answers": stock_answers,
                "persona_context": persona_context,
            },
            sort_keys=False,
        )
    )
    return path


def test_answer_engine_returns_stock_answer_on_exact_key_substring_match(tmp_path):
    answers_path = write_answers_yaml(
        tmp_path / "answers.yaml",
        {"authorized to work": "Yes"},
    )
    llm = Mock()

    engine = AnswerEngine(path=answers_path, llm=llm)

    assert engine.lookup("Are you authorized to work in the United States?") == "Yes"
    llm.invoke.assert_not_called()


def test_answer_engine_match_is_case_insensitive(tmp_path):
    answers_path = write_answers_yaml(
        tmp_path / "answers.yaml",
        {"Salary Expectations": "Negotiable"},
    )

    engine = AnswerEngine(path=answers_path, llm=Mock())

    assert engine.lookup("what are your salary expectations?") == "Negotiable"


def test_answer_engine_returns_first_matching_key_when_multiple_partial_matches(tmp_path):
    answers_path = write_answers_yaml(
        tmp_path / "answers.yaml",
        {
            "work": "First match",
            "authorized to work": "Second match",
        },
    )

    engine = AnswerEngine(path=answers_path, llm=Mock())

    assert engine.lookup("Are you authorized to work in the United States?") == "First match"


def test_answer_engine_falls_back_to_llm_when_no_key_matches(tmp_path):
    answers_path = write_answers_yaml(
        tmp_path / "answers.yaml",
        {"authorized to work": "Yes"},
    )
    llm = Mock()
    llm.invoke.return_value = "Fallback answer\n"

    engine = AnswerEngine(path=answers_path, llm=llm)

    assert engine.lookup("Do you have Kubernetes experience?") == "Fallback answer"
    llm.invoke.assert_called_once()


def test_answer_engine_llm_prompt_includes_persona_context(tmp_path):
    persona_context = "Never fabricate credentials."
    answers_path = write_answers_yaml(
        tmp_path / "answers.yaml",
        {"authorized to work": "Yes"},
        persona_context=persona_context,
    )
    llm = Mock()
    llm.invoke.return_value = "N/A"

    engine = AnswerEngine(path=answers_path, llm=llm)
    engine.lookup("Do you have a CCNA certification?")

    prompt = llm.invoke.call_args.args[0]
    assert persona_context in prompt


def test_answer_engine_llm_prompt_includes_resume_content(tmp_path):
    resume_content = "Built Python automation for recruiting workflows."
    answers_path = write_answers_yaml(
        tmp_path / "answers.yaml",
        {"authorized to work": "Yes"},
    )
    llm = Mock()
    llm.invoke.return_value = "Yes"

    engine = AnswerEngine(path=answers_path, llm=llm)
    engine.lookup("Have you built automation?", resume_content=resume_content)

    prompt = llm.invoke.call_args.args[0]
    assert resume_content in prompt


def test_answer_engine_raises_on_missing_answers_yaml():
    with pytest.raises(FileNotFoundError):
        AnswerEngine(path="/nonexistent/answers.yaml")

