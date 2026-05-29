/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_API_KEY: string;
  // Set to "false" to hide the Codex OAuth provider (hosted build). Defaults to enabled.
  readonly VITE_CODEX_OAUTH_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
