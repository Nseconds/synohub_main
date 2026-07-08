import type { RowDataPacket } from "mysql2";
import { pool } from "../db";

export type SafeQueryRole = "admin" | "staff" | "guest";
export type TicketStatusGroup = "pending" | "open" | "completed" | "latest";
export type QueryDateRange = "today" | "this_week" | "this_month";

export interface SafeQueryUser {
  role: SafeQueryRole;
  name: string;
}

export interface SafeQueryOptions {
  user?: SafeQueryUser;
  limit?: number;
  dateRange?: QueryDateRange;
  countOnly?: boolean;
  region?: string;
}

export interface StaffQueryParams extends SafeQueryOptions {
  staffName: string;
}

export interface RegionQueryParams extends SafeQueryOptions {
  region: string;
}

export interface ServiceTypeQueryParams extends SafeQueryOptions {
  serviceType: string;
}

export interface TicketIdQueryParams extends SafeQueryOptions {
  ticketId: number;
}

export interface StatusLabelQueryParams extends SafeQueryOptions {
  statusLabel: string;
}

export interface TextSearchQueryParams extends SafeQueryOptions {
  value: string;
  region?: string;
}

export interface CustomerHistoryParams extends SafeQueryOptions {
  customerName: string;
}

export interface CustomerContactParams extends SafeQueryOptions {
  value: string;
}

export interface TicketStatusParams extends SafeQueryOptions {
  statusGroup: TicketStatusGroup;
}

export interface ChatHistoryParams extends SafeQueryOptions {
  channelName?: string;
}

export interface LatestRequestsParams extends SafeQueryOptions {
  limit?: number;
}

export interface RoleScope {
  sql: string;
  params: Array<string>;
}

export interface QueryRow extends RowDataPacket {
  [key: string]: any;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export function normalizeName(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeLimit(value: number | undefined, fallback = DEFAULT_LIMIT): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), MAX_LIMIT));
}

export function limitSql(value: number | undefined, fallback = DEFAULT_LIMIT): string {
  return String(normalizeLimit(value, fallback));
}

export function createdDateSql(): string {
  return `
    COALESCE(
      STR_TO_DATE(NULLIF(TRIM(created_at), ''), '%Y-%m-%d'),
      STR_TO_DATE(NULLIF(TRIM(created_at), ''), '%d/%m/%Y'),
      STR_TO_DATE(NULLIF(TRIM(created_at), ''), '%d-%m-%Y')
    )
  `;
}

export function dateRangeSql(dateRange?: QueryDateRange): string {
  if (dateRange === "today") {
    return `AND DATE(${createdDateSql()}) = CURDATE()`;
  }
  if (dateRange === "this_week") {
    return `AND ${createdDateSql()} >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`;
  }
  if (dateRange === "this_month") {
    return `AND ${createdDateSql()} >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`;
  }
  return "";
}

export function visibleTicketSql(): string {
  return "AND LOWER(COALESCE(job_status, status, '')) NOT IN ('deleted', 'lost', 'duplicate')";
}

export function openTicketCaseSql(): string {
  return "LOWER(COALESCE(jobStatus, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved')";
}

function isSafeQueryRole(role: unknown): role is SafeQueryRole {
  return role === "admin" || role === "staff" || role === "guest";
}

function getQueryUser(user?: SafeQueryUser): Required<SafeQueryUser> | null {
  if (!user || !isSafeQueryRole(user.role) || !user.name) return null;
  return {
    role: user.role,
    name: user.name || "",
  };
}

export function applyRoleScope(user?: SafeQueryUser): RoleScope {
  return { sql: "", params: [] };
}

export function applyCustomerRoleScope(user?: SafeQueryUser): RoleScope {
  return { sql: "", params: [] };
}

export function applyChatRoleScope(user?: SafeQueryUser, channelName?: string): RoleScope {
  const requestedChannel = String(channelName || "").trim();
  if (!requestedChannel) {
    return { sql: "", params: [] };
  }
  return {
    sql: "AND username = ?",
    params: [requestedChannel],
  };
}

export async function executeRows<T extends QueryRow>(sql: string, params: Array<string | number>): Promise<T[]> {
  const [rows] = await pool.execute<T[]>(sql, params);
  return rows;
}

export function ticketSelectSql(): string {
  return `
    SELECT
      id,
      customer_name AS customerName,
      contact_name AS contactName,
      phone,
      email,
      region,
      location,
      status,
      job_status AS jobStatus,
      implementation_type AS implementationType,
      requested_person AS requestedPerson,
      sales_person AS salesPerson,
      issue_description AS issueDescription,
      comment,
      project_value AS projectValue,
      new_qty AS newQty,
      migrate_qty AS migrateQty,
      trading_qty AS tradingQty,
      service_qty AS serviceQty,
      other_qty AS otherQty,
      created_at AS createdAt,
      created_by AS createdBy
    FROM service_requests
  `;
}

export function ticketStatusSql(statusGroup: TicketStatusGroup): string {
  if (statusGroup === "completed") {
    return "AND LOWER(COALESCE(job_status, status, '')) IN ('completed', 'won', 'solved')";
  }
  if (statusGroup === "pending") {
    return "AND LOWER(COALESCE(job_status, status, '')) IN ('pending', 'new', 'new lead', 'hold', 'ongoing')";
  }
  if (statusGroup === "open") {
    return "AND LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved')";
  }
  return "";
}

export const formatterExamples = {
  findCustomerByName: "Found 2 customers matching ARKAN ALDAR.",
  getPendingTicketsByStaff: "Athul currently has 8 pending tickets.",
  getOpenTicketsByRegion: "Dubai currently has 12 open tickets.",
  getTechnicianWorkload: "Technician workload summary: Athul: 8 open / 12 total.",
  getDashboardSummary: "Dashboard summary: Total records: 120, Open records: 34.",
};

export const validationRules = {
  noDynamicSql: true,
  noAiGeneratedSql: true,
  maxLimit: MAX_LIMIT,
  requireBackendUser: true,
  staffScope: "requested_person OR sales_person OR created_by must match authenticated staff name",
  guestScope: "created_by must match authenticated guest username",
};

export const queryRegistry = {
  applyRoleScope,
  applyCustomerRoleScope,
  applyChatRoleScope,
  formatterExamples,
  validationRules,
};

export default queryRegistry;
