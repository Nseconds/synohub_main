import type { AuthUser } from "./users";
import { normalizeUserName, staffRoster } from "./users";
import { eq, like, or } from "drizzle-orm";
import { messages } from "../db/schema";

export function resolveChatIdentity(authUser: AuthUser, requestedTarget?: unknown) {
  const fallback = {
    role: authUser.role,
    name: authUser.name.trim(),
    channel: authUser.role === "admin"
      ? "admin"
      : `staff:${authUser.name.trim()}`,
  };

  if (typeof requestedTarget === "string") {
    const target = requestedTarget.trim();
    if (target.startsWith("user:")) {
      return { role: authUser.role, name: authUser.name, channel: target };
    }
  }

  if (authUser.role !== "admin" || typeof requestedTarget !== "string") {
    return fallback;
  }

  const target = requestedTarget.trim();
  if (target === "admin") return { role: "admin" as const, name: authUser.name.trim(), channel: "admin" };

  if (target.toLowerCase().startsWith("staff:")) {
    const rawStaffName = target.slice("staff:".length).trim();
    const matchedStaff = staffRoster.find(s => s.toLowerCase() === rawStaffName.toLowerCase());
    const staffName = matchedStaff || rawStaffName;
    if (staffName) return { role: "staff" as const, name: staffName, channel: `staff:${staffName}` };
  }

  return fallback;
}

export function chatHistoryPredicates(channel: string) {
  if (channel.includes("|ai:")) {
    return eq(messages.username, channel);
  }

  const legacyModeChannels = [
    `${channel}|ai:local`,
    `${channel}|ai:gemini`,
    `${channel}|ai:compare`,
  ];

  if (channel.startsWith("staff:")) {
    const staffName = channel.slice("staff:".length);
    return or(
      eq(messages.username, channel),
      eq(messages.username, staffName),
      ...legacyModeChannels.map(legacyChannel => eq(messages.username, legacyChannel)),
    );
  }
  if (channel === "admin") {
    return or(
      eq(messages.username, "admin"),
      eq(messages.username, "Administrator"),
      ...legacyModeChannels.map(legacyChannel => eq(messages.username, legacyChannel)),
    );
  }
  
  return or(
    eq(messages.username, channel),
    ...legacyModeChannels.map(legacyChannel => eq(messages.username, legacyChannel)),
  );
}
