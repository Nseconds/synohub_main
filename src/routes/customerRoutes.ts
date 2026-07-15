import type { Express } from "express";
import { desc, eq, like, or, sql } from "drizzle-orm";
import { getAuthUser, requireAuth, requireRoles } from "../auth/middleware";
import { normalizeUserName } from "../auth/users";
import { db } from "../db";
import { customers, customersLocator, serviceRequests } from "../db/schema";
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

      const baseQuery = db
        .select({
          id: customers.id,
          name: customers.name,
          traccarId: customersLocator.customerTraccarId,
          contactName: customers.contactName,
          phone: customers.phone,
          email: customers.email,
          region: customers.region,
          implementationType: customers.implementationType,
          vehicleCount: customers.vehicleCount,
          createdBy: customers.createdBy,
          address: sql<string | null>`NULL`,
          customerUsername: customersLocator.customerUsername,
          locatorPlan: customersLocator.locatorPlan,
        })
        .from(customers)
        .leftJoin(customersLocator, eq(customers.name, customersLocator.customerName));

      const rawResults = q
        ? await baseQuery.where(or(like(customers.name, `%${q}%`), like(customers.contactName, `%${q}%`)))
        : await baseQuery;

      const results = rawResults;
      res.json({ results, total: results.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
}
