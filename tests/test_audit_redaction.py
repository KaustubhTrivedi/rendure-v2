import json

from utils.audit_redaction import build_redacted_prompt_payload


def test_build_redacted_prompt_payload_is_json_safe_and_redacts_private_content():
    prompt = (
        "resume text: private resume\n"
        "private vault evidence: secret evidence\n"
        "recruiter email: recruiter@example.com\n"
        "private notes: do not share\n"
        "full content: generated content"
    )

    payload = build_redacted_prompt_payload(
        "resume_tailor_to_llm",
        prompt,
        iteration=3,
        version_id="version-123",
        extra={"source": "resume_tailor"},
    )

    assert payload["direction"] == "resume_tailor_to_llm"
    assert payload["prompt_length"] == len(prompt)
    assert payload["redacted"] is True
    assert payload["iteration"] == 3
    assert payload["version_id"] == "version-123"
    assert payload["source"] == "resume_tailor"
    assert isinstance(payload["prompt_sha256"], str)
    assert len(payload["prompt_sha256"]) == 64

    encoded = json.dumps(payload)
    assert "prompt" not in payload
    assert "raw_prompt" not in encoded
    assert "resume text" not in encoded
    assert "private vault evidence" not in encoded
    assert "recruiter@example.com" not in encoded
    assert "private notes" not in encoded
    assert "full content" not in encoded
