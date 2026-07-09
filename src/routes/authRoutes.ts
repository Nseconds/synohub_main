import bcrypt from "bcryptjs";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { issueToken } from "../auth/jwt";
import { db } from "../db";
import { users } from "../db/schema";

function normalizeBcryptHash(hash: string) {
  return hash.startsWith("$2y$") ? `$2a$${hash.slice(4)}` : hash;
}

function roleFromUserType(userType: string) {
  return "admin" as const;
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    const normalizedUser = username.trim().toLowerCase();

    try {
      const [user] = await db.select().from(users).where(eq(users.username, normalizedUser)).limit(1);
      if (!user || user.status !== "active" || !user.password) {
        return res.status(401).json({ error: "Incorrect username or password." });
      }

      const passwordMatches = await bcrypt.compare(password, normalizeBcryptHash(user.password));
      if (!passwordMatches) {
        return res.status(401).json({ error: "Incorrect username or password." });
      }

      const isFeroz = normalizedUser === "feroz" || normalizedUser === "feros" || 
                      user.name.trim().toLowerCase() === "feroz" || user.name.trim().toLowerCase() === "feros";
      const isDevTeam = user.type.trim().toLowerCase() === "development team";
      if (isDevTeam && !isFeroz) {
        return res.status(401).json({ error: "Access Denied. Development team members do not have access." });
      }

      const role = roleFromUserType(user.type);
      const authUser = { sub: `user:${user.id}`, role, name: user.name.trim() || user.username };
      return res.json({
        success: true,
        token: issueToken(authUser),
        role: authUser.role,
        name: authUser.name,
      });
    } catch (error) {
      console.error("Login failed:", error);
      return res.status(500).json({ error: "Login failed. Please try again." });
    }
  });
}
