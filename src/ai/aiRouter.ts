import type { SafeQueryAiMode } from "./chatService";

export type QueryProviderName = "gemini";
export type PublicAiProviderMode = "gemini";

export function normalizeQueryAiMode(value: unknown, _authUser?: unknown): "gemini" {
  return "gemini";
}

export function normalizeProviderName(value: unknown): "gemini" {
  return "gemini";
}

export function normalizeCompareProviders(value: unknown): "gemini"[] {
  return ["gemini"];
}

export function normalizeAiProviderMode(value: unknown): "gemini" {
  return "gemini";
}
