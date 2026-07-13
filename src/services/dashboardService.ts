import { db } from "../db";
import { customers, customersLocator, serviceRequests, users } from "../db/schema";
import { normalizeUserName, type AuthUser } from "../auth/users";
import { eq } from "drizzle-orm";

export async function getDashboardData(authUser: AuthUser) {
  const userRole = authUser.role;
  const userName = normalizeUserName(authUser.name);

  const allCustomers = await db
    .select({
      id: customers.id,
      name: customers.name,
      traccarId: customers.traccarId,
      contactName: customers.contactName,
      phone: customers.phone,
      email: customers.email,
      region: customers.region,
      implementationType: customers.implementationType,
      vehicleCount: customers.vehicleCount,
      createdBy: customers.createdBy,
      address: customers.address,
      customerUsername: customersLocator.customerUsername,
      locatorPlan: customersLocator.locatorPlan,
    })
    .from(customers)
    .leftJoin(customersLocator, eq(customers.name, customersLocator.customerName));

  let allRequests = await db.select().from(serviceRequests);
  const allUsers = await db.select().from(users);

  // Map user IDs to names to avoid displaying legacy numerical IDs
  const userMap = new Map<string, string>();
  allUsers.forEach(u => {
    userMap.set(String(u.id), u.name);
  });

  const resolveUserName = (val: string | number | null | undefined) => {
    if (val === null || val === undefined) return "";
    const strVal = String(val).trim();
    if (!strVal || strVal === "0") return "";
    return userMap.get(strVal) || strVal;
  };

  let filteredCustomers = allCustomers;
  if (userRole === "guest") {
    allRequests = allRequests.filter(r => {
      const createdByVal = (r.createdBy || "").trim().toLowerCase();
      return createdByVal === userName;
    });
    filteredCustomers = allCustomers.filter(c => {
      const createdByVal = (c.createdBy || "").trim().toLowerCase();
      return createdByVal === userName;
    });
  } else if (false && userRole === "staff" && userName) {
    allRequests = allRequests.filter(r => {
      const reqPerson = (r.requestedPerson || "").trim().toLowerCase();
      const salesPerson = (r.salesPerson || "").trim().toLowerCase();
      const createdByVal = (r.createdBy || "").trim().toLowerCase();
      return reqPerson === userName || salesPerson === userName || createdByVal === userName;
    });

    const myCustomerNames = new Set(allRequests.map(r => (r.customerName || "").trim().toLowerCase()));
    filteredCustomers = allCustomers.filter(c => {
      const cName = (c.name || "").trim().toLowerCase();
      const cCreatedBy = (c.createdBy || "").trim().toLowerCase();
      return myCustomerNames.has(cName) || cCreatedBy === userName;
    });
  }

  const allRegistrations = allRequests.map(r => {
    const rawQty = r.newQty || 0;
    const type = (r.implementationType || "").toUpperCase();

    const isMigration = type.includes("MIGRATION");
    const isTrading = type.includes("TRADING");
    const isService = type.includes("SERVICE");
    const isNew = type.includes("LOCATOR") || type.includes("ASATEEL") || type.includes("NEW");

    const newQty = isNew ? rawQty : 0;
    const migrateQty = isMigration ? rawQty : 0;
    const tradingQty = isTrading ? rawQty : 0;
    const serviceQty = isService ? rawQty : 0;
    const otherQty = (!isNew && !isMigration && !isTrading && !isService) ? rawQty : 0;

    return {
      id: r.id,
      customerName: r.customerName || "",
      contactName: r.contactName || "",
      designation: resolveUserName(r.requestedPerson),
      phone: r.phone || "",
      email: r.email || "",
      region: r.region || "",
      address: r.address || "",
      mapLink: r.mapLink || "",
      coordinates: r.coordinates || "",
      source: resolveUserName(r.createdBy),
      status: r.status || "New Lead",
      implementationType: r.implementationType || "",
      salesPerson: resolveUserName(r.salesPerson),
      salesType: r.status || "",
      requestedPerson: resolveUserName(r.requestedPerson),
      comment: r.issueDescription || "",
      projectValue: r.amount ? r.amount.toString() : "",
      priceDetails: r.priceDetails || "",
      accessories: r.accessories || "",
      newQty,
      migrateQty,
      tradingQty,
      serviceQty,
      otherQty,
      createdAt: r.createdAt
    };
  });

  const allServices = allRequests.map(s => {
    const realQty = s.newQty || 1;

    return {
      id: s.id,
      ticketId: s.id ? ("TKT-" + s.id) : "",
      customerName: s.customerName || "",
      description: s.issueDescription || "",
      status: s.status || "Pending",
      quantity: realQty,
      requestedPerson: resolveUserName(s.requestedPerson),
      payment: s.paymentStatus || "",
      invoiceStatus: s.paymentStatus === "PAID" ? "Invoiced" : "Not Invoiced",
      paymentStatus: s.paymentStatus || "",
      amount: s.amount ? s.amount.toString() : "",
      assignee: resolveUserName(s.salesPerson) || resolveUserName(s.requestedPerson) || "",
      createdAt: s.createdAt,
      location: s.region || ""
    };
  });

  return { registrations: allRegistrations, services: allServices, customers: filteredCustomers };
}
