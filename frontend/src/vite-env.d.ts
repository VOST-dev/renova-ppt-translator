/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_USER: string;
  readonly VITE_API_PASS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
