"""
DEPLOY_TARGET config module (Python).

Reads DEPLOY_TARGET from os.environ and resolves a frozen Config singleton
nested by seam ({ target, db, execution, credentials }). Fail-fast:
invalid non-empty target throws; missing required vars throw.

Singleton: ``from config import config`` (resolved once at module import).
Testable: ``from config import resolve`` (pure function, pass env dict).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from types import MappingProxyType

from dotenv import load_dotenv

load_dotenv()

VALID_TARGETS = ("self-hosted", "cloud", "browser")

REQUIRED_VARS: dict[str, tuple[str, ...]] = {
    "self-hosted": ("DATABASE_URL",),
    "cloud": (),
    "browser": (),
}


@dataclass(frozen=True)
class Config:
    """Frozen settings object resolved once at import from environment variables."""

    target: str
    db: MappingProxyType
    execution: MappingProxyType
    credentials: MappingProxyType


def resolve(env: dict[str, str] | None = None) -> Config:
    """Resolve a frozen Config from the given env mapping.

    Args:
        env: Environment variable mapping. Uses ``os.environ`` when None.

    Returns:
        A frozen Config with settings nested by seam (target, db, execution,
        credentials).

    Raises:
        RuntimeError: If DEPLOY_TARGET is a non-empty invalid value, or if
            a required variable for the resolved target is missing.
    """
    env = os.environ if env is None else env

    raw = (env.get("DEPLOY_TARGET") or "").strip()
    target = "self-hosted" if raw == "" else raw

    if target not in VALID_TARGETS:
        raise RuntimeError(
            f'Invalid DEPLOY_TARGET "{raw}". '
            f"Valid: {', '.join(VALID_TARGETS)}"
        )

    for var in REQUIRED_VARS[target]:
        if not env.get(var):
            raise RuntimeError(
                f"DEPLOY_TARGET={target} requires {var}"
            )

    db: dict[str, str] = {}
    if target == "self-hosted":
        db = {"connectionString": env["DATABASE_URL"]}

    return Config(
        target=target,
        db=MappingProxyType(db),
        execution=MappingProxyType({}),
        credentials=MappingProxyType({}),
    )


config: Config = resolve()
