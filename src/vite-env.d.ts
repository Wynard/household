/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK?: string;
  readonly VITE_BASE?: string;
  readonly HH_GOOGLE_CLIENT_ID?: string;
  readonly HH_PICKER_API_KEY?: string;
  readonly HH_GOOGLE_PROJECT_NUMBER?: string;
}
