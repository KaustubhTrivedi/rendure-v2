import agents.quality_analyst as quality_analyst


class ExplodingConnection:
    def cursor(self, *args, **kwargs):
        raise AssertionError("hard constraints should be loaded from disk, not user_profiles")


def test_quality_analyst_loads_hard_constraints_without_profile_table(tmp_path, monkeypatch):
    constraints_path = tmp_path / "hard_constraints.md"
    constraints_path.write_text("[DO NOT CLAIM]\n- Kubernetes\n", encoding="utf-8")
    monkeypatch.setattr(quality_analyst, "HARD_CONSTRAINTS_PATH", constraints_path)

    assert quality_analyst._get_hard_constraints(ExplodingConnection()) == "[DO NOT CLAIM]\n- Kubernetes"


class RecordingCursor:
    def __init__(self):
        self.sql = ""
        self.params = ()

    def execute(self, sql, params):
        self.sql = sql
        self.params = params

    def fetchone(self):
        return ("review-123",)


def test_quality_analyst_inserts_only_columns_present_in_qa_reviews_schema():
    cursor = RecordingCursor()

    review_id = quality_analyst._insert_qa_review(
        cursor,
        version_id="version-123",
        composite_score=0.83,
        passed=False,
        pass_threshold=0.92,
        keyword_match=0.85,
        experience_match=0.75,
        seniority_match=0.85,
        structure_valid=True,
        gaps=[],
        raw_feedback="Needs stronger impact bullets.",
    )

    assert review_id == "review-123"
    assert "ats_parseable" not in cursor.sql
    assert "bullet_impact" not in cursor.sql
    assert "hook_score" not in cursor.sql
    assert "relevance_density" not in cursor.sql
    assert len(cursor.params) == 10
