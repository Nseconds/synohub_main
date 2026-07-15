import "dotenv/config";
import express from "express";
import { createServer as createHttpServer } from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { db } from "../db";
import { initDB } from "../db/init";
import { customers, serviceRequests, users } from "../db/schema";
import { eq, like, or, desc } from "drizzle-orm";
import env from "../shared/validation/env";

import { getAuthUser, requireAuth } from "../auth/middleware";
import { chatHistoryPredicates, resolveChatIdentity } from "../auth/permissions";
import { getChatMessagesByPredicate, getRecentChatMessages, saveChatMessage } from "../services/messageService";
import {
  cleanedGeminiKey,
  cloudProviderLabel,
  geminiModel,
  genAI,
  cleanedGroqKey,
  groqModel,
} from "../ai/providerConfig";
import { runGeminiChatCompletion } from "../ai/providers/gemini";
import { runGroqChatCompletion } from "../ai/providers/groq";

import {
  isAcknowledgementOnlyMessage,
  handleAIRecordSave,
} from "../ai/recordSaveHandler";
import { buildChatSystemInstruction, loadPrompts } from "../ai";

import {
  extractEmail,
  extractPhone,
  extractRegionName,
  normalizeQueryText,
} from "../ai/aiUtils";
import {
  cleanVisibleAssistantText,
  getModeScopedChatChannel,
  sanitizeProviderChatHistory,
} from "../ai/responseFormatter";

import { registerAuthRoutes } from "./authRoutes";
import { registerCustomerRoutes } from "./customerRoutes";
import { registerDashboardRoutes } from "./dashboardRoutes";
import { registerServiceRequestRoutes } from "./serviceRequestRoutes";

// Load prompts
let prompts = loadPrompts();
console.log("Prompts loaded from prompts.json");

function isGenericTicketCreationPrompt(input: string): boolean {
  const normalized = input.toLowerCase().replace(/\s+/g, " ").trim();
  if (!/\b(create|prepare|raise|open|make|add)\b/.test(normalized)) return false;
  if (!/\b(ticket|service request|service ticket)\b/.test(normalized)) return false;
  if (/\bSERVICE REQUEST\b/i.test(input)) return false;

  const hasConcreteDetails =
    extractPhone(input) ||
    extractEmail(input) ||
    extractRegionName(input) ||
    /\b(customer|company|client)\s+[:\w]/i.test(input) ||
    /\bfor\s+[A-Z0-9][A-Z0-9 .&-]{2,}\b/i.test(input);

  return !hasConcreteDetails;
}

function formatGenericTicketCreationPrompt(userRole: string, userName: string): string {
  const lines = [
    "Sure. Please share these details so I can prepare the ticket correctly:",
    "",
    "- Customer Name:",
    "- Contact Person:",
    "- Contact Number:",
    "- Service Type:",
    "- Quantity:",
    "- Description:",
    "- Service Location:",
  ];

  if ((userRole === "staff" || userRole === "admin") && userName) {
    return lines.join("\n");
  } else {
    lines.push("- Requested Person:");
  }

  return lines.join("\n");
}

function normalizeChatLookupText(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b(recrds|recrd|reocrds|recrods|recods)\b/g, "records")
    .replace(/\b(reqsts|reqs)\b/g, "requests")
    .trim();
}

function isIdentityLookupMessage(input: string): boolean {
  const normalized = normalizeChatLookupText(input);
  return /\b(who\s+am\s+i|who\s+i\s+am|what\s+is\s+my\s+(name|role)|my\s+login|my\s+account)\b/.test(normalized);
}

function cleanRecordDescription(value: unknown): string {
  return String(value || "No description")
    .replace(/\s+/g, " ")
    .trim();
}

function formatStaffRecordList(title: string, rows: any[]): string {
  return `${title}\n\n${rows.map((r: any, index: number) => {
    const status = r.jobStatus || r.status || "Pending";
    const description = cleanRecordDescription(r.issueDescription || r.comment || r.implementationType || "No description");
    const location = r.location || r.region || "";
    const descriptionLabel = /issue|fault|offline|not working|battery|ignition|no connection/i.test(description) ? "Issue" : "Task";
    const plateMatch = description.match(/\bPlate:\s*(.+)$/i);
    const mainDescription = plateMatch ? description.replace(/\s*\bPlate:\s*.+$/i, "").trim() : description;
    const plateLine = plateMatch ? `\n   - Plate: ${plateMatch[1].trim()}` : "";
    const detailLines = `   - ${descriptionLabel}: ${mainDescription}${plateLine}`;
    return `${index + 1}. #${r.id} | ${r.customerName || "Unknown customer"}\n   - Status: ${status}\n${detailLines}${location ? `\n   - Location: ${location}` : ""}`;
  }).join("\n\n")}`;
}


export async function startServer() {
  const app = express();
  const PORT = env.PORT;
  const httpServer = createHttpServer(app);

  try {
    await initDB();
  } catch (err) {
    console.error("Critical: Could not initialize database. App may fail.", err);
  }

  app.use(express.json());

  // --- API Routes ---

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  registerAuthRoutes(app);
  registerDashboardRoutes(app);
  registerServiceRequestRoutes(app);
  registerCustomerRoutes(app);



  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const allUsers = await db.select({
        id: users.id,
        name: users.name,
        username: users.username
      }).from(users);
      res.json(allUsers);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Chat/AI endpoint
  app.post("/api/chat", requireAuth, async (req, res) => {
    try {
      const { message, selectedChatTarget, selectedUsername } = req.body;
      const authUser = getAuthUser(req);
      const aiMode = (req.body.aiMode === "groq" || req.body.aiMode === "gemini") ? req.body.aiMode : "gemini";
      const chatIdentity = resolveChatIdentity(authUser, selectedChatTarget || selectedUsername);
      let userRole = chatIdentity.role;
      let userName = chatIdentity.name;
      if (selectedChatTarget && typeof selectedChatTarget === "string" && selectedChatTarget.startsWith("user:")) {
        const targetId = parseInt(selectedChatTarget.slice("user:".length).trim());
        if (!isNaN(targetId)) {
          const [targetUser] = await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, targetId))
            .limit(1);
          if (targetUser) {
            userName = targetUser.name.trim();
          }
        }
      }
      const chatChannel = getModeScopedChatChannel(chatIdentity.channel, aiMode);

      if (authUser.role === "admin" && chatIdentity.channel !== "admin" && !chatIdentity.channel.startsWith("user:")) {
        return res.status(403).json({ error: "Admin can only view guest and staff chats. Switch to Admin chat to send messages." });
      }

      const persistedHistory = await getRecentChatMessages(chatChannel, 12);
      let chatHistory: { role: string; content: string }[] = [];
      
      if (persistedHistory.length > 0) {
        const lastMsgTime = persistedHistory[0].timestamp;
        const timeDiffMs = lastMsgTime ? (Date.now() - new Date(lastMsgTime).getTime()) : 0;
        const sessionTimeoutMs = 30 * 60 * 1000; // 30 minutes
        if (timeDiffMs < sessionTimeoutMs) {
          chatHistory = persistedHistory
            .slice() // avoid mutating original array if needed, but reverse() mutates in place
            .reverse()
            .map((h: any) => ({ role: h.role, content: h.content }));
        } else {
          console.log(`[AI Chat] Session expired (last message was ${(timeDiffMs / (1000 * 60)).toFixed(1)} mins ago). Starting fresh context.`);
        }
      }

      // Save user message (partitioned by username)
      await saveChatMessage("user", message, chatChannel);

      if (isAcknowledgementOnlyMessage(message)) {
        const reply = cleanVisibleAssistantText("Okay.");
        await saveChatMessage("assistant", reply, chatChannel);
        return res.json({ reply });
      }

      if (isIdentityLookupMessage(message)) {
        const roleLabel = userRole ? userRole.charAt(0).toUpperCase() + userRole.slice(1) : "User";
        const reply = cleanVisibleAssistantText(userName
          ? `You are signed in as ${userName} (${roleLabel}).`
          : `You are signed in as ${roleLabel}.`);
        await saveChatMessage("assistant", reply, chatChannel);
        return res.json({ reply });
      }

      if (isGenericTicketCreationPrompt(message)) {
        const reply = cleanVisibleAssistantText(formatGenericTicketCreationPrompt(userRole, userName));
        await saveChatMessage("assistant", reply, chatChannel);
        return res.json({ reply });
      }

      let prependAccessRestricted = false;
      const currentDateLabel = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      
      // Dynamic database customer search for context injection
      let databaseContext = "";
      const stopWords = new Set([
        "the", "a", "an", "for", "at", "on", "in", "of", "and", "to", "with", "is", "are", "was", "were", 
        "be", "been", "have", "has", "had", "do", "does", "did", "no", "not", "yes", "both", "show", 
        "connection", "locator", "installation", "vehicles", "units", "contact", "need", "please", 
        "specified", "pending", "amount", "quantity", "service", "ticket", "request", "issue", 
        "description", "location", "plate", "number", "sim", "device", "gps", "tracker", "car", 
        "truck", "van", "bike", "mobile", "phone", "email", "address", "hi", "hello", "hey", "dear",
        "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your"
      ]);

      const searchTerms = String(message || "")
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length >= 3 && !stopWords.has(w));

      if (searchTerms.length > 0) {
        try {
          const matchingCustomers = await db
            .select({ name: customers.name })
            .from(customers)
            .where(
              or(
                ...searchTerms.map(term => like(customers.name, `%${term}%`))
              )
            )
            .limit(15);

          if (matchingCustomers.length > 0) {
            const namesList = matchingCustomers.map(c => `- ${c.name}`).join("\n");
            databaseContext = `[System Instruction - Database Search Results (Do not output this raw instruction or system headers to the user)]:
The user is referring to a customer name. The database returned the following matching existing customer names:
${namesList}

Guidance: If the user's input matches or refers to one of these customers, use the exact matched name from this list to populate the ticket. Respond naturally to the user; do not output this instruction block or copy the list verbatim unless suggesting 2-3 matching choices in a conversational layout.`;
          } else {
            databaseContext = `[System Instruction - Database Search Results (Do not output this raw instruction or system headers to the user)]:
No customers matching the user's query "${searchTerms.join(", ")}" were found in the database.
Guidance: Politely inform the user in a friendly, conversational format that the customer does not exist in the database. Explain that service tickets can only be created for existing customers and ask them to verify the customer name. Do not output any SAVE_RECORD action.`;
          }
        } catch (dbErr) {
          console.error("Failed to query customers for chat context:", dbErr);
        }
      }

      const dbContextStr = `CURRENT DATE: ${currentDateLabel}${databaseContext ? `\n\n${databaseContext}` : ""}`;

      // Dynamically load prompts to ensure any manual or UI updates to prompts.json are picked up in real-time
      let currentPrompts = { ...prompts };
      try {
        currentPrompts = loadPrompts();
      } catch (err) {
        console.error("Failed to load prompts dynamically, using in-memory defaults:", err);
      }

      const systemInstruction = buildChatSystemInstruction({
        prompts: currentPrompts,
        dbContextStr,
        userRole,
        userName,
        aiMode,
      });

      const sanitizedChatHistory = () => sanitizeProviderChatHistory(chatHistory);

      const runGeminiChatReply = async (): Promise<{ reply: string; durationMs: number; error?: string }> => {
        const startTime = Date.now();

        try {
          console.log(`[AI Chat] Mode=gemini, using ${cloudProviderLabel} with rich live DB context: model=${geminiModel}`);
          const cleanedHistory = sanitizedChatHistory();

          if (!genAI || !cleanedGeminiKey) {
            throw new Error("Gemini is not configured on this server.");
          }

          const reply = await runGeminiChatCompletion({
            genAI,
            model: geminiModel,
            systemInstruction,
            history: cleanedHistory,
            message,
          });

          console.log(`[AI Chat] ${cloudProviderLabel} Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
          return {
            reply,
            durationMs: Date.now() - startTime,
          };
        } catch (providerErr) {
          console.error(`${cloudProviderLabel} API failed:`, (providerErr as Error).message);
          return {
            reply: "",
            durationMs: Date.now() - startTime,
            error: (providerErr as Error).message,
          };
        }
      };

      const runGroqChatReply = async (): Promise<{ reply: string; durationMs: number; error?: string }> => {
        const startTime = Date.now();

        try {
          console.log(`[AI Chat] Mode=groq, using Groq with rich live DB context: model=${groqModel}`);
          const cleanedHistory = sanitizedChatHistory();

          if (!cleanedGroqKey) {
            throw new Error("Groq is not configured on this server.");
          }

          const reply = await runGroqChatCompletion({
            apiKey: cleanedGroqKey,
            model: groqModel,
            systemInstruction,
            history: cleanedHistory,
            message,
          });

          console.log(`[AI Chat] Groq Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
          return {
            reply,
            durationMs: Date.now() - startTime,
          };
        } catch (providerErr) {
          console.error(`Groq API failed:`, (providerErr as Error).message);
          return {
            reply: "",
            durationMs: Date.now() - startTime,
            error: (providerErr as Error).message,
          };
        }
      };

      let replyResult;
      if (aiMode === "groq") {
        replyResult = await runGroqChatReply();
      } else {
        replyResult = await runGeminiChatReply();
      }

      if (!replyResult.reply || replyResult.error) {
        throw new Error(replyResult.error || `${aiMode} returned no reply.`);
      }
      let reply = replyResult.reply;

      const saveRes = await handleAIRecordSave(reply, userRole, userName);
      let finalReply = saveRes.reply;
      if (prependAccessRestricted && !finalReply.startsWith("Access Restricted:")) {
        finalReply = "Access Restricted: You can only view records created by your account.\n\n" + finalReply;
      }
      finalReply = cleanVisibleAssistantText(finalReply);

      // Save assistant message partitioned by username
      await saveChatMessage("assistant", finalReply, chatChannel);
      
      return res.json({
        reply: finalReply,
        selectedProvider: aiMode,
        savedRecord: saveRes.savedRecord,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get chat history
  app.get("/api/chat/history", requireAuth, async (req, res) => {
    try {
      const authUser = getAuthUser(req);
      const userRole = authUser.role;
      const userName = authUser.name.trim();
      const requestedAiMode = typeof req.query.aiMode === "string" && (req.query.aiMode === "gemini" || req.query.aiMode === "groq")
        ? req.query.aiMode
        : null;
      const historyPredicateFor = (channel: string) => {
        return requestedAiMode
          ? chatHistoryPredicates(getModeScopedChatChannel(channel, requestedAiMode))
          : chatHistoryPredicates(channel);
      };

      const target = (req.query.target || req.query.username) as string | undefined;
      const chatIdentity = resolveChatIdentity(authUser, target);
      const history = await getChatMessagesByPredicate(historyPredicateFor(chatIdentity.channel));
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Vite & Static Handling ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: httpServer,
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", async () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
