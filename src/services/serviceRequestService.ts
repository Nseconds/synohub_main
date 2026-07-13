import { eq } from "drizzle-orm";
import { db, getNextId, resolveUserIdByName } from "../db";
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
    const creatorId = await resolveUserIdByName(authUser.name || "guest");
    const [customerResult]: any = await db.insert(customers).values({
      id: nextCustId,
      name: fields.customerName,
      contactName: fields.contactName,
      phone: fields.phone,
      email: fields.email,
      region,
      implementationType: fields.implementationType,
      vehicleCount: fields.quantity,
      createdBy: String(creatorId),
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

  const nextServiceId = await getNextId("tbl_customer_services_beta", "customer_service_id");
  const serviceInsert = {
    id: nextServiceId,
    customerId,
    createdAt: new Date().toISOString().substring(0, 10),
    createdBy: authUser.name.trim() || "guest",
    region,
    status: "new",
    implementationType: fields.implementationType,
    customerName,
    contactName: fields.contactName,
    phone: fields.phone,
    email: fields.email,
    newQty: fields.quantity,
    accessories: fields.accessories || notes || "",
    requestedPerson: fields.requestedPerson,
    salesPerson: fields.requestedPerson,
    amount: fields.amount,
    issueDescription: fields.issueDescription,
    paymentStatus: fields.paymentStatus,
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

  const nextId = await getNextId("tbl_customer_services_beta", "customer_service_id");
  const creatorId = await resolveUserIdByName(payload.source || userName || "guest");
  const requestedPersonId = await resolveUserIdByName(resolvedPerson);
  const salesPersonId = await resolveUserIdByName(leadSalesPerson);
  const [result]: any = await db.insert(serviceRequests).values({
    id: nextId,
    customerId: 0,
    customerName: payload.customerName || "",
    contactName: payload.contactName || "",
    phone: payload.phone || "",
    email: payload.email || "",
    region: payload.region || "",
    address: payload.address || "",
    mapLink: payload.mapLink || "",
    coordinates: payload.coordinates || "",
    createdBy: String(creatorId),
    status: payload.status || "New Lead",
    implementationType: payload.implementationType || "",
    salesPerson: String(salesPersonId),
    requestedPerson: String(requestedPersonId),
    issueDescription: payload.comment || "",
    amount: payload.projectValue || "",
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

  const nextId = await getNextId("tbl_customer_services_beta", "customer_service_id");
  const creatorId = await resolveUserIdByName(userName || "guest");
  const requestedPersonId = await resolveUserIdByName(reqPerson || salesPerson);
  const salesPersonId = await resolveUserIdByName(salesPerson);
  const [result]: any = await db.insert(serviceRequests).values({
    id: nextId,
    customerId: (payload as any).customerId || 0,
    customerName: payload.customerName || "",
    contactName: (payload as any).contactName || "",
    phone: (payload as any).phone || "",
    email: (payload as any).email || "",
    address: (payload as any).address || "",
    mapLink: (payload as any).mapLink || "",
    accessories: (payload as any).accessories || "",
    issueDescription: payload.description || "",
    status: payload.status || "Pending",
    newQty: payload.quantity || 1,
    requestedPerson: String(requestedPersonId),
    paymentStatus: payload.payment || "",
    amount: payload.amount || "",
    salesPerson: String(salesPersonId),
    region: payload.location || payload.region || "",
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

  const creatorId = await resolveUserIdByName(payload.source);
  const salesPersonId = await resolveUserIdByName(payload.salesPerson);
  const requestedPersonId = await resolveUserIdByName(payload.requestedPerson);
  await db.update(serviceRequests).set({
    customerName: custName,
    contactName: payload.contactName,
    phone: payload.phone,
    email: payload.email,
    region: payload.region,
    address: payload.address,
    mapLink: payload.mapLink,
    coordinates: payload.coordinates,
    createdBy: String(creatorId),
    status: payload.status,
    implementationType: payload.implementationType,
    salesPerson: String(salesPersonId),
    requestedPerson: String(requestedPersonId),
    issueDescription: payload.comment,
    amount: payload.projectValue,
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
  const requestedPersonId = await resolveUserIdByName(payload.requestedPerson);
  const salesPersonId = await resolveUserIdByName(payload.assignee);
  await db.update(serviceRequests).set({
    customerName: payload.customerName,
    issueDescription: payload.description,
    status: payload.status,
    newQty: payload.quantity,
    requestedPerson: String(requestedPersonId),
    paymentStatus: payload.payment,
    amount: payload.amount,
    salesPerson: String(salesPersonId),
    region: payload.location || payload.region
  }).where(eq(serviceRequests.id, recordId));
}

export async function deleteServiceTicket(recordId: number) {
  await db.delete(serviceRequests).where(eq(serviceRequests.id, recordId));
}
