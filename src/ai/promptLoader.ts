import fs from "fs";
import path from "path";

export interface SynoHubPrompts {
  chat_assistant: string;
  [key: string]: string;
}

export const defaultPrompts: SynoHubPrompts = {
  chat_assistant: "You are a SynoHub Assistant for Synosys, a fleet management SaaS company in the UAE. Assist users with CRM queries, service tickets, and registrations.",
};

export function loadPrompts(): SynoHubPrompts {
  const promptsPath = path.join(process.cwd(), "prompts.json");
  try {
    if (!fs.existsSync(promptsPath)) return { ...defaultPrompts };
    const data = JSON.parse(fs.readFileSync(promptsPath, "utf8"));
    return { ...defaultPrompts, ...data };
  } catch (err) {
    console.error("Failed to load prompts.json, using defaults.", err);
    return { ...defaultPrompts };
  }
}

export function buildChatSystemInstruction(args: {
  prompts: SynoHubPrompts;
  dbContextStr: string;
  userRole: string;
  userName: string;
  aiMode?: string;
}): string {
  const userContext = `ACTIVE USER: ${args.userName} (Role: ${args.userRole})`;
  const basePrompt = args.prompts.chat_assistant
    .replace(/\{\{ACTIVE_USER_NAME\}\}/g, args.userName || "Unknown")
    .replace(/\{\{ACTIVE_USER_ROLE\}\}/g, args.userRole || "unknown");
  return [
    basePrompt,
    userContext,
    args.dbContextStr,
  ].map(part => String(part || "").trim()).filter(part => Boolean(part)).join("\n\n");
}
