import type { SynoHubPrompts } from "./promptLoader";

export function buildChatSystemInstruction(args: {
  prompts: SynoHubPrompts;
  dbContextStr: string;
  userRole: string;
  userName: string;
  aiMode?: string;
}): string {
  return [
    args.prompts.chat_assistant,
    args.dbContextStr,
  ].map(part => String(part || "").trim()).filter(Boolean).join("\n\n");
}
