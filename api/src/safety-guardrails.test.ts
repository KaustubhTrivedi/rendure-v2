import { describe, expect, it } from 'vitest'
import {
  GuardrailViolation,
  assertManualOnlyAction,
  assertMissingEvidenceHasSource,
  assertTrustedEvidenceWriteAllowed,
} from './safety-guardrails.js'

describe('assertTrustedEvidenceWriteAllowed', () => {
  it('rejects AI initiated trusted evidence writes', () => {
    expect(() =>
      assertTrustedEvidenceWriteAllowed({
        initiatedBy: 'ai',
        approvalState: 'approved',
        sourceArtifactIds: ['artifact-1'],
      }),
    ).toThrow(GuardrailViolation)
  })

  it('rejects non-approved trusted evidence writes', () => {
    expect(() =>
      assertTrustedEvidenceWriteAllowed({
        initiatedBy: 'user',
        approvalState: 'pending',
        sourceArtifactIds: ['artifact-1'],
      }),
    ).toThrow(GuardrailViolation)
  })

  it('rejects approved writes without source provenance or manual metadata', () => {
    expect(() =>
      assertTrustedEvidenceWriteAllowed({
        initiatedBy: 'user',
        approvalState: 'approved',
      }),
    ).toThrow(GuardrailViolation)
  })

  it('accepts approved sourced evidence writes', () => {
    expect(() =>
      assertTrustedEvidenceWriteAllowed({
        initiatedBy: 'user',
        approvalState: 'approved',
        sourceArtifactIds: ['artifact-1'],
      }),
    ).not.toThrow()
  })

  it('accepts explicit manual-entry writes with a reason', () => {
    expect(() =>
      assertTrustedEvidenceWriteAllowed({
        initiatedBy: 'user',
        approvalState: 'approved',
        manualEntry: true,
        manualEntryReason: 'User verified the claim',
      }),
    ).not.toThrow()
  })
})

describe('assertMissingEvidenceHasSource', () => {
  it('rejects missing evidence without source attribution', () => {
    expect(() => assertMissingEvidenceHasSource({})).toThrow(GuardrailViolation)
  })

  it('accepts missing evidence with source attribution', () => {
    expect(() =>
      assertMissingEvidenceHasSource({
        sourceArtifactIds: ['artifact-1'],
        sourceReference: 'profile doc',
        sourceExcerpt: 'evidence excerpt',
      }),
    ).not.toThrow()
  })
})

describe('assertManualOnlyAction', () => {
  it('rejects application submission and send/apply actions', () => {
    for (const actionType of ['submit_application', 'auto_apply', 'browser_apply', 'send_email', 'send_recruiter_email']) {
      expect(() => assertManualOnlyAction(actionType)).toThrow(GuardrailViolation)
    }
  })

  it('accepts copy-only and pdf actions', () => {
    for (const actionType of ['render_pdf', 'retrieve_pdf', 'download_resume', 'draft_email_copy', 'copy_follow_up_draft']) {
      expect(() => assertManualOnlyAction(actionType)).not.toThrow()
    }
  })
})
