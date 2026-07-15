import axios from "axios";

export async function runGroqChatCompletion(args: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
}): Promise<string> {
  const messages = [
    { role: "system", content: args.systemInstruction },
    ...args.history.map(h => ({
      role: (h.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: h.content,
    })),
    { role: "user", content: args.message },
  ];

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: args.model,
        messages,
      },
      {
        headers: {
          "Authorization": `Bearer ${args.apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data?.choices?.[0]?.message?.content) {
      return response.data.choices[0].message.content;
    }
    throw new Error("No response choices returned from Groq.");
  } catch (err: any) {
    const errStr = String(err.message || err.stack || err || "");
    const isRateLimitOrTimeout = 
      errStr.includes("RESOURCE_EXHAUSTED") || 
      errStr.includes("quota") || 
      errStr.includes("503") || 
      errStr.includes("429") || 
      errStr.includes("limit") || 
      errStr.includes("UNAVAILABLE") ||
      err.response?.status === 429 ||
      err.response?.status === 503;

    if (isRateLimitOrTimeout) {
      console.warn("[AI Chat] Groq rate limit hit, running local rule-based completion fallback.");
      
      const msg = args.message;
      if (/locator|installation|vehicles|units|connection/i.test(msg)) {
        const qtyMatch = msg.match(/(\d+)\s+(vehicle|unit|device)/i);
        const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
        
        const phoneMatch = msg.match(/(05\d{8}|\+971\s*5\d{8}|\+971\s*[1-9]\d{7})/);
        const phone = phoneMatch ? phoneMatch[0].trim() : "";
        
        const contactMatch = msg.match(/Contact\s+([A-Z][a-zA-Z]+)/);
        const contactName = contactMatch ? contactMatch[1] : "";
        
        let customerName = "Unknown";
        const customerMatch = msg.match(/(?:at|for|customer)\s+([A-Z][a-zA-Z\s]+?)(?=\.|\bContact\b|\bLocation\b|\bPhone\b|$)/);
        if (customerMatch) {
          customerName = customerMatch[1].trim();
        }

        const regionMatch = msg.match(/Location\s+([A-Z]{3}|[A-Z][a-z]+)/i);
        let region = "";
        if (regionMatch) {
          const regStr = regionMatch[1].toUpperCase();
          if (regStr === "AUH") region = "Abu Dhabi";
          else if (regStr === "DXB") region = "Dubai";
          else if (regStr === "SHJ") region = "Sharjah";
          else region = regionMatch[1];
        }

        return `Here is the service request details:
Customer Name : ${customerName}
Quantity     : ${qty}
Payment      : Pending
Amount       : 0.00
Requested Person : admin
Description  : ${msg}

[[SAVE_RECORD:{"type":"service","customer_name":"${customerName}","new_qty":${qty},"amount":"0.00","payment_status":"Pending","requested_person":"admin","issue_description":"${msg}","location":"${region}","phone":"${phone}","contact_name":"${contactName}"}]]`;
      }
    }
    throw err;
  }
}
