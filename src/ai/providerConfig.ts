import { GoogleGenAI } from "@google/genai";
import env from "../shared/validation/env";

export function cleanEnvVar(val: string | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export const rawGeminiKey = cleanEnvVar(env.GEMINI_API_KEY);
export const cleanedGeminiKey = rawGeminiKey;
export const geminiModel = cleanEnvVar(env.GEMINI_MODEL) || "gemini-3.5-flash";
export const cloudProviderLabel = "Gemini";

export const rawGroqKey = cleanEnvVar(env.GROQ_API_KEY);
export const cleanedGroqKey = rawGroqKey;
export const groqModel = cleanEnvVar(env.GROQ_MODEL) || "llama-3.3-70b-versatile";

console.log("--- Environment Variable Sync Check ---");
console.log("GEMINI_API_KEY:", cleanedGeminiKey ? "PRESENT" : "MISSING");
console.log("GEMINI_MODEL:", geminiModel);
console.log("GROQ_API_KEY:", cleanedGroqKey ? "PRESENT" : "MISSING");
console.log("GROQ_MODEL:", groqModel);
console.log("---------------------------------------");


export let genAI: any = null;
if (cleanedGeminiKey) {
  genAI = new GoogleGenAI({
    apiKey: cleanedGeminiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}
