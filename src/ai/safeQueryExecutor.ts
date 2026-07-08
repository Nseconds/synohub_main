import queryRegistry, { applyRoleScope } from "./queryRegistry";
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

async function disabledLookupHandler(): Promise<any[]> {
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
  findCustomerByName: disabledLookupHandler,
  findCustomerByPhone: disabledLookupHandler,
  findCustomerByEmail: disabledLookupHandler,
  getPendingTicketsByStaff: disabledLookupHandler,
  getOpenTicketsByRegion: disabledLookupHandler,
  getTicketsByStaff: disabledLookupHandler,
  getTicketsByRegion: disabledLookupHandler,
  getTicketsByServiceType: disabledLookupHandler,
  getPendingTickets: disabledLookupHandler,
  getOpenTickets: disabledLookupHandler,
  getCompletedTickets: disabledLookupHandler,
  getTicketById: disabledLookupHandler,
  getTicketsByStatusLabel: disabledLookupHandler,
  getCompletedTicketsThisWeek: disabledLookupHandler,
  getTicketsNeedingAttention: disabledLookupHandler,
  getTicketsByCustomer: disabledLookupHandler,
  getOpenTicketsByCustomer: disabledLookupHandler,
  getTicketsByIssue: disabledLookupHandler,
  getUnassignedTickets: disabledLookupHandler,
  getMostCommonIssues: disabledLookupHandler,
  getCustomerWithMostRequests: disabledLookupHandler,
  getCustomerHistory: disabledLookupHandler,
  getCustomerFleetSize: disabledLookupHandler,
  getCustomerRegion: disabledLookupHandler,
  getTechnicianWorkload: disabledLookupHandler,
  getHighestWorkload: disabledLookupHandler,
  getLowestWorkload: disabledLookupHandler,
  getStaffPerformance: disabledLookupHandler,
  getDuplicateRequests: disabledLookupHandler,
  getLatestRequests: disabledLookupHandler,
  getDashboardSummary: disabledLookupHandler,
  getRegionSummary: disabledLookupHandler,
  getStatusSummary: disabledLookupHandler,
  getDailySummary: disabledLookupHandler,
  getMonthlySummary: disabledLookupHandler,
  getStaffChatHistory: disabledLookupHandler,
  getGuestChatHistory: disabledLookupHandler,
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
