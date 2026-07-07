import type { Express } from "express";
import { getAuthUser, requireAuth } from "../auth/middleware";
import {
  createLeadRegistration,
  createServiceTicket,
  deleteLeadRegistration,
  deleteServiceTicket,
  updateLeadRegistration,
  updateServiceTicket,
} from "../services/serviceRequestService";

export function registerServiceRequestRoutes(app: Express) {
  app.post("/api/leads/new", requireAuth, async (req, res) => {
    res.status(403).json({ error: "CRM writes are disabled. Existing database records will not be modified." });
  });

  app.post("/api/services", requireAuth, async (req, res) => {
    res.status(403).json({ error: "CRM writes are disabled. Existing database records will not be modified." });
  });

  app.put("/api/leads/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const authUser = getAuthUser(req);
      const userRole = authUser.role;

      if (userRole === "guest") {
        return res.status(403).json({ error: "Access Denied. Public guest users cannot update records." });
      }

      const recordId = parseInt(id);
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }

      res.status(403).json({ error: "CRM writes are disabled. Existing database records will not be modified." });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/leads/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userRole = getAuthUser(req).role;
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }
      if (userRole !== "admin") {
        return res.status(403).json({ error: "Access Denied. Only system administrators can delete records." });
      }

      res.status(403).json({ error: "CRM writes are disabled. Existing database records will not be modified." });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.put("/api/services/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userRole = getAuthUser(req).role;

      if (userRole === "guest") {
        return res.status(403).json({ error: "Access Denied. Public guest users cannot update records." });
      }

      const recordId = parseInt(id);
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }

      res.status(403).json({ error: "CRM writes are disabled. Existing database records will not be modified." });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/services/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userRole = getAuthUser(req).role;
      if (userRole === "staff") {
        return res.status(403).json({ error: "Access Denied: Staff users can create and view records but cannot modify or delete existing records. Please contact a Manager or Administrator." });
      }
      if (userRole !== "admin") {
        return res.status(403).json({ error: "Access Denied. Only system administrators can delete records." });
      }

      res.status(403).json({ error: "CRM writes are disabled. Existing database records will not be modified." });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
}
