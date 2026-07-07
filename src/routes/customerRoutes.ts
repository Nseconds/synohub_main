import type { Express } from "express";
import { desc, eq, like, or } from "drizzle-orm";
import { getAuthUser, requireAuth, requireRoles } from "../auth/middleware";
import { normalizeUserName } from "../auth/users";
import { db } from "../db";
import { customers, serviceRequests } from "../db/schema";
import { CustomerSchema } from "../shared/validation/customer";
import { QuerySchema } from "../shared/validation/query";

export function registerCustomerRoutes(app: Express) {
  app.put("/api/customers/:id", requireAuth, requireRoles("admin"), async (req, res) => {
    res.status(403).json({ error: "CRM writes are disabled. Existing customer records will not be modified." });
  });

  app.delete("/api/customers/:id", requireAuth, requireRoles("admin"), async (req, res) => {
    res.status(403).json({ error: "CRM writes are disabled. Existing customer records will not be modified." });
  });

  app.get("/api/customers", requireAuth, async (req, res) => {
    try {
      const authUser = getAuthUser(req);
      const userRole = authUser.role;
      const userName = normalizeUserName(authUser.name);
      const { search: q } = QuerySchema.parse(req.query);
      const rawResults = q
        ? await db.select().from(customers).where(or(like(customers.name, `%${q}%`), like(customers.contactName, `%${q}%`)))
        : await db.select().from(customers);

      let results = rawResults;
      if (userRole === "guest") {
        results = rawResults.filter(c => normalizeUserName(c.createdBy || "") === userName);
      } else if (userRole === "staff") {
        const rawRequests = await db.select().from(serviceRequests).orderBy(desc(serviceRequests.id)).limit(1000);
        const allowedCustomerNames = new Set(
          rawRequests
            .filter(r => {
              const salesPerson = normalizeUserName(r.salesPerson || "");
              const reqPerson = normalizeUserName(r.requestedPerson || "");
              const createdByVal = normalizeUserName(r.createdBy || "");
              return salesPerson === userName || reqPerson === userName || createdByVal === userName;
            })
            .map(r => normalizeUserName(r.customerName || ""))
        );
        results = rawResults.filter(c => allowedCustomerNames.has(normalizeUserName(c.name || "")) || normalizeUserName(c.createdBy || "") === userName);
      }

      res.json({ results, total: results.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
}
