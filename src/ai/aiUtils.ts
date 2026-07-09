export const regionAliases: Record<string, string> = {
  "auh": "Abu Dhabi",
  "ad": "Abu Dhabi",
  "abu dhabi": "Abu Dhabi",
  "dxb": "Dubai",
  "dubai": "Dubai",
  "shj": "Sharjah",
  "sharjah": "Sharjah",
  "ajman": "Ajman",
  "fujairah": "Fujairah",
  "rak": "Ras Al Khaimah",
  "ras al khaimah": "Ras Al Khaimah",
  "uaq": "Umm Al Quwain",
  "umm al quwain": "Umm Al Quwain",
};

export function normalizeQueryText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractRegionName(text: string): string | null {
  const normalized = text.toLowerCase();
  const aliases = Object.entries(regionAliases).sort((a, b) => b[0].length - a[0].length);
  const matched = aliases.find(([alias]) => {
    return new RegExp(`\\b${escapeRegex(alias)}\\b`).test(normalized);
  });
  return matched ? matched[1] : null;
}

export function extractEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].trim() : null;
}

export function extractPhone(text: string): string | null {
  const match = text.match(/(?:\+?\d[\d\s().-]{5,}\d)/);
  if (!match) return null;
  const phone = match[0].replace(/[^\d+]/g, "");
  return phone.length >= 6 ? phone : null;
}
