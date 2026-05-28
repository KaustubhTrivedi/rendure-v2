export type JobStatus =
  | "new"
  | "found"
  | "tailoring"
  | "qa_review"
  | "approved"
  | "qa_failed"
  | "low_match"
  | "error";

export interface Job {
  job_id: string;
  job_url: string;
  company_name: string | null;
  role_title: string | null;
  status: JobStatus;
  qa_score: number | null;
  iteration_count: number;
  active_resume_id: string | null;
  seniority_level: string | null;
  location: string | null;
  required_skills: string[];
  nice_to_haves: string[];
  created_at: string;
}

export interface ResumeVersion {
  version_id: string;
  job_id: string;
  version_number: number;
  latex_source: string;
  tailoring_notes: string | null;
  created_at: string;
}

export interface ResumeVersionSummary {
  version_id: string;
  version_number: number;
  tailoring_notes: string | null;
  created_at: string;
}

export interface Gap {
  category: "skills" | "experience" | "seniority" | "structure";
  detail: string;
  severity: "high" | "medium" | "low";
}

export interface QAReview {
  review_id: string;
  version_id: string;
  score: number;
  passed: boolean;
  score_threshold: number;
  keyword_match: number;
  experience_match: number;
  seniority_match: number;
  structure_valid: boolean;
  gaps: Gap[];
  raw_feedback: string | null;
  created_at: string;
}

export interface JobDetail extends Job {
  qa_review: QAReview | null;
  pipeline_events: PipelineEvent[];
}

export interface PipelineEvent {
  event_id: string;
  job_id: string;
  event_type: string;
  agent_name: string | null;
  from_status: string | null;
  to_status: string | null;
  model_used: string | null;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
}

export type LlmProvider = "openrouter" | "codex-oauth";

export interface CodexAuthStatus {
  connected: boolean;
  expired: boolean;
  source_path: string | null;
  account_id: string | null;
  expires_at: string | null;
  last_refresh: string | null;
}

export interface UserProfile {
  display_name: string | null;
  api_key_configured: boolean;
  llm_provider: LlmProvider | null;
  qa_threshold: number | null;
  max_iterations: number | null;
  preferred_model: string | null;
  model_job_scout: string | null;
  model_resume_tailor: string | null;
  model_quality_analyst: string | null;
  model_confirmation: string | null;
  model_orchestrator: string | null;
  target_seniority: string | null;
  highlight_skills: string[] | null;
  preferred_industries: string[] | null;
  tailor_style_notes: string | null;
  notify_email: string | null;
  notify_webhook_url: string | null;
  notify_telegram_chat_id: string | null;
  resume_text: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  summary: string | null;
  years_experience: number | null;
  created_at: string;
  updated_at: string;
}

export interface ParsedProfile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  summary: string | null;
  years_experience: number | null;
  target_seniority: string | null;
  highlight_skills: string[];
  preferred_industries: string[];
}

export interface ResumeUploadResponse {
  resume_stored: boolean;
  parsed: ParsedProfile | null;
  parse_error?: string;
}
