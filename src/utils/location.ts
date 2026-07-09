import { regionAliases } from "../ai/aiUtils";

export function normalizeLocationName(value: unknown): string {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[.,;]+$/, "")
    .trim();
  if (!cleaned) return "";

  const exact = cleaned.toLowerCase();
  if (regionAliases[exact]) return regionAliases[exact];

  const keysPattern = new RegExp(`\\b(${Object.keys(regionAliases).join("|")})\\b`, "gi");
  return cleaned.replace(keysPattern, (match) => {
    return regionAliases[match.toLowerCase()] || match;
  });
}
