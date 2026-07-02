export class GuardrailViolation extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'GuardrailViolation'
  }
}

type TrustedEvidenceWriteInput = {
  initiatedBy: 'ai' | 'user'
  approvalState: string
  sourceArtifactIds?: string[]
  manualEntry?: boolean
  manualEntryReason?: string
}

export function assertTrustedEvidenceWriteAllowed(input: TrustedEvidenceWriteInput): void {
  if (input.initiatedBy !== 'user') {
    throw new GuardrailViolation('evidence_ai_initiated', 'Trusted evidence writes require explicit user initiation.')
  }
  if (input.approvalState !== 'approved') {
    throw new GuardrailViolation('evidence_not_approved', 'Trusted evidence writes require approved state.')
  }
  const hasSource = (input.sourceArtifactIds?.length ?? 0) > 0
  const hasManualEntry = input.manualEntry === true && Boolean(input.manualEntryReason?.trim())
  if (!hasSource && !hasManualEntry) {
    throw new GuardrailViolation('evidence_no_provenance', 'Trusted evidence writes require source provenance or manual-entry metadata.')
  }
}

type MissingEvidenceInput = {
  sourceArtifactIds?: string[]
  sourceReference?: string
  sourceExcerpt?: string
}

export function assertMissingEvidenceHasSource(input: MissingEvidenceInput): void {
  const hasArtifact = (input.sourceArtifactIds?.length ?? 0) > 0
  const hasReference = Boolean(input.sourceReference?.trim())
  const hasExcerpt = Boolean(input.sourceExcerpt?.trim())
  if (!hasArtifact && !hasReference && !hasExcerpt) {
    throw new GuardrailViolation('missing_evidence_no_source', 'Missing evidence candidates require source attribution.')
  }
}

const MANUAL_ONLY_ALLOWED = new Set([
  'render_pdf',
  'retrieve_pdf',
  'download_resume',
  'draft_email_copy',
  'copy_follow_up_draft',
])

const MANUAL_ONLY_BLOCKED = new Set([
  'submit_application',
  'auto_apply',
  'browser_apply',
  'send_email',
  'send_recruiter_email',
])

export function assertManualOnlyAction(actionType: string): void {
  if (MANUAL_ONLY_ALLOWED.has(actionType)) return
  if (MANUAL_ONLY_BLOCKED.has(actionType)) {
    throw new GuardrailViolation('manual_only_action_blocked', `Action ${actionType} is not allowed.`)
  }
  throw new GuardrailViolation('manual_only_action_unknown', `Action ${actionType} is not recognized as manual-only safe.`)
}
