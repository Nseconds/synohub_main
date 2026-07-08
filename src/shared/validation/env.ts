import { z } from "zod";

const optionalEnvString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}, z.string().optional());

export const EnvSchema = z.object({
  AUTH_SECRET: optionalEnvString,
  GEMINI_API_KEY: optionalEnvString.default(""),
  GEMINI_MODEL: optionalEnvString.default("gemini-3.5-flash"),
  JWT_SECRET: optionalEnvString,
  PORT: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return 3000;
    return value;
  }, z.coerce.number().int().positive().default(3000)),
}).passthrough();

const env = EnvSchema.parse(process.env);

export default env;
