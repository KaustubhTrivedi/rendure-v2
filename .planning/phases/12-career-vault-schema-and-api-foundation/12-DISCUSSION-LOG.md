# Phase 12: Career Vault Schema and API Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 12-career-vault-schema-and-api-foundation
**Areas discussed:** Candidate vs trusted modeling, Provenance linkage shape, API resource shape & approval action, Skill normalization depth, Profile placement

---

## Candidate vs Trusted Modeling

### Storage model
| Option | Description | Selected |
|--------|-------------|----------|
| One table per entity + trust column | Single table per entity, approval_state flips in place | ✓ |
| Separate staging + trusted tables | *_candidates staging copied into *_records on approval | |
| You decide | — | |

### Candidate grouping
| Option | Description | Selected |
|--------|-------------|----------|
| Per-entity candidate rows, linked by source artifact | Typed rows grouped by shared source_artifact_id | ✓ |
| Shared polymorphic candidate table + payload | One extraction_candidates table, kind + JSONB | |
| You decide | — | |

### Lifecycle
| Option | Description | Selected |
|--------|-------------|----------|
| pending → approved / rejected (minimal) | Three states | |
| Add 'edited' / 'superseded' states | Track user-edited candidates and superseded/merged records | ✓ |
| You decide | — | |

**User's choice:** In-place trust column; per-entity candidates grouped by source artifact; richer lifecycle with `edited`/`superseded`.
**Notes:** Captured that merge/supersede *behavior* stays in Phase 13 — only the states are reserved in Phase 12. Concrete state machine defined in CONTEXT D-03.

---

## Provenance Linkage Shape

### Provenance storage
| Option | Description | Selected |
|--------|-------------|----------|
| Shared polymorphic junction table | record_provenance(record_type, record_id, source_artifact_id) | ✓ |
| Per-entity source_artifact_ids[] JSONB | Array column per entity | |
| Per-entity junction tables | role_sources, achievement_sources, ... | |
| You decide | — | |

### Manual entry
| Option | Description | Selected |
|--------|-------------|----------|
| manual_entry flag + reason on the record | Mirrors assertTrustedEvidenceWriteAllowed inputs | ✓ (Claude's call) |
| Synthetic 'manual' source artifact row | Every record always links to an artifact | |
| You decide | — | ✓ |

**User's choice:** Shared polymorphic junction table; manual-entry representation delegated to Claude.
**Notes:** Claude chose `manual_entry` flag + reason to keep the existing guardrail unchanged and avoid polluting source_artifacts. VAULT-09 rule: ≥1 provenance row OR manual_entry=true with reason.

---

## API Resource Shape & Approval Action

### Route shape
| Option | Description | Selected |
|--------|-------------|----------|
| Unified /vault namespace | /vault/roles, /vault/projects, ... | ✓ (Claude's call) |
| Top-level per-entity routes | /roles, /projects at root | |
| You decide | — | ✓ |

### Approval API
| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated action endpoints | POST /vault/<entity>/:id/approve + /reject | ✓ (Claude's call) |
| PATCH approval_state | Client patches state field directly | |
| You decide | — | ✓ |

### Read default
| Option | Description | Selected |
|--------|-------------|----------|
| Approved only by default; candidates via explicit param/route | Safe default | ✓ (Claude's call) |
| Return all states, client filters | Flexible, leak-prone | |
| You decide | — | ✓ |

**User's choice:** All three delegated to Claude.
**Notes:** Claude chose unified /vault namespace, dedicated approve/reject endpoints gated by assertTrustedEvidenceWriteAllowed, and approved-only default reads (candidates via ?state=candidate).

---

## Skill Normalization Depth

### Normalization
| Option | Description | Selected |
|--------|-------------|----------|
| Canonical skill + category, dedupe on canonical name | Normalize aliases at write time, no alias dictionary | ✓ (Claude's call) |
| Full canonical dictionary + alias table | Taxonomy subsystem | |
| Freeform skill + category only | No dedupe | |
| You decide | — | ✓ |

### Category
| Option | Description | Selected |
|--------|-------------|----------|
| CHECK-constrained enum | language/framework/cloud/tooling/domain/soft_skill | ✓ (Claude's call) |
| Freeform text with recommended set | Not enforced | |
| You decide | — | ✓ |

**User's choice:** Both delegated to Claude.
**Notes:** Claude chose canonical-name dedupe (no alias table this phase) and a CHECK-constrained category enum. Full taxonomy deferred.

---

## Profile Placement (surfaced by Claude)

| Option | Description | Selected |
|--------|-------------|----------|
| New vault_profile table (single-row) | Separate from user_profile | ✓ (Claude's call) |
| Extend existing user_profile | Mix career evidence with tailoring config + key | |
| Explore more gray areas | — | |
| You decide everything, write context | Delegate all remaining decisions | ✓ |

**User's choice:** "You decide everything, write context."
**Notes:** Claude chose a new single-row `vault_profile` table for domain separation (consistent with Phase 11 D-04). Also decided: single-user scoping (no owner column), entity-to-entity link modeling (D-13), and requirement-locked source_artifacts fields (D-14).

---

## Claude's Discretion

- Manual-entry provenance representation (manual_entry flag + reason).
- Full API resource shape (unified /vault, dedicated approve/reject, approved-only reads).
- Skill normalization depth and category enforcement.
- Profile preferences placement (new vault_profile table).
- Single-user scoping; entity-to-entity link modeling; source_artifacts fields.

## Deferred Ideas

- Full skill taxonomy / alias dictionary (skills_canonical + skill_aliases) — revisit if Phase 13 shows dedup gaps.
- Candidate merge logic, duplicate grouping, import/review UI — Phase 13.
- Multi-user / ownership scoping — out of scope per PROJECT.md.
