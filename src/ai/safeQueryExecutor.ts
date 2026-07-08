import queryRegistry, { applyRoleScope } from "./queryRegistry";
import * as customerRegistry from "./customerQueryRegistry";
import * as exceptionalRegistry from "./exceptionalQueryRegistry";
import type { AuthUser } from "../auth/users";
import {
  providerToDetected,
  validateQueryIntent,
  validateQueryParams,
  type DetectedQueryIntent,
  type QueryProviderResult,
  type SafeQueryIntent,
} from "./queryIntentDetector";
import type { QueryProviderName } from "./aiRouter";
import { formatQueryAnswer } from "./queryAnswerFormatter";

async function classifyActionIntentOnly(): Promise<any[]> {
  return [];
}

export const safeQueryHandlers: Record<SafeQueryIntent, (params: any) => Promise<any[]>> = {
  assignTicket: classifyActionIntentOnly,
  reassignTicket: classifyActionIntentOnly,
  updateTicketStatus: classifyActionIntentOnly,
  deleteTicket: classifyActionIntentOnly,
  cancelTicket: classifyActionIntentOnly,
  createLead: classifyActionIntentOnly,
  createServiceRequest: classifyActionIntentOnly,
  createMigrationTicket: classifyActionIntentOnly,
  createInstallationTicket: classifyActionIntentOnly,
  findCustomerByName: customerRegistry.findCustomerByName,
  findCustomerByPhone: customerRegistry.findCustomerByPhone,
  findCustomerByEmail: customerRegistry.findCustomerByEmail,
  getPendingTicketsByStaff: exceptionalRegistry.getPendingTicketsByStaff,
  getOpenTicketsByRegion: exceptionalRegistry.getOpenTicketsByRegion,
  getTicketsByStaff: exceptionalRegistry.getTicketsByStaff,
  getTicketsByRegion: exceptionalRegistry.getTicketsByRegion,
  getTicketsByServiceType: exceptionalRegistry.getTicketsByServiceType,
  getPendingTickets: exceptionalRegistry.getPendingTickets,
  getOpenTickets: exceptionalRegistry.getOpenTickets,
  getCompletedTickets: exceptionalRegistry.getCompletedTickets,
  getTicketById: exceptionalRegistry.getTicketById,
  getTicketsByStatusLabel: exceptionalRegistry.getTicketsByStatusLabel,
  getCompletedTicketsThisWeek: exceptionalRegistry.getCompletedTicketsThisWeek,
  getTicketsNeedingAttention: exceptionalRegistry.getTicketsNeedingAttention,
  getTicketsByCustomer: exceptionalRegistry.getTicketsByCustomer,
  getOpenTicketsByCustomer: exceptionalRegistry.getOpenTicketsByCustomer,
  getTicketsByIssue: exceptionalRegistry.getTicketsByIssue,
  getUnassignedTickets: exceptionalRegistry.getUnassignedTickets,
  getMostCommonIssues: exceptionalRegistry.getMostCommonIssues,
  getCustomerWithMostRequests: exceptionalRegistry.getCustomerWithMostRequests,
  getCustomerHistory: exceptionalRegistry.getCustomerHistory,
  getCustomerFleetSize: customerRegistry.getCustomerFleetSize,
  getCustomerRegion: customerRegistry.getCustomerRegion,
  getTechnicianWorkload: exceptionalRegistry.getTechnicianWorkload,
  getHighestWorkload: exceptionalRegistry.getHighestWorkload,
  getLowestWorkload: exceptionalRegistry.getLowestWorkload,
  getStaffPerformance: exceptionalRegistry.getStaffPerformance,
  getDuplicateRequests: exceptionalRegistry.getDuplicateRequests,
  getLatestRequests: exceptionalRegistry.getLatestRequests,
  getDashboardSummary: exceptionalRegistry.getDashboardSummary,
  getRegionSummary: exceptionalRegistry.getRegionSummary,
  getStatusSummary: exceptionalRegistry.getStatusSummary,
  getDailySummary: exceptionalRegistry.getDailySummary,
  getMonthlySummary: exceptionalRegistry.getMonthlySummary,
  getStaffChatHistory: exceptionalRegistry.getStaffChatHistory,
  getGuestChatHistory: exceptionalRegistry.getGuestChatHistory,
};

export function canonicalQueryParams(intent: SafeQueryIntent, params: Record<string, any> | undefined): Record<string, any> {
  const canonical: Record<string, any> = { ...(params || {}) };
  for (const key of Object.keys(canonical)) {
    if (canonical[key] === undefined || canonical[key] === null || canonical[key] === false) {
      delete canonical[key];
    }
  }
  if (intent === "getCompletedTicketsThisWeek") {
    delete canonical.dateRange;
  }
  return Object.keys(canonical)
    .sort()
    .reduce((acc: Record<string, any>, key) => {
      acc[key] = canonical[key];
      return acc;
    }, {});
}

export function paramsMatch(intent: SafeQueryIntent, a: Record<string, any> | undefined, b: Record<string, any> | undefined): boolean {
  return JSON.stringify(canonicalQueryParams(intent, a)) === JSON.stringify(canonicalQueryParams(intent, b));
}

export async function runDetectedSafeQuery(
  detected: DetectedQueryIntent,
  authUser: AuthUser,
  queryUser: Pick<AuthUser, "role" | "name">
): Promise<{ params: Record<string, any>; rows: any[]; answer: string }> {
  const validated = validateQueryIntent(detected, safeQueryHandlers);
  const params = validateQueryParams(validated, authUser);
  const roleScope = applyRoleScope(queryUser);
  if (roleScope.sql === "AND 1 = 0") {
    throw Object.assign(new Error("Access restricted. Your authenticated session is not valid for database queries."), { statusCode: 403 });
  }

  const handler = safeQueryHandlers[validated.intent];
  const rows = await handler({
    ...params,
    user: queryUser,
  });

  return {
    params,
    rows,
    answer: formatQueryAnswer(validated.intent, params, rows, queryUser),
  };
}

export async function attachProviderAnswer(
  provider: QueryProviderName,
  providers: Record<QueryProviderName, QueryProviderResult>,
  authUser: AuthUser,
  queryUser: Pick<AuthUser, "role" | "name">
): Promise<any[]> {
  const detected = providerToDetected(providers[provider]);
  if (!detected) return [];

  try {
    const result = await runDetectedSafeQuery(detected, authUser, queryUser);
    providers[provider] = {
      ...providers[provider],
      params: result.params,
      answer: result.answer,
      rowCount: result.rows.length,
    };
    return result.rows;
  } catch (error) {
    providers[provider] = {
      ...providers[provider],
      error: (error as Error).message,
    };
    return [];
  }
}
