import "dotenv/config";
import express from "express";
import { createServer as createHttpServer } from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { db } from "../db";
import { initDB } from "../db/init";
import { customers, serviceRequests } from "../db/schema";
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
} from "../ai/providerConfig";
import { runGeminiChatCompletion } from "../ai/providers/gemini";
import { answerRequestedPersonLookup } from "../ai/directLookupAnswers";
import {
  isAcknowledgementOnlyMessage,
} from "../ai/recordSaveHandler";
import { buildChatSystemInstruction, loadPrompts } from "../ai";
import {
  normalizeCompareProviders,
  normalizeQueryAiMode,
  type QueryProviderName,
} from "../ai/aiRouter";
import {
  actionIntents,
  detectQueryIntent,
  extractEmail,
  extractPhone,
  extractRegionName,
  normalizeQueryText,
  providerToDetected,
  validateQueryIntent,
  type DetectedQueryIntent,
  type QueryProviderResult,
} from "../ai/queryIntentDetector";
import {
  runGeminiIntentProvider,
} from "../ai/intentProviders";
import {
  runDetectedSafeQuery,
  safeQueryHandlers,
} from "../ai/safeQueryExecutor";
import {
  formatOperationalGreeting,
  isSimpleGreetingMessage,
} from "../ai/queryReportFormatter";
import {
  applyStaffRequestedPersonDefault,
  cleanLocalChatReply,
  cleanVisibleAssistantText,
  formatCompareChatReply,
  getModeScopedChatChannel,
  sanitizeProviderChatHistory,
} from "../ai/responseFormatter";
import {
  type SafeQueryAiMode,
} from "../ai/chatService";
import { registerAnalyticsRoutes } from "./analyticsRoutes";
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
    /\bfor\s+[A-Z0-9][A-Z0-9 .&-]{2,}\b/.test(input);

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

  if (userRole === "staff" && userName) {
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

function chooseQueryProvider(
  mode: SafeQueryAiMode,
  providers: Record<QueryProviderName, QueryProviderResult>
): { winner: QueryProviderName; detected: DetectedQueryIntent; mismatch: boolean } {
  const geminiDetected = providerToDetected(providers.gemini);
  if (geminiDetected) return { winner: "gemini", detected: geminiDetected, mismatch: false };

  throw Object.assign(new Error("Gemini intent detection failed."), { statusCode: 400 });
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
  registerAnalyticsRoutes(app);

  // Safe natural-language query endpoint. This route never asks AI to generate SQL.
  app.post("/api/chat/query", requireAuth, async (req, res) => {
    let detectedForError: DetectedQueryIntent | null = null;
    try {
      const authUser = getAuthUser(req);
      const queryUser = { role: authUser.role, name: authUser.name };
      const chatIdentity = resolveChatIdentity(authUser);
      const message = normalizeQueryText(req.body?.message || req.body?.question || req.body?.query);
      const aiMode = normalizeQueryAiMode(req.body?.aiMode, authUser);
      const compareProviders = normalizeCompareProviders(req.body?.compareProviders);
      const chatChannel = getModeScopedChatChannel(chatIdentity.channel, aiMode);

      if (!message) {
        return res.status(400).json({ error: "Question is required." });
      }

      await saveChatMessage("user", message, chatChannel);

      const recentMessages = await getRecentChatMessages(chatChannel, 8);
      const requestedPersonAnswer = await answerRequestedPersonLookup(message, authUser, recentMessages);
      if (requestedPersonAnswer) {
        const answer = cleanVisibleAssistantText(requestedPersonAnswer);
        await saveChatMessage("assistant", answer, chatChannel);

        return res.json({
          answer,
          reply: answer,
          mode: aiMode,
          winner: "backend",
          intent: "getTicketsByCustomer",
          rows: [],
        });
      }

      const providers: Record<QueryProviderName, QueryProviderResult> = {
        gemini: { durationMs: 0, error: "Not run for this mode." },
      };

      providers.gemini = await runGeminiIntentProvider(message);

      const providerChoice = chooseQueryProvider(aiMode, providers);
      const detected = validateQueryIntent(providerChoice.detected, safeQueryHandlers);
      detectedForError = detected;

      const result = await runDetectedSafeQuery(detected, authUser, queryUser);
      const answer = cleanVisibleAssistantText(result.answer);
      const rows = result.rows;
      providers[providerChoice.winner] = {
        ...providers[providerChoice.winner],
        params: result.params,
        answer,
        rowCount: rows.length,
      };

      await saveChatMessage("assistant", answer, chatChannel);

      return res.json({
        answer,
        mode: aiMode,
        winner: providerChoice.winner,
        intent: detected.intent,
        rows,
      });
    } catch (error: any) {
      const statusCode = typeof error?.statusCode === "number" ? error.statusCode : 500;
      const answer = cleanVisibleAssistantText(error?.message || "Safe query failed.");

      try {
        const authUser = getAuthUser(req);
        const chatIdentity = resolveChatIdentity(authUser);
        const aiMode = normalizeQueryAiMode(req.body?.aiMode, authUser);
        await saveChatMessage("assistant", answer, getModeScopedChatChannel(chatIdentity.channel, aiMode));
      } catch {
        // Do not mask the original query error with a history-write error.
      }

      return res.status(statusCode).json({
        answer,
        intent: detectedForError?.intent || "unknown",
        rows: [],
      });
    }
  });

  // Chat/AI endpoint
  app.post("/api/chat", requireAuth, async (req, res) => {
    try {
      const { message, selectedChatTarget, selectedUsername } = req.body;
      const authUser = getAuthUser(req);
      const aiMode = normalizeQueryAiMode(req.body?.aiMode, authUser);
      const compareProviders = normalizeCompareProviders(req.body?.compareProviders);
      const chatProviderMode = aiMode;
      const chatIdentity = resolveChatIdentity(authUser, selectedChatTarget || selectedUsername);
      let userRole = chatIdentity.role;
      let userName = chatIdentity.name;
      const chatChannel = getModeScopedChatChannel(chatIdentity.channel, aiMode);

      if (authUser.role === "admin" && chatIdentity.channel !== "admin") {
        return res.status(403).json({ error: "Admin can only view guest and staff chats. Switch to Admin chat to send messages." });
      }

      const persistedHistory = await getRecentChatMessages(chatChannel, 12);
      const chatHistory = persistedHistory
        .reverse()
        .map((h: any) => ({ role: h.role, content: h.content }));

      // Save user message (partitioned by username)
      await saveChatMessage("user", message, chatChannel);

      const requestedPersonAnswer = await answerRequestedPersonLookup(message, authUser, persistedHistory);
      if (requestedPersonAnswer) {
        const reply = cleanVisibleAssistantText(requestedPersonAnswer);
        await saveChatMessage("assistant", reply, chatChannel);
        return res.json({
          reply,
          selectedProvider: "backend",
          intent: "requestedPersonLookup",
        });
      }

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

      // Guest security rules check
      let prependAccessRestricted = false;
      if (userRole === "guest") {
        const normalized = message.toLowerCase().trim();
        const isGuestRecordsLookup =
          /\b(latest|last|recent)\s+(\d+\s+)?(record|records|request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          /\b(show|list|view)\s+(my\s+)?(latest|last|recent|record|records|request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          /\b(is\s+)?this\s+(all|only)\s+(by|from)\s+guest\b/.test(normalized);
        const attemptedBlockedAction = 
          normalized.includes("show all") ||
          normalized.includes("list all") ||
          normalized.includes("view all") ||
          normalized.includes("all records") ||
          normalized.includes("all customers") ||
          normalized.includes("all tickets") ||
          normalized.includes("all registrations") ||
          normalized.includes("every request") ||
          normalized.includes("entire database") ||
          normalized.includes("comprehensive") ||
          normalized.includes("workload") || 
          normalized.includes("technician workload") ||
          normalized.includes("database summary") ||
          normalized.includes("system summary") ||
          normalized.includes("system-wide") ||
          normalized.includes("show athul") ||
          normalized.includes("athul tickets") ||
          normalized.includes("other guest") ||
          normalized.includes("other guests") ||
          normalized.includes("complete customer database");

        if (attemptedBlockedAction) {
          prependAccessRestricted = true;
        }

        if (isGuestRecordsLookup && userName) {
          const countMatch = normalized.match(/\b(\d{1,2})\b/);
          const requestedCount = countMatch ? parseInt(countMatch[1], 10) : 10;
          const limitCount = Math.min(Math.max(requestedCount, 1), 25);
          const lowerUser = userName.toLowerCase().trim();
          const guestRows = await db.select().from(serviceRequests)
            .where(eq(serviceRequests.createdBy, lowerUser))
            .orderBy(desc(serviceRequests.id))
            .limit(limitCount);

          const guestReply = cleanVisibleAssistantText(guestRows.length === 0
            ? "Fresh guest session: there are no records or previous chats linked to this guest account yet. You can create a new ticket now, and only records created in this guest session will appear here."
            : formatStaffRecordList(`Latest ${guestRows.length} records for this guest session`, guestRows));

          await saveChatMessage("assistant", guestReply, chatChannel);
          return res.json({ reply: guestReply });
        }
      }

      // Staff security rules check
      if (userRole === "staff") {
        const normalized = normalizeChatLookupText(message);
        const isPendingLookup =
          /\b(my\s+)?pending\s+(request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          /\b(open|ongoing|hold)\s+(request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          normalized === "pending request please" ||
          normalized === "pending requests please";
        const isLatestRecordsLookup =
          /\b(latest|last|recent)\s+(\d+\s+)?(record|records|request|requests|ticket|tickets|lead|leads)\b/.test(normalized) ||
          /\b(show|list|view)\s+(my\s+)?(latest|last|recent)\b/.test(normalized) ||
          /\b(get|show|list|view)\s+(my\s+)?(record|records|request|requests|ticket|tickets|lead|leads|job|jobs|task|tasks|work)\b/.test(normalized) ||
          /\bmy\s+(record|records|request|requests|ticket|tickets|lead|leads|job|jobs|task|tasks|work)\b/.test(normalized);

        const attemptedBlockedAction = 
          normalized.includes("edit ticket") ||
          normalized.includes("update customer details") ||
          normalized.includes("change registration status") ||
          normalized.includes("delete ticket") ||
          normalized.includes("modify previous record") ||
          normalized.includes("modify record") ||
          normalized.includes("change status") ||
          normalized.includes("update customer") ||
          normalized.includes("delete registration") ||
          normalized.includes("edit registration") ||
          normalized.includes("reassign ticket") ||
          normalized.includes("re-assign ticket") ||
          normalized.includes("delete lead") ||
          normalized.includes("edit lead") ||
          normalized.includes("edit customer") ||
          normalized.includes("reassign") ||
          normalized.includes("re-assign") ||
          normalized.includes("delete customer") ||
          normalized.includes("update ticket") ||
          normalized.includes("update details") ||
          normalized.includes("update status") ||
          normalized.includes("modify ticket") ||
          normalized.includes("modify customer") ||
          /\b(edit|delete|modify|reassign|re-assign)\b/.test(normalized);

        if (attemptedBlockedAction) {
          const deniedMessage = cleanVisibleAssistantText("Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator.");
          await saveChatMessage("assistant", deniedMessage, chatChannel);
          return res.json({ reply: deniedMessage });
        }

        if (isPendingLookup && userName) {
          const rawRequests = await db.select().from(serviceRequests)
            .orderBy(desc(serviceRequests.id))
            .limit(1000);
          const lowerUser = userName.toLowerCase().trim();
          const closedStatuses = new Set(["completed", "won", "lost", "duplicate", "deleted"]);
          const pendingRows = rawRequests.filter(r => {
            const salesPerson = (r.salesPerson || "").trim().toLowerCase();
            const reqPerson = (r.requestedPerson || "").trim().toLowerCase();
            const createdByVal = (r.createdBy || "").trim().toLowerCase();
            const status = (r.jobStatus || r.status || "").trim().toLowerCase();
            const belongsToStaff = salesPerson === lowerUser || reqPerson === lowerUser || createdByVal === lowerUser;
            return belongsToStaff && !closedStatuses.has(status);
          }).slice(0, 10);

          const pendingReply = cleanVisibleAssistantText(pendingRows.length === 0
            ? `${userName}, I do not see any pending or open requests assigned to you right now.`
            : formatStaffRecordList(`Pending/open requests for ${userName}`, pendingRows));

          await saveChatMessage("assistant", pendingReply, chatChannel);
          return res.json({ reply: pendingReply });
        }

        if (isLatestRecordsLookup && userName) {
          const countMatch = normalized.match(/\b(\d{1,2})\b/);
          const requestedCount = countMatch ? parseInt(countMatch[1], 10) : 10;
          const limitCount = Math.min(Math.max(requestedCount, 1), 25);
          const rawRequests = await db.select().from(serviceRequests)
            .orderBy(desc(serviceRequests.id))
            .limit(1000);
          const lowerUser = userName.toLowerCase().trim();
          const latestRows = rawRequests.filter(r => {
            const salesPerson = (r.salesPerson || "").trim().toLowerCase();
            const reqPerson = (r.requestedPerson || "").trim().toLowerCase();
            const createdByVal = (r.createdBy || "").trim().toLowerCase();
            return salesPerson === lowerUser || reqPerson === lowerUser || createdByVal === lowerUser;
          }).slice(0, limitCount);

          const latestReply = cleanVisibleAssistantText(latestRows.length === 0
            ? `${userName}, I do not see any records linked to your staff account right now.`
            : formatStaffRecordList(`Latest ${latestRows.length} records for ${userName}`, latestRows));

          await saveChatMessage("assistant", latestReply, chatChannel);
          return res.json({ reply: latestReply });
        }
      }

      // Fetch live DB Context (unified access, no scoping)
      const fetchedCustomers = await db.select().from(customers).orderBy(desc(customers.id)).limit(40);
      const fetchedRequests = await db.select().from(serviceRequests).orderBy(desc(serviceRequests.id)).limit(40);

      // Extract unique alphanumeric keywords from the message to also search older records dynamically
      const keywords = message.toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w: string) => w.length >= 4 && !["what", "show", "list", "with", "this", "that", "please", "lead", "ticket", "status", "save", "update", "customer", "service", "active", "queue", "info", "record", "from"].includes(w));

      if (keywords.length > 0) {
        try {
          // Perform targeted searches to pull in older records if they are explicitly mentioned
          for (const word of keywords) {
            const extraCustomers = await db.select().from(customers).where(or(
              like(customers.name, `%${word}%`),
              like(customers.contactName, `%${word}%`)
            ));
            for (const c of extraCustomers) {
              if (!fetchedCustomers.some(fc => fc.id === c.id)) {
                fetchedCustomers.push(c);
              }
            }

            const extraRequests = await db.select().from(serviceRequests).where(or(
              like(serviceRequests.customerName, `%${word}%`),
              like(serviceRequests.contactName, `%${word}%`),
              like(serviceRequests.issueDescription, `%${word}%`),
              like(serviceRequests.comment, `%${word}%`)
            ));

            for (const r of extraRequests) {
              if (!fetchedRequests.some(fr => fr.id === r.id)) {
                fetchedRequests.push(r);
              }
            }
          }
        } catch (searchError) {
          console.error("Dynamic keyword DB search failed, continuing with cached subset:", (searchError as Error).message);
        }
      }

      // Map requests for lead registrations context description
      const allRegistrations = fetchedRequests.map(r => ({
        id: r.id,
        customerName: r.customerName || "",
        contactName: r.contactName || "",
        region: r.region || "",
        location: r.location || "",
        status: r.status || "New Lead",
        createdAt: r.createdAt || ""
      }));

      // Map requests for technical services context description
      const allServices = fetchedRequests.map(s => ({
        id: s.id,
        customerName: s.customerName || "",
        description: s.issueDescription || s.notes || s.comment || "",
        status: s.jobStatus || "Pending",
        assignee: s.salesPerson || s.requestedPerson || "Unassigned",
        location: s.location || "",
        amount: s.amount || "",
        createdAt: s.createdAt || ""
      }));

      const currentDateLabel = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const dbContextStr = `
CURRENT DATE: ${currentDateLabel}
If the user asks for today, today's, or todays records, use only records whose Created value is ${currentDateLabel}. Do not treat description words like "tomorrow" as today's date.

CURRENT CRM DATABASE RECORDS:
 --- Customers ---
${fetchedCustomers.map((c: any) => ` * ID: ${c.id} | Name: "${c.name}" | Contact Person: "${c.contactName || ''}" | Phone: "${c.phone || ''}" | Region: "${c.region || ''}" | Vehicles count: ${c.vehicleCount || 0}`).join('\n')}

--- Lead Registrations ---
${allRegistrations.map((r: any) => ` * ID: ${r.id} | Created: "${r.createdAt || ''}" | Customer: "${r.customerName}" | Contact Person: "${r.contactName || ''}" | Region: "${r.region || ''}" | Location: "${r.location || ''}" | Status: "${r.status || 'New Lead'}"`).join('\n')}

--- Active Service Queue ---
${allServices.map((s: any) => ` * ID: ${s.id} | Created: "${s.createdAt || ''}" | Customer: "${s.customerName}" | Description: "${s.description || ''}" | Status: "${s.status || 'Ongoing'}" | Assignee: "${s.assignee || 'Unassigned'}" | Location: "${s.location || ''}" | Amount: "${s.amount || ''}"`).join('\n')}
`;

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

      if (isSimpleGreetingMessage(message)) {
        const reply = cleanVisibleAssistantText(formatOperationalGreeting(userName, fetchedRequests));
        await saveChatMessage("assistant", reply, chatChannel);
        return res.json({ reply });
      }

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

      const geminiResult = await runGeminiChatReply();
      if (!geminiResult.reply || geminiResult.error) {
        throw new Error(geminiResult.error || "Gemini returned no reply.");
      }
      let reply = geminiResult.reply;

      let finalReply = reply.replace(/\[{1,2}SAVE_RECORD:[\s\S]*?\]{1,2}/g, "").trim();
      if (prependAccessRestricted && !finalReply.startsWith("Access Restricted:")) {
        finalReply = "Access Restricted: You can only view records created by your account.\n\n" + finalReply;
      }
      finalReply = cleanVisibleAssistantText(finalReply);

      // Save assistant message partitioned by username
      await saveChatMessage("assistant", finalReply, chatChannel);
      
      return res.json({
        reply: finalReply,
        selectedProvider: "gemini",
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
      const requestedAiMode = typeof req.query.aiMode === "string"
        ? normalizeQueryAiMode(req.query.aiMode, authUser)
        : null;
      const historyPredicateFor = (channel: string) => {
        return requestedAiMode
          ? chatHistoryPredicates(getModeScopedChatChannel(channel, requestedAiMode))
          : chatHistoryPredicates(channel);
      };

      let history;
      if (userRole === "admin") {
        // Admins can review a specific channel: admin, guest, or staff:<name>.
        const target = (req.query.target || req.query.username) as string | undefined;
        if (target) {
          const chatIdentity = resolveChatIdentity(authUser, target);
          history = await getChatMessagesByPredicate(historyPredicateFor(chatIdentity.channel));
        } else {
          history = await getChatMessagesByPredicate(historyPredicateFor("admin"));
        }
      } else {
        // Filter by username specifically
        const chatIdentity = resolveChatIdentity(authUser);
        history = await getChatMessagesByPredicate(historyPredicateFor(chatIdentity.channel));
      }
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
