import type { Express } from "express";
import { requireAuth, requireRoles } from "../auth/middleware";
import {
  cleanedGeminiKey,
  geminiModel,
  genAI,
} from "../ai/providerConfig";
import { loadPrompts } from "../ai/prompts/promptLoader";

const prompts = loadPrompts();

export function registerAnalyticsRoutes(app: Express) {
  app.post("/api/ingest", requireAuth, requireRoles("admin", "staff"), async (req, res) => {
    try {
      const { rawLog } = req.body;
      if (!rawLog) return res.status(400).json({ error: "Missing raw log" });

      const messages_raw = rawLog.split(/\n(?=\d{2}\/\d{2}\/\d{4},)/g);
      const batch = messages_raw.slice(0, 10).join("\n---\n");

      let currentPrompts = { ...prompts };
      try {
        currentPrompts = loadPrompts();
      } catch (err) {
        console.error("Failed to load prompts dynamically in /api/ingest:", err);
      }

      let rawResponseContent = "";

      if (!genAI || !cleanedGeminiKey) {
        return res.status(503).json({ error: "Gemini is not configured." });
      }

      console.log(`[AI Ingest] Using Gemini API with log extractor prompt: model=${geminiModel}`);
      const startTime = Date.now();
      const response = await genAI.models.generateContent({
        model: geminiModel,
        contents: "Extract records from these logs:\n" + batch,
        config: {
          systemInstruction: currentPrompts.log_extractor,
          responseMimeType: "application/json",
        },
      });
      console.log(`[AI Ingest] Gemini Success in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      rawResponseContent = response.text;

      const content = rawResponseContent.replace(/```json|```/g, "").trim();
      const extracted = JSON.parse(content);
      res.json({ extracted });
    } catch (error) {
      console.error("Ingestion failed:", (error as Error).message);
      res.status(500).json({ error: "Gemini parsing failed.", details: (error as Error).message });
    }
  });

  app.post("/api/ingest/save", requireAuth, requireRoles("admin"), async (req, res) => {
    res.status(403).json({ error: "CRM writes are disabled. Existing database records will not be modified." });
  });
}
