import type { Job, JobDetail, ResumeVersion, ResumeVersionSummary, QAReview, UserProfile, OpenRouterModel } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3002";
const API_KEY = import.meta.env.VITE_API_KEY ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

export const api = {
  jobs: {
    list: () => request<Job[]>("/jobs"),
    get: (id: string) => request<JobDetail>(`/jobs/${id}`),
    submit: (url: string) =>
      request<Job>("/jobs", {
        method: "POST",
        body: JSON.stringify({ url }),
      }),
  },

  resumes: {
    list: (jobId: string) =>
      request<ResumeVersionSummary[]>(`/jobs/${jobId}/resumes`),
    getMarkdown: (jobId: string, vid: string) =>
      fetch(`${API_URL}/jobs/${jobId}/resume/${vid}`, {
        headers: authHeaders(),
      }).then((r) => {
        if (!r.ok) throw new ApiError(r.status, null);
        return r.text();
      }),
    pdfUrl: (jobId: string, vid: string) =>
      `${API_URL}/jobs/${jobId}/resume/${vid}/pdf?key=${API_KEY}`,
  },

  qa: {
    list: (jobId: string) =>
      request<QAReview[]>(`/jobs/${jobId}/qa`),
  },

  profile: {
    get: () => request<UserProfile>("/profile"),
    create: (data: { display_name: string }) =>
      request<{ ok: boolean }>("/profile", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (data: Partial<Omit<UserProfile, "api_key_configured" | "created_at" | "updated_at">>) =>
      request<UserProfile>("/profile", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    saveApiKey: (apiKey: string) =>
      request<{ ok: boolean }>("/profile/api-key", {
        method: "PUT",
        body: JSON.stringify({ api_key: apiKey }),
      }),
    checkApiKey: () =>
      request<{ configured: boolean }>("/profile/api-key"),
    deleteApiKey: () =>
      request<{ ok: boolean }>("/profile/api-key", { method: "DELETE" }),
  },

  models: {
    list: () => request<OpenRouterModel[]>("/profile/models"),
  },

  health: {
    check: () => request<{ ok: boolean; version: string }>("/"),
  },

  openrouter: {
    listModels: async (apiKey: string): Promise<OpenRouterModel[]> => {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (!res.ok) {
        throw new ApiError(res.status, await res.json().catch(() => ({})));
      }
      const body = (await res.json()) as { data: { id: string; name: string }[] };
      return body.data
        .filter((m) => !m.id.endsWith(":free"))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => ({ id: m.id, name: m.name }));
    },
  },

  // EventSource doesn't support custom headers — pass key as query param.
  events: {
    connect: (jobId: string) =>
      new EventSource(`${API_URL}/jobs/${jobId}/events?key=${encodeURIComponent(API_KEY)}`),
  },
};
