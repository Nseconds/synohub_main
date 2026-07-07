import type { SafeQueryAiMode } from "./chatService";

export type QueryProviderName = "gemini" | "local" | "nvidia" | "openrouter";
export type PublicAiProviderMode = "gemini" | "local" | "gpt-oss" | "cohere" | "compare" | "auto-fallback";

export function normalizeQueryAiMode(value: unknown, _authUser?: unknown): SafeQueryAiMode {
  return "gemini";
}

export function normalizeProviderName(value: unknown): QueryProviderName | null {
  return "gemini";
}

export function normalizeCompareProviders(value: unknown): QueryProviderName[] {
  return ["gemini"];
}

export function normalizeAiProviderMode(value: unknown): PublicAiProviderMode {
  return "gemini";
}
