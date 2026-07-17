import crypto from "crypto";
import { eq, like, or } from "drizzle-orm";
import { db, getNextId, resolveUserIdByName } from "../db";
import { customers, serviceRequests } from "../db/schema";
import type { AuthUser } from "../auth/users";
import { SaveRecordSchema } from "../shared/validation/saveRecord";
import { saveLocalSalesplusEntry } from "../services/salesplusService";
import { syncRegistrationCustomer } from "../services/customerService";
import {
  saveForcedServiceRequestFields,
  getCustomerLookupDetails,
  getLocatorDetailsForCustomer,
  type ForcedServiceRequestFields,
  type ForcedServiceRequestResult,
} from "../services/serviceRequestService";
import {
  extractRegionName,
  normalizeQueryText,
  extractRecordTriggerJson,
  findRecordTrigger,
  removeRecordTrigger
} from "./aiUtils";
import { parseForcedServiceRequest } from "./serviceTemplateParser";

function mapInputToSchema(input: any): any {
  if (!input || typeof input !== "object") return {};
  const schema: any = {};

  const getVal = (camel: string, snake: string, ...alts: string[]) => {
    if (input[camel] !== undefined) return input[camel];
    if (input[snake] !== undefined) return input[snake];
    for (const alt of alts) {
      if (input[alt] !== undefined) return input[alt];
    }
    return undefined;
  };

  const assignIfDefined = (targetKey: string, camel: string, snake: string, ...alts: string[]) => {
    const val = getVal(camel, snake, ...alts);
    if (val !== undefined) {
      schema[targetKey] = val;
    }
  };

  assignIfDefined("createdAt", "createdAt", "created_at");
  assignIfDefined("createdBy", "createdBy", "created_by", "source");
  assignIfDefined("region", "region", "region", "location");
  assignIfDefined("status", "status", "status", "jobStatus", "job_status", "salesType", "sales_type");
  assignIfDefined("implementationType", "implementationType", "implementation_type");
  assignIfDefined("customerName", "customerName", "customer_name");
  assignIfDefined("contactName", "contactName", "contact_name");
  assignIfDefined("phone", "phone", "phone");
  assignIfDefined("email", "email", "email");
  assignIfDefined("address", "address", "address");
  assignIfDefined("mapLink", "mapLink", "map_link");
  assignIfDefined("coordinates", "coordinates", "coordinates");

  assignIfDefined("newQty", "newQty", "new_qty", "qty", "quantity", "migrateQty", "migrate_qty", "tradingQty", "trading_qty", "serviceQty", "service_qty", "otherQty", "other_qty");
  assignIfDefined("accessories", "accessories", "accessories", "vehicleDetails", "vehicle_details", "notes");

  assignIfDefined("requestedPerson", "requestedPerson", "requested_person", "requestedBy", "requested_by", "requested", "assignee");
  assignIfDefined("salesPerson", "salesPerson", "sales_person", "assignee", "requestedPerson", "requested_person", "requestedBy", "requested_by");

  assignIfDefined("amount", "amount", "amount", "projectValue", "project_value");
  assignIfDefined("priceDetails", "priceDetails", "price_details");
  assignIfDefined("issueDescription", "issueDescription", "issue_description", "description", "comment");
  assignIfDefined("paymentStatus", "paymentStatus", "payment_status", "payment");

  return schema;
}

function applyRequiredRequestedPerson(mapped: any, userRole: string, userName: string): string {
  let resolvedPerson = String(mapped.requestedPerson || "").trim();
  if (!resolvedPerson && userName) {
    resolvedPerson = userName.trim();
  }
  if (!resolvedPerson) {
    resolvedPerson = String(mapped.salesPerson || "").trim();
  }

  mapped.requestedPerson = resolvedPerson;
  if (!String(mapped.salesPerson || "").trim()) {
    mapped.salesPerson = resolvedPerson;
  }
  return resolvedPerson;
}

function normalizeMappedContactAndCustomer(mapped: any) {
  const customerName = String(mapped.customerName || "").trim();
  if (!customerName.includes("|")) return;

  const parts = customerName.split("|").map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return;

  const contactPart = parts[0];
  const companyPart = parts.slice(1).join(" | ");
  if (!String(mapped.contactName || "").trim()) {
    mapped.contactName = contactPart;
  }
  mapped.customerName = companyPart;
}

function cleanVisibleSavedRecordReply(reply: string): string {
  return reply.replace(
    /^(\s*Customer Name\s*:\s*)([^|\r\n]+?)\s*\|\s*([^\r\n]+)$/gim,
    (_match, prefix, contact, company) => `${prefix}${String(company).trim()}\nContact Name       : ${String(contact).trim()}`
  );
}

const pendingForcedServiceConfirmations = new Map<string, {
  fields: ForcedServiceRequestFields;
  possibleCustomerIds: number[];
  createdAt: number;
}>();

const pendingForcedServiceDrafts = new Map<string, {
  fields: ForcedServiceRequestFields;
  createdAt: number;
}>();

function parseCustomerConfirmationReply(input: string, possibleCustomerIds: number[]): { confirmedCustomerId?: number; forceNewCustomer?: boolean } | null {
  const normalized = normalizeQueryText(input);
  const trimmed = normalized.trim();
  if (
    /^(no|nope)$/i.test(trimmed) ||
    /\b(new customer|create new|new one|different customer|not same|not the same)\b/.test(trimmed)
  ) {
    return { forceNewCustomer: true };
  }

  if (/\b(yes|same|existing|link|use|correct)\b/.test(normalized)) {
    const idMatch = normalized.match(/\b(\d{1,10})\b/);
    const confirmedCustomerId = idMatch ? Number(idMatch[1]) : possibleCustomerIds[0];
    if (confirmedCustomerId && possibleCustomerIds.includes(confirmedCustomerId)) {
      return { confirmedCustomerId };
    }
  }

  return null;
}

function isExpiredPendingConfirmation(createdAt: number): boolean {
  return Date.now() - createdAt > 30 * 60 * 1000;
}

function getMissingForcedServiceFields(fields: ForcedServiceRequestFields, authUser: AuthUser): string[] {
  const missing: string[] = [];
  if (!fields.customerName || fields.customerName === "Unknown") missing.push("Customer Name");
  if (!fields.contactName || isMissingPerson(fields.contactName)) missing.push("Contact Person");
  if (!fields.phone || isMissingPerson(fields.phone)) missing.push("Contact Number");
  if (!fields.implementationType || isMissingPerson(fields.implementationType)) missing.push("Implementation Type");
  if (!fields.issueDescription || isMissingPerson(fields.issueDescription)) missing.push("Description");
  if (!fields.location || isMissingPerson(fields.location)) missing.push("Service Location");
  return missing;
}

function formatMissingForcedServicePrompt(missing: string[]): string {
  if (missing.length === 0) return "";
  if (missing.length === 1) return `Please provide the ${missing[0]} before I save this ticket.`;
  return `Please provide these details before I save this ticket: ${missing.join(", ")}.`;
}

function extractFollowUpPersonValue(input: string, field: "contact" | "requested"): string {
  const text = String(input || "").trim();
  const patterns = field === "contact"
    ? [
      /\buse\s+contact\s+person\s+as\s+(?:name\s+)?(.+)$/i,
      /\bcontact\s+person\s+(?:name\s+)?(?:is|as|:)\s*(.+)$/i,
      /\bcontact\s+name\s+(?:is|as|:)\s*(.+)$/i,
    ]
    : [
      /\buse\s+requested\s+(?:person|by)\s+(?:as\s+)?(.+)$/i,
      /\brequested\s+(?:person|by)\s+(?:is|as|:)\s*(.+)$/i,
      /\bsales\s+person\s+(?:is|as|:)\s*(.+)$/i,
    ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/[.!?]+$/, "").trim();
    }
  }

  return "";
}

function applyForcedServiceFollowUp(input: string, fields: ForcedServiceRequestFields, missing: string[]): ForcedServiceRequestFields {
  const next = { ...fields };
  const contactName = extractFollowUpPersonValue(input, "contact");
  const requestedPerson = extractFollowUpPersonValue(input, "requested");

  if (missing.includes("Contact Person") && contactName) {
    next.contactName = contactName;
  }
  if (missing.includes("Requested Person") && requestedPerson) {
    next.requestedPerson = requestedPerson;
  } else if (missing.length === 1 && missing[0] === "Requested Person") {
    const genericName = input.replace(/^(use|it is|it's|its|name is|person is)\s+/i, "").trim();
    if (genericName && genericName.length <= 80) {
      next.requestedPerson = genericName.replace(/[.!?]+$/, "").trim();
    }
  }

  return next;
}

export function isAcknowledgementOnlyMessage(input: string): boolean {
  return /^(ok|okay|k|kk|yes okay|alright|all right|noted|got it|thanks|thank you|fine)$/i.test(String(input || "").trim());
}

function isMissingPerson(value: string): boolean {
  return !value || /^(n\/?a|na|none|null|-)?$/i.test(value.trim());
}

export async function saveForcedServiceRequestFromMessage(
  input: string,
  authUser: AuthUser,
  chatChannel: string,
): Promise<ForcedServiceRequestResult | null> {
  const pending = pendingForcedServiceConfirmations.get(chatChannel);
  if (pending) {
    if (isExpiredPendingConfirmation(pending.createdAt)) {
      pendingForcedServiceConfirmations.delete(chatChannel);
    } else {
      const decision = parseCustomerConfirmationReply(input, pending.possibleCustomerIds);
      if (decision) {
        pendingForcedServiceConfirmations.delete(chatChannel);
        return saveForcedServiceRequestFields(pending.fields, authUser, extractRegionName, decision);
      }
    }
  }

  const pendingDraft = pendingForcedServiceDrafts.get(chatChannel);
  if (pendingDraft) {
    if (isExpiredPendingConfirmation(pendingDraft.createdAt)) {
      pendingForcedServiceDrafts.delete(chatChannel);
    } else {
      const currentMissing = getMissingForcedServiceFields(pendingDraft.fields, authUser);
      const updatedFields = applyForcedServiceFollowUp(input, pendingDraft.fields, currentMissing);
      await populatePhoneFromCustomerDb(updatedFields);
      const nextMissing = getMissingForcedServiceFields(updatedFields, authUser);
      if (nextMissing.length > 0) {
        pendingForcedServiceDrafts.set(chatChannel, { fields: updatedFields, createdAt: Date.now() });
        return {
          answer: formatMissingForcedServicePrompt(nextMissing),
          customerMatched: false,
          customerCreated: false,
          customerId: 0,
          serviceRequestId: 0,
          salesplusSaved: false,
          fields: updatedFields,
        };
      }

      pendingForcedServiceDrafts.delete(chatChannel);
      const result = await saveForcedServiceRequestFields(updatedFields, authUser, extractRegionName);
      if (result.requiresCustomerConfirmation) {
        pendingForcedServiceConfirmations.set(chatChannel, {
          fields: result.fields,
          possibleCustomerIds: (result.possibleCustomers || []).map(customer => customer.id),
          createdAt: Date.now(),
        });
      }
      return result;
    }
  }

  const parsed = parseForcedServiceRequest(input);
  if (!parsed) return null;
  await populatePhoneFromCustomerDb(parsed);
  const missingFields = getMissingForcedServiceFields(parsed, authUser);
  if (missingFields.length > 0) {
    pendingForcedServiceDrafts.set(chatChannel, { fields: parsed, createdAt: Date.now() });
    return {
      answer: formatMissingForcedServicePrompt(missingFields),
      customerMatched: false,
      customerCreated: false,
      customerId: 0,
      serviceRequestId: 0,
      salesplusSaved: false,
      fields: parsed,
    };
  }
  const result = await saveForcedServiceRequestFields(parsed, authUser, extractRegionName);
  if (result.requiresCustomerConfirmation) {
    pendingForcedServiceConfirmations.set(chatChannel, {
      fields: result.fields,
      possibleCustomerIds: (result.possibleCustomers || []).map(customer => customer.id),
      createdAt: Date.now(),
    });
  }
  return result;
}

async function populatePhoneFromCustomerDb(fields: ForcedServiceRequestFields) {
  if (fields.customerName && fields.customerName !== "Unknown") {
    try {
      const details = await getCustomerLookupDetails(fields.customerName);
      if (details && details.phone && (!fields.phone || isMissingPerson(fields.phone))) {
        fields.phone = details.phone;
      }
    } catch (e) {
      console.warn("[recordSaveHandler] Failed to pre-populate customer phone details:", e);
    }
  }
}

function parseOptionalDate(value: string | undefined): Date | null | undefined {
  if (!value) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseAmountToIntString(val: any): string | null {
  if (val === null || val === undefined) return null;
  const strVal = String(val).trim();
  if (!strVal || /^(not specified|na|n\/a|none|null|-)$/i.test(strVal)) return null;
  const match = strVal.match(/[-+]?[0-9]+/);
  if (match) {
    const num = parseInt(match[0], 10);
    return isNaN(num) ? null : String(num);
  }
  return null;
}

function truncateString(val: any, maxLen: number, fallback = ""): string {
  if (val === null || val === undefined) return fallback;
  return String(val).substring(0, maxLen);
}

function truncateStringNullable(val: any, maxLen: number): string | null {
  if (val === null || val === undefined || String(val).trim() === "") return null;
  return String(val).substring(0, maxLen);
}

export async function handleAIRecordSave(reply: string, userRole: string = "staff", userName: string = ""): Promise<{ reply: string; savedRecord?: any }> {
  const deleteMatch = findRecordTrigger(reply, "DELETE_RECORD");
  if (deleteMatch) {
    try {
      if (userRole !== "admin" && userRole !== "staff") {
        console.warn(`[Security Alert] Non-admin/staff user "${userName}" tried to delete a record via AI.`);
        return {
          reply: removeRecordTrigger(reply, deleteMatch) + "\n\n(Authorization Warning: Access Denied. Only system administrators or staff can delete records.)",
        };
      }

      const rawJson = extractRecordTriggerJson(deleteMatch.body);
      const record = JSON.parse(rawJson);
      const id = parseInt(record.id);
      console.log(`[AI Auto-Delete] Detected record: ${record.type}, ID: ${id}`);
      if (record.type === "registration") {
        await db.delete(serviceRequests).where(eq(serviceRequests.id, id));
        return {
          reply: removeRecordTrigger(reply, deleteMatch) + `\n\n(CRM: Registration record #${id} deleted successfully by Admin.)`,
        };
      } else if (record.type === "service") {
        await db.delete(serviceRequests).where(eq(serviceRequests.id, id));
        return {
          reply: removeRecordTrigger(reply, deleteMatch) + `\n\n(CRM: Service ticket record #${id} deleted successfully by Admin.)`,
        };
      } else if (record.type === "customer") {
        await db.delete(customers).where(eq(customers.id, id));
        return {
          reply: removeRecordTrigger(reply, deleteMatch) + `\n\n(CRM: Customer account record #${id} deleted successfully by Admin.)`,
        };
      }
    } catch (e) {
      console.error("AI Auto-Delete failed:", e);
    }
  }

  const updateMatch = findRecordTrigger(reply, "UPDATE_RECORD");
  if (updateMatch) {
    try {
      const rawJson = extractRecordTriggerJson(updateMatch.body);
      const record = JSON.parse(rawJson);
      const id = parseInt(record.id);
      console.log(`[AI Auto-Update] Detected record update: ${record.type}, ID: ${id}`);

      // Staff and Admin are both allowed to edit records

      if (record.type === "registration") {
        const mappedData = mapInputToSchema(record.data);
        await db.update(serviceRequests).set(mappedData).where(eq(serviceRequests.id, id));
        return {
          reply: removeRecordTrigger(reply, updateMatch) + `\n\n(CRM: Registration #${id} updated successfully.)`,
        };
      } else if (record.type === "service") {
        const mappedData = mapInputToSchema(record.data);
        await db.update(serviceRequests).set(mappedData).where(eq(serviceRequests.id, id));
        return {
          reply: removeRecordTrigger(reply, updateMatch) + `\n\n(CRM: Service ticket #${id} updated successfully.)`,
        };
      } else if (record.type === "customer") {
        if (userRole !== "admin" && userRole !== "staff") {
          return {
            reply: removeRecordTrigger(reply, updateMatch) + "\n\n(Authorization Warning: Access Denied. Only system administrators or staff can edit customer accounts.)",
          };
        }
        const mappedCustomer = {
          name: record.data.name,
          contactName: record.data.contactName,
          phone: record.data.phone,
          email: record.data.email,
          region: record.data.region,
          implementationType: record.data.implementationType,
          address: record.data.address,
        };
        await db.update(customers).set(mappedCustomer).where(eq(customers.id, id));
        return {
          reply: removeRecordTrigger(reply, updateMatch) + `\n\n(CRM: Customer account #${id} updated successfully.)`,
        };
      }
    } catch (e) {
      console.error("AI Auto-Update failed:", e);
    }
  }

  const saveMatch = findRecordTrigger(reply, "SAVE_RECORD");
  if (!saveMatch) return { reply };

  try {
    const rawJson = extractRecordTriggerJson(saveMatch.body);
    const rawRecord = JSON.parse(rawJson);
    const parsedRecord = SaveRecordSchema.safeParse(rawRecord);
    if (!parsedRecord.success) {
      throw new Error("Invalid SAVE_RECORD payload.");
    }
    const record: any = parsedRecord.data;
    console.log(`[AI Auto-Save] Detected record save: ${record.type} by role=${userRole}`);

    if (record.type === "registration") {
      return {
        reply: "Lead and registration creation via the AI chatbot is disabled. Please use the Existing Form page to register new customer leads.",
      };
    } else if (record.type === "service") {
      const ticketId = record.ticketId || (`TKT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`);
      const mapped = mapInputToSchema(record);
      normalizeMappedContactAndCustomer(mapped);
      
      // Verify if customer exists in the database
      let exactMatch: any = null;
      if (mapped.customerName) {
        const inputName = mapped.customerName.trim();
        let matchedCustomers = await db
          .select()
          .from(customers)
          .where(like(customers.name, `%${inputName}%`));

        if (matchedCustomers.length === 0) {
          const words = inputName.split(/\s+/).map(w => w.trim()).filter(w => w.length > 2);
          if (words.length > 0) {
            const conditions = words.map(w => like(customers.name, `%${w}%`));
            matchedCustomers = await db
              .select()
              .from(customers)
              .where(or(...conditions))
              .limit(5);
          }
        }

        if (matchedCustomers.length === 0) {
          return {
            reply: "this user is not exist in db",
          };
        }

        exactMatch = matchedCustomers.find(
          (c) => (c.name || "").trim().toLowerCase() === inputName.toLowerCase()
        );

        if (!exactMatch) {
          const listStr = matchedCustomers
            .map((c) => `- ${c.name}`)
            .join("\n");
          const questionWord = matchedCustomers.length === 1 
            ? "is that the customer you are asking for?" 
            : "did you mean one of these?";
          return {
            reply: `Customer "${inputName}" was not found. Please clarify, ${questionWord}\n${listStr}`,
          };
        } else {
          mapped.customerName = exactMatch.name;
          mapped.customerId = exactMatch.id;
        }
      }

      const customerId = exactMatch ? exactMatch.id : 0;
      const customerName = exactMatch ? exactMatch.name : (mapped.customerName || "Unknown");
      const locatorDetails = await getLocatorDetailsForCustomer(customerName, customerId);
      const customerDetails = await getCustomerLookupDetails(customerName, customerId);

      let finalRegion = mapped.region || mapped.location || "";
      let mapLink = "";
      if (mapped.location && (mapped.location.startsWith("http") || mapped.location.includes("maps."))) {
        mapLink = mapped.location;
        finalRegion = customerDetails.region || exactMatch?.region || "Dubai";
      }

      const contactPhone = mapped.phone || customerDetails.phone || exactMatch?.phone || "";
      const finalDescription = contactPhone 
        ? `${mapped.issueDescription || mapped.description || ""} (Contact: ${contactPhone})` 
        : (mapped.issueDescription || mapped.description || "");

      const requestedPerson = applyRequiredRequestedPerson(mapped, userRole, userName);

      const creatorId = await resolveUserIdByName(String(userName || "guest"));
      const requestedPersonId = await resolveUserIdByName(String(requestedPerson));
      const salesPersonId = requestedPersonId;

      const nextId = await getNextId("tbl_customer_services_beta", "customer_service_id");
      const [res]: any = await db.insert(serviceRequests).values({
        id: nextId,
        customerId: customerId,
        createdAt: new Date().toISOString().substring(0, 10),
        createdBy: String(creatorId),
        region: truncateStringNullable(finalRegion, 20),
        status: mapped.status || "New",
        implementationType: truncateString(mapped.implementationType || "", 25),
        customerName: truncateString(customerName, 100),
        contactName: truncateStringNullable(mapped.contactName || customerDetails.contactName || exactMatch?.contactName || "", 50),
        phone: truncateStringNullable(contactPhone, 20),
        email: truncateStringNullable(mapped.email || customerDetails.email || exactMatch?.email || "", 500),
        customerExpiryDate: parseOptionalDate(locatorDetails.customerExpiryDate),
        locatorPlan: truncateStringNullable(locatorDetails.locatorPlan, 20),
        mapLink,
        newQty: mapped.newQty || mapped.quantity || 1,
        requestedPerson: String(requestedPersonId),
        paymentStatus: (mapped.paymentStatus && mapped.paymentStatus.trim().toLowerCase() === "paid") ? "paid" : "notpaid",
        amount: parseAmountToIntString(mapped.amount),
        salesPerson: String(salesPersonId),
        issueDescription: finalDescription,
      });
      return {
        reply: cleanVisibleSavedRecordReply(removeRecordTrigger(reply, saveMatch)) + `\n\n(CRM: Service ticket ${ticketId} created successfully.)`,
        savedRecord: { ...record, ...mapped, id: nextId, ticketId },
      };
    }
    return { reply: cleanVisibleSavedRecordReply(removeRecordTrigger(reply, saveMatch)) };
  } catch (pErr) {
    console.error("Failed to parse or save AI record:", pErr);
    return {
      reply: cleanVisibleSavedRecordReply(removeRecordTrigger(reply, saveMatch)) + "\n\n(System: Failed to auto-save record. Please try manual entry.)",
    };
  }
}
