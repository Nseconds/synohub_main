import { staffRoster } from "../auth/users";
import { buildIntentDetectorSystemPrompt } from "./intentService";
import {
  detectQueryIntent,
  parseProviderIntent,
  type DetectedQueryIntent,
  type QueryProviderResult,
} from "./queryIntentDetector";
import type { QueryProviderName } from "./aiRouter";
import {
  cleanedGeminiKey,
  cloudProviderLabel,
  geminiModel,
  genAI,
} from "./providerConfig";
import { cleanVisibleAssistantText } from "./responseFormatter";
import { paramsMatch, safeQueryHandlers } from "./safeQueryExecutor";

export function getProviderLabel(_provider: QueryProviderName): string {
  return "Gemini";
}

export function formatProviderError(_provider: QueryProviderName, error: string): string {
  return cleanVisibleAssistantText(error);
}

export async function runGeminiIntentProvider(message: string): Promise<QueryProviderResult> {
  const startTime = Date.now();
  console.log(`[Safe Query] Mode=gemini, using ${cloudProviderLabel} intent detector: model=${geminiModel}.`);

  try {
    const deterministic = detectQueryIntent(message);
    if (!genAI || !cleanedGeminiKey) {
      if (deterministic) {
        return { ...deterministic, durationMs: Date.now() - startTime };
      }
      throw new Error("Gemini is not configured on this server.");
    }

    const allowedIntents = Object.keys(safeQueryHandlers).join(", ");
    const detectorSystemInstruction = buildIntentDetectorSystemPrompt({
      kind: "gemini",
      allowedIntents,
      staffNames: staffRoster,
    });

    const response = await genAI.models.generateContent({
      model: geminiModel,
      contents: `User question: ${message}`,
      config: {
        systemInstruction: detectorSystemInstruction,
        responseMimeType: "application/json",
      },
    });

    const detected = parseProviderIntent(response.text || "", safeQueryHandlers);
    if (
      deterministic &&
      ["getTicketsByStaff", "getPendingTicketsByStaff"].includes(deterministic.intent) &&
      ["findCustomerByName", "getCustomerHistory", "getCustomerFleetSize", "getCustomerRegion"].includes(detected.intent)
    ) {
      return {
        ...deterministic,
        confidence: Math.max(deterministic.confidence, detected.confidence),
        durationMs: Date.now() - startTime,
      };
    }

    if (deterministic?.intent === "getTicketsByServiceType" && detected.intent !== "getTicketsByServiceType") {
      return {
        ...deterministic,
        confidence: Math.max(deterministic.confidence, 0.94),
        durationMs: Date.now() - startTime,
      };
    }

    if (deterministic && deterministic.confidence >= 0.9) {
      const sameIntentDifferentParams = deterministic.intent === detected.intent && !paramsMatch(deterministic.intent, deterministic.params, detected.params);
      const highConfidenceDisagreement = deterministic.intent !== detected.intent;
      if (sameIntentDifferentParams || highConfidenceDisagreement) {
        return {
          ...deterministic,
          confidence: Math.max(deterministic.confidence, detected.confidence),
          durationMs: Date.now() - startTime,
        };
      }
    }

    return {
      ...detected,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      durationMs: Date.now() - startTime,
      error: (error as Error).message,
    };
  }
}

export function runIntentDetectorFallback(message: string): Promise<DetectedQueryIntent | null> {
  return Promise.resolve(detectQueryIntent(message));
}
