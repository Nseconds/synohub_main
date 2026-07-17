import { eq, like } from "drizzle-orm";
import { db, getNextId, pool, resolveUserIdByName } from "../db";
import { customers, serviceRequests } from "../db/schema";
import type { AuthUser } from "../auth/users";
import { saveLocalSalesplusEntry } from "./salesplusService";
import { syncLeadEditCustomer, syncRegistrationCustomer } from "./customerService";
import { normalizeLeadPayload, normalizeServiceTicketPayload } from "../utils/validators";
import { normalizeLocationName } from "../utils/location";

export interface ForcedServiceRequestFields {
  customerName: string;
  contactName: string;
  phone: string;
  email: string;
  driverNumber: string;
  implementationType: string;
  vehiclePlate: string;
  quantity: number;
  issueDescription: string;
  accessories: string;
  location: string;
  preferredDateTime: string;
  requestedPerson: string;
  amount: string;
  paymentStatus: string;
}

export interface PotentialCustomerMatch {
  id: number;
  name: string;
  contactName: string;
  phone: string;
  region: string;
}

export interface ForcedServiceRequestResult {
  answer: string;
  customerMatched: boolean;
  customerCreated: boolean;
  customerId: number;
  serviceRequestId: number;
  salesplusSaved: boolean;
  fields: ForcedServiceRequestFields;
  requiresCustomerConfirmation?: boolean;
  possibleCustomers?: PotentialCustomerMatch[];
}

export interface ForcedServiceRequestSaveOptions {
  confirmedCustomerId?: number;
  forceNewCustomer?: boolean;
}

function normalizeComparablePhone(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function isMissingTemplateValue(value: string): boolean {
  return !value || /^(n\/?a|na|none|null|-)?$/i.test(value.trim());
}

function normalizeComparableName(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
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

function parsePaymentStatus(value: any): "paid" | "notpaid" | null {
  if (!value) return null;
  const str = String(value).trim().toLowerCase();
  if (str === "paid" || str === "yes") return "paid";
  if (str === "notpaid" || str === "not paid" || str === "unpaid" || str === "pending" || str === "no") return "notpaid";
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

export async function getLocatorDetailsForCustomer(customerName: string, customerId?: number | null) {
  const trimmedName = String(customerName || "").trim();
  if (!trimmedName && !customerId) return {};

  try {
    const [rows]: any[] = customerId
      ? await pool.query(
          "SELECT customer_expiry_date, locator_plan FROM customers_locator WHERE customer_id = ? LIMIT 1",
          [customerId],
        )
      : await pool.query(
          "SELECT customer_expiry_date, locator_plan FROM customers_locator WHERE customer_name = ? LIMIT 1",
          [trimmedName],
        );

    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return {};

    return {
      customerExpiryDate: row.customer_expiry_date ? String(row.customer_expiry_date) : undefined,
      locatorPlan: row.locator_plan ? String(row.locator_plan) : undefined,
    };
  } catch (error) {
    console.warn(`[serviceRequestService] Failed to lookup locator details for ${trimmedName || customerId}:`, error);
    return {};
  }
}

export async function getCustomerLookupDetails(customerName: string, customerId?: number | null) {
  const trimmedName = String(customerName || "").trim();
  if (!trimmedName) return {};

  try {
    let matchedCustomer: any = null;

    if (trimmedName) {
      const rows = await db.select().from(customers).where(eq(customers.name, trimmedName)).limit(1);
      matchedCustomer = rows[0] || null;
    }

    if (!matchedCustomer && trimmedName) {
      const rows = await db.select().from(customers).where(like(customers.name, `%${trimmedName}%`)).limit(1);
      matchedCustomer = rows[0] || null;
    }

    if (!matchedCustomer) return {};

    return {
      phone: matchedCustomer.phone ? String(matchedCustomer.phone) : undefined,
      email: matchedCustomer.email ? String(matchedCustomer.email) : undefined,
      contactName: matchedCustomer.contactName ? String(matchedCustomer.contactName) : undefined,
      address: matchedCustomer.address ? String(matchedCustomer.address) : undefined,
      region: matchedCustomer.region ? String(matchedCustomer.region) : undefined,
      implementationType: matchedCustomer.implementationType ? String(matchedCustomer.implementationType) : undefined,
    };
  } catch (error) {
    console.warn(`[serviceRequestService] Failed to lookup customer details for ${trimmedName || customerId}:`, error);
    return {};
  }
}

function toPotentialCustomerMatch(customer: any): PotentialCustomerMatch {
  return {
    id: Number(customer.id || 0),
    name: customer.name || "",
    contactName: customer.contactName || "",
    phone: customer.phone || "",
    region: customer.region || "",
  };
}

async function findSimilarCustomersForConfirmation(fields: ForcedServiceRequestFields): Promise<PotentialCustomerMatch[]> {
  const inputName = normalizeComparableName(fields.customerName);
  if (!inputName || inputName.length < 4) return [];

  const allCustomers = await db.select().from(customers);
  return allCustomers
    .filter(customer => {
      const existingName = normalizeComparableName(customer.name || "");
      if (!existingName || existingName === inputName) return false;
      return existingName.includes(inputName) || inputName.includes(existingName);
    })
    .slice(0, 5)
    .map(toPotentialCustomerMatch);
}

async function findExistingCustomerForServiceRequest(
  fields: ForcedServiceRequestFields,
  options: ForcedServiceRequestSaveOptions = {},
): Promise<any | null> {
  if (options.forceNewCustomer) return null;
  if (options.confirmedCustomerId) {
    const confirmed = await db.select().from(customers).where(eq(customers.id, options.confirmedCustomerId)).limit(1);
    if (confirmed[0]) return confirmed[0];
  }

  const phone = fields.phone.trim();
  const email = fields.email.trim();
  const customerName = fields.customerName.trim();

  if (phone) {
    const exactPhone = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
    if (exactPhone[0]) return exactPhone[0];

    const normalizedInputPhone = normalizeComparablePhone(phone);
    if (normalizedInputPhone) {
      const allCustomers = await db.select().from(customers);
      const normalizedMatch = allCustomers.find(customer => normalizeComparablePhone(customer.phone || "") === normalizedInputPhone);
      if (normalizedMatch) return normalizedMatch;
    }
  }

  if (email) {
    const exactEmail = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
    if (exactEmail[0]) return exactEmail[0];
  }

  if (customerName) {
    const exactName = await db.select().from(customers).where(eq(customers.name, customerName)).limit(1);
    if (exactName[0]) return exactName[0];
  }

  return null;
}

function validateForcedServiceRequestFields(fields: ForcedServiceRequestFields) {
  const missing: string[] = [];
  if (isMissingTemplateValue(fields.customerName) || fields.customerName === "Unknown") missing.push("Customer Name");
  if (isMissingTemplateValue(fields.contactName)) missing.push("Contact Person");
  if (isMissingTemplateValue(fields.phone)) missing.push("Contact Number");
  if (isMissingTemplateValue(fields.implementationType)) missing.push("Implementation Type");
  if (isMissingTemplateValue(fields.issueDescription)) missing.push("Description");
  if (isMissingTemplateValue(fields.location)) missing.push("Service Location");
  if (isMissingTemplateValue(fields.requestedPerson)) missing.push("Requested Person");
  if (missing.length > 0) {
    throw Object.assign(new Error(`Missing required service request fields: ${missing.join(", ")}.`), { statusCode: 400 });
  }
}

export async function saveForcedServiceRequestFields(
  parsed: ForcedServiceRequestFields,
  authUser: AuthUser,
  resolveRegionName: (text: string) => string | null,
  options: ForcedServiceRequestSaveOptions = {},
): Promise<ForcedServiceRequestResult> {
  const fields: ForcedServiceRequestFields = { ...parsed };
  if ((authUser.role === "staff" || authUser.role === "admin") && authUser.name.trim()) {
    fields.requestedPerson = authUser.name.trim();
  }
  validateForcedServiceRequestFields(fields);
  const creatorId = await resolveUserIdByName(authUser.name || "system");

  const matchedCustomer = await findExistingCustomerForServiceRequest(fields, options);
  if (matchedCustomer && !options.forceNewCustomer && !options.confirmedCustomerId) {
    const possibleCustomers = [toPotentialCustomerMatch(matchedCustomer)];
    return {
      answer: [
        "I found an existing customer before saving this service request.",
        "",
        `Your request says: ${fields.customerName}`,
        "",
        `1. ID ${possibleCustomers[0].id} | ${possibleCustomers[0].name}${possibleCustomers[0].contactName ? ` | Contact: ${possibleCustomers[0].contactName}` : ""}${possibleCustomers[0].phone ? ` | Phone: ${possibleCustomers[0].phone}` : ""}${possibleCustomers[0].region ? ` | Region: ${possibleCustomers[0].region}` : ""}`,
        "",
        "Is this the same real customer?",
        `Reply "yes" to link to the existing customer, or reply "new customer" to create ${fields.customerName} as a new customer.`,
      ].join("\n"),
      customerMatched: false,
      customerCreated: false,
      customerId: 0,
      serviceRequestId: 0,
      salesplusSaved: false,
      fields,
      requiresCustomerConfirmation: true,
      possibleCustomers,
    };
  }

  if (!matchedCustomer && !options.forceNewCustomer && !options.confirmedCustomerId) {
    const possibleCustomers = await findSimilarCustomersForConfirmation(fields);
    if (possibleCustomers.length > 0) {
      const matchLines = possibleCustomers.map((customer, index) => {
        const details = [
          customer.contactName ? `Contact: ${customer.contactName}` : "",
          customer.phone ? `Phone: ${customer.phone}` : "",
          customer.region ? `Region: ${customer.region}` : "",
        ].filter(Boolean).join(" | ");
        return `${index + 1}. ID ${customer.id} | ${customer.name}${details ? ` | ${details}` : ""}`;
      });

      return {
        answer: [
          "I found a similar existing customer before saving this service request.",
          "",
          `Your request says: ${fields.customerName}`,
          "",
          ...matchLines,
          "",
          "Is this the same real customer?",
          `Reply "yes" to link to the existing customer, or reply "new customer" to create ${fields.customerName} as a new customer.`,
        ].join("\n"),
        customerMatched: false,
        customerCreated: false,
        customerId: 0,
        serviceRequestId: 0,
        salesplusSaved: false,
        fields,
        requiresCustomerConfirmation: true,
        possibleCustomers,
      };
    }
  }
  let customerId = matchedCustomer?.id ? Number(matchedCustomer.id) : 0;
  let customerCreated = false;
  fields.location = normalizeLocationName(fields.location);
  const region = resolveRegionName(fields.location) || fields.location;

  if (!matchedCustomer) {
    const nextCustId = await getNextId("customers", "id");
    const [customerResult]: any = await db.insert(customers).values({
      id: nextCustId,
      name: truncateString(fields.customerName, 255),
      contactName: truncateStringNullable(fields.contactName, 255),
      phone: truncateStringNullable(fields.phone, 50),
      email: truncateStringNullable(fields.email, 255),
      region: truncateStringNullable(region, 100),
      implementationType: truncateStringNullable(fields.implementationType, 100),
      vehicleCount: fields.quantity,
      createdBy: truncateStringNullable(String(creatorId), 255),
    });
    customerId = nextCustId;
    customerCreated = true;
  }

  const customerName = matchedCustomer?.name || fields.customerName;
  const salesType = matchedCustomer ? "Existing" : "New";
  const notes = [
    fields.preferredDateTime ? `Preferred Date/Time: ${fields.preferredDateTime}` : "",
    fields.driverNumber ? `Driver Number: ${fields.driverNumber}` : "",
  ].filter(Boolean).join("\n");

  const locatorDetails = await getLocatorDetailsForCustomer(customerName, customerId);
  const customerDetails = await getCustomerLookupDetails(customerName, customerId);

  let finalRegion = region;
  let mapLink = "";
  if (fields.location && (fields.location.startsWith("http") || fields.location.includes("maps."))) {
    mapLink = fields.location;
    finalRegion = customerDetails.region || matchedCustomer?.region || "Dubai";
  }

  const contactPhone = fields.phone || customerDetails.phone || matchedCustomer?.phone || "";
  const finalDescription = contactPhone 
    ? `${fields.issueDescription} (Contact: ${contactPhone})` 
    : fields.issueDescription;

  const nextServiceId = await getNextId("tbl_customer_services_beta", "customer_service_id");
  const serviceInsert = {
    id: nextServiceId,
    customerId,
    createdAt: new Date().toISOString().substring(0, 10),
    createdBy: String(creatorId),
    region: truncateStringNullable(finalRegion, 20),
    status: "new",
    implementationType: truncateString(fields.implementationType || "", 25),
    customerName: truncateString(customerName, 100),
    contactName: truncateStringNullable(fields.contactName || customerDetails.contactName || "", 50),
    phone: truncateStringNullable(fields.phone || customerDetails.phone || "", 20),
    email: truncateStringNullable(fields.email || customerDetails.email || "", 500),
    customerExpiryDate: parseOptionalDate(locatorDetails.customerExpiryDate),
    locatorPlan: truncateStringNullable(locatorDetails.locatorPlan, 20),
    mapLink,
    newQty: fields.quantity,
    accessories: fields.accessories || notes || "",
    requestedPerson: fields.requestedPerson,
    salesPerson: fields.requestedPerson,
    amount: parseAmountToIntString(fields.amount),
    issueDescription: finalDescription,
    paymentStatus: parsePaymentStatus(fields.paymentStatus),
  };

  const [serviceResult]: any = await db.insert(serviceRequests).values(serviceInsert);
  const serviceRequestId = nextServiceId;

  let salesplusSaved = false;
  try {
    await saveLocalSalesplusEntry({
      ...serviceInsert,
      customerId,
      customer_id: customerId,
      customerName,
      newQty: fields.quantity,
      requestedPerson: fields.requestedPerson,
    }, serviceRequestId, fields.requestedPerson);
    salesplusSaved = true;
  } catch (salesplusErr) {
    console.error("Failed to save local Salesplus entry for forced service request:", salesplusErr);
  }

  const incompleteContactName = /^(mr|mrs|ms|miss|sir|madam)\.?$/i.test(fields.contactName.trim());
  const answer = [
    matchedCustomer
      ? "Existing customer found, so I linked the service request to that customer and saved it."
      : "No existing customer found, so I created a new customer and saved the service request.",
    "",
    `Request ID: ${serviceRequestId}`,
    `Customer: ${customerName}`,
    fields.contactName ? `Contact Person: ${fields.contactName}${incompleteContactName ? " (incomplete in request)" : ""}` : "",
    `Phone: ${fields.phone}`,
    fields.requestedPerson ? `Requested Person: ${fields.requestedPerson}` : "",
    fields.driverNumber ? `Driver Phone: ${fields.driverNumber}` : "",
    `Type: ${fields.implementationType}`,
    `Issue: ${fields.issueDescription}`,
    fields.vehiclePlate ? `Plate: ${fields.vehiclePlate}` : "",
    `Quantity: ${fields.quantity}`,
    `Location: ${fields.location}`,
    incompleteContactName ? "Note: The contact person field was saved as provided because the full name was missing from the request." : "",
  ].filter(Boolean).join("\n");

  return {
    answer,
    customerMatched: Boolean(matchedCustomer),
    customerCreated,
    customerId,
    serviceRequestId,
    salesplusSaved,
    fields: {
      ...fields,
      customerName,
    },
  };
}

export async function createLeadRegistration(body: any, authUser: AuthUser) {
  const userRole = authUser.role;
  const userName = authUser.name.trim();
  const payload = normalizeLeadPayload(body);
  payload.region = normalizeLocationName(payload.region);

  let reqPerson = payload.requestedPerson || "";
  if ((userRole === "staff" || userRole === "admin") && userName) {
    reqPerson = userName;
  }
  const resolvedPerson = reqPerson || payload.salesPerson || "";
  if (isMissingTemplateValue(resolvedPerson)) {
    throw Object.assign(new Error("Missing required lead fields: Requested Person."), { statusCode: 400 });
  }
  const leadSalesPerson = payload.salesPerson || resolvedPerson;

  const locatorDetails = await getLocatorDetailsForCustomer(payload.customerName || "", Number((payload as any).customerId || 0));
  const nextId = await getNextId("tbl_customer_services_beta", "customer_service_id");
  const creatorId = await resolveUserIdByName(String(payload.source || userName || "guest"));
  const requestedPersonId = await resolveUserIdByName(String(resolvedPerson));
  const salesPersonId = await resolveUserIdByName(String(leadSalesPerson));
  const [result]: any = await db.insert(serviceRequests).values({
    id: nextId,
    customerId: 0,
    customerName: truncateString(payload.customerName || "", 100),
    contactName: truncateStringNullable(payload.contactName, 50),
    phone: truncateStringNullable(payload.phone, 20),
    email: truncateStringNullable(payload.email, 500),
    region: truncateStringNullable(payload.region, 20),
    address: truncateStringNullable(payload.address, 200),
    customerExpiryDate: parseOptionalDate(locatorDetails.customerExpiryDate),
    locatorPlan: truncateStringNullable(locatorDetails.locatorPlan, 20),
    mapLink: payload.mapLink || "",
    coordinates: truncateStringNullable(payload.coordinates, 30),
    createdBy: String(creatorId),
    status: payload.status || "New Lead",
    implementationType: truncateString(payload.implementationType || "", 25),
    salesPerson: String(salesPersonId),
    requestedPerson: String(requestedPersonId),
    issueDescription: payload.comment || "",
    amount: parseAmountToIntString(payload.projectValue),
    priceDetails: payload.priceDetails || "",
    accessories: payload.accessories || "",
    newQty: (payload.newQty || 0) + (payload.migrateQty || 0) + (payload.tradingQty || 0) + (payload.serviceQty || 0) + (payload.otherQty || 0),
    createdAt: new Date().toISOString().substring(0, 10),
  });

  try {
    await saveLocalSalesplusEntry({ ...body, ...payload, requestedPerson: resolvedPerson }, nextId, resolvedPerson);
  } catch (salesplusErr) {
    console.error("Failed to save local Salesplus entry:", salesplusErr);
  }

  try {
    const syncResult = await syncRegistrationCustomer({ ...body, ...payload }, userName || "guest");
    if (syncResult.action === "created") {
      console.log(`[API Leads/New] Synchronized customer ${syncResult.customerName} into customers table.`);
    } else if (syncResult.action === "updated") {
      console.log(`[API Leads/New] Updated existing customer ${syncResult.customerName} vehicleCount to ${syncResult.vehicleCount}`);
    }
  } catch (custErr) {
    console.error("API failed to sync customer:", custErr);
  }

  return result;
}

export async function createServiceTicket(body: any, authUser: AuthUser) {
  const userRole = authUser.role;
  const userName = authUser.name.trim();
  const payload = normalizeServiceTicketPayload(body);
  payload.location = normalizeLocationName(payload.location);
  payload.region = normalizeLocationName(payload.region);

  let reqPerson = payload.requestedPerson || "";
  if ((userRole === "staff" || userRole === "admin") && userName) {
    reqPerson = userName;
  }
  const salesPerson = payload.assignee || (payload as any).salesPerson || reqPerson;
  if (isMissingTemplateValue(reqPerson) && isMissingTemplateValue(salesPerson)) {
    throw Object.assign(new Error("Missing required service request fields: Requested Person."), { statusCode: 400 });
  }

  const locatorDetails = await getLocatorDetailsForCustomer(payload.customerName || "", Number((payload as any).customerId || 0));
  const customerDetails = await getCustomerLookupDetails(payload.customerName || "", Number((payload as any).customerId || 0));
  const nextId = await getNextId("tbl_customer_services_beta", "customer_service_id");
  const creatorId = await resolveUserIdByName(String(userName || "guest"));
  const requestedPersonId = await resolveUserIdByName(String(reqPerson));
  const salesPersonId = requestedPersonId;
  const [result]: any = await db.insert(serviceRequests).values({
    id: nextId,
    customerId: (payload as any).customerId || 0,
    customerName: truncateString(payload.customerName || "", 100),
    contactName: truncateStringNullable((payload as any).contactName, 50),
    phone: truncateStringNullable((payload as any).phone || customerDetails.phone, 20),
    email: truncateStringNullable((payload as any).email || customerDetails.email, 500),
    address: truncateStringNullable((payload as any).address, 200),
    customerExpiryDate: parseOptionalDate(locatorDetails.customerExpiryDate),
    locatorPlan: truncateStringNullable(locatorDetails.locatorPlan, 20),
    mapLink: (payload as any).mapLink || "",
    accessories: (payload as any).accessories || "",
    issueDescription: payload.description || "",
    status: payload.status || "Pending",
    newQty: payload.quantity || 1,
    requestedPerson: String(requestedPersonId),
    paymentStatus: parsePaymentStatus(payload.payment),
    amount: parseAmountToIntString(payload.amount),
    salesPerson: String(salesPersonId),
    region: truncateStringNullable(payload.location || payload.region || "", 20),
    createdAt: new Date().toISOString().substring(0, 10),
    createdBy: String(creatorId),
    jobCreated: 0,
  });

  return result;
}

export async function updateLeadRegistration(recordId: number, body: any) {
  const payload = normalizeLeadPayload(body);
  payload.region = normalizeLocationName(payload.region);
  const custName = payload.customerName;

  const locatorDetails = await getLocatorDetailsForCustomer(String(custName || ""), Number((body as any).customerId || 0));
  const creatorId = await resolveUserIdByName(String(payload.source || ""));
  const salesPersonId = await resolveUserIdByName(String(payload.salesPerson || ""));
  const requestedPersonId = await resolveUserIdByName(String(payload.requestedPerson || ""));
  await db.update(serviceRequests).set({
    customerName: truncateString(custName || "", 100),
    contactName: truncateStringNullable(payload.contactName, 50),
    phone: truncateStringNullable(payload.phone, 20),
    email: truncateStringNullable(payload.email, 500),
    region: truncateStringNullable(payload.region, 20),
    address: truncateStringNullable(payload.address, 200),
    customerExpiryDate: parseOptionalDate(locatorDetails.customerExpiryDate),
    locatorPlan: truncateStringNullable(locatorDetails.locatorPlan, 20),
    mapLink: payload.mapLink,
    coordinates: truncateStringNullable(payload.coordinates, 30),
    createdBy: String(creatorId),
    status: payload.status,
    implementationType: truncateString(payload.implementationType || "", 25),
    salesPerson: String(salesPersonId),
    requestedPerson: String(requestedPersonId),
    issueDescription: payload.comment,
    amount: parseAmountToIntString(payload.projectValue),
    priceDetails: payload.priceDetails,
    accessories: payload.accessories,
    newQty: (payload.newQty || 0) + (payload.migrateQty || 0) + (payload.tradingQty || 0) + (payload.serviceQty || 0) + (payload.otherQty || 0),
  }).where(eq(serviceRequests.id, recordId));

  try {
    const syncResult = await syncLeadEditCustomer({ ...body, ...payload, customerName: custName });
    if (syncResult.action === "created") {
      console.log(`[API Leads/Edit] Created synchronized customer ${syncResult.customerName} on lead edit.`);
    } else if (syncResult.action === "updated") {
      console.log(`[API Leads/Edit] Synchronized existing customer ${syncResult.customerName} details.`);
    }
  } catch (custErr) {
    console.error("API failed to sync customer on update:", custErr);
  }
}

export async function deleteLeadRegistration(recordId: number) {
  await db.delete(serviceRequests).where(eq(serviceRequests.id, recordId));
}

export async function updateServiceTicket(recordId: number, body: any) {
  const payload = normalizeServiceTicketPayload(body);
  payload.location = normalizeLocationName(payload.location);
  payload.region = normalizeLocationName(payload.region);
  const locatorDetails = await getLocatorDetailsForCustomer(String(payload.customerName || ""), Number((body as any).customerId || 0));
  const requestedPersonId = await resolveUserIdByName(String(payload.requestedPerson || ""));
  const salesPersonId = await resolveUserIdByName(String(payload.assignee || ""));
  await db.update(serviceRequests).set({
    customerName: truncateString(payload.customerName || "", 100),
    issueDescription: payload.description,
    status: payload.status,
    newQty: payload.quantity,
    requestedPerson: String(requestedPersonId),
    paymentStatus: parsePaymentStatus(payload.payment),
    amount: parseAmountToIntString(payload.amount),
    customerExpiryDate: parseOptionalDate(locatorDetails.customerExpiryDate),
    locatorPlan: truncateStringNullable(locatorDetails.locatorPlan, 20),
    salesPerson: String(salesPersonId),
    region: truncateStringNullable(payload.location || payload.region || "", 20)
  }).where(eq(serviceRequests.id, recordId));
}

export async function deleteServiceTicket(recordId: number) {
  await db.delete(serviceRequests).where(eq(serviceRequests.id, recordId));
}
