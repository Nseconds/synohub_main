import { pool } from "../db";
import {
  applyRoleScope,
  applyCustomerRoleScope,
  applyChatRoleScope,
  normalizeName,
  limitSql,
  executeRows,
  ticketSelectSql,
  ticketStatusSql,
  createdDateSql,
  dateRangeSql,
  visibleTicketSql,
  openTicketCaseSql,
  type SafeQueryOptions,
  type CustomerHistoryParams,
  type CustomerContactParams,
  type TicketStatusParams,
  type TicketIdQueryParams,
  type StatusLabelQueryParams,
  type StaffQueryParams,
  type RegionQueryParams,
  type ServiceTypeQueryParams,
  type TextSearchQueryParams,
  type ChatHistoryParams,
  type QueryRow,
  type TicketStatusGroup,
  type QueryDateRange,
} from "./queryRegistry";

export async function getCustomerHistory(params: CustomerHistoryParams): Promise<QueryRow[]> {
  const customerName = `%${normalizeName(params.customerName)}%`;
  const roleScope = applyRoleScope(params.user);
  const sql = `
    ${ticketSelectSql()}
    WHERE LOWER(COALESCE(customer_name, '')) LIKE ?
      ${roleScope.sql}
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, [customerName, ...roleScope.params]);
}

export async function getTicketsByStatus(params: TicketStatusParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE 1 = 1
        ${ticketStatusSql(params.statusGroup)}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getPendingTickets(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  return getTicketsByStatus({ ...params, statusGroup: "pending" });
}

export async function getOpenTickets(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  return getTicketsByStatus({ ...params, statusGroup: "open" });
}

export async function getCompletedTickets(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  return getTicketsByStatus({ ...params, statusGroup: "completed" });
}

export async function getLatestRequests(params: LatestRequestsParams = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE 1 = 1
        ${visibleTicketSql()}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getTicketById(params: TicketIdQueryParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    ${ticketSelectSql()}
    WHERE id = ?
      ${roleScope.sql}
    LIMIT 1
  `;

  return executeRows(sql, [params.ticketId, ...roleScope.params]);
}

export async function getTicketsByStatusLabel(params: StatusLabelQueryParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const statusLabel = normalizeName(params.statusLabel);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(job_status, '')) = ?
          OR LOWER(COALESCE(status, '')) = ?
        )
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, [statusLabel, statusLabel, ...roleScope.params]);
}

export async function getCompletedTicketsThisWeek(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE 1 = 1
        ${ticketStatusSql("completed")}
        ${dateRangeSql("this_week")}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getPendingTicketsByStaff(params: StaffQueryParams): Promise<QueryRow[]> {
  const staffName = normalizeName(params.staffName);
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*,
      COUNT(*) OVER() AS totalMatches,
      SUM(CASE WHEN ${openTicketCaseSql()} THEN 1 ELSE 0 END) OVER() AS openMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(requested_person, '')) = ?
          OR LOWER(COALESCE(sales_person, '')) = ?
          OR LOWER(COALESCE(created_by, '')) = ?
        )
        ${ticketStatusSql("pending")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit)}
  `;

  return executeRows(sql, [staffName, staffName, staffName, ...roleScope.params]);
}

export async function getTicketsByStaff(params: StaffQueryParams): Promise<QueryRow[]> {
  const staffName = normalizeName(params.staffName);
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*,
      COUNT(*) OVER() AS totalMatches,
      SUM(CASE WHEN ${openTicketCaseSql()} THEN 1 ELSE 0 END) OVER() AS openMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(requested_person, '')) = ?
          OR LOWER(COALESCE(sales_person, '')) = ?
          OR LOWER(COALESCE(created_by, '')) = ?
        )
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit)}
  `;

  return executeRows(sql, [staffName, staffName, staffName, ...roleScope.params]);
}

export async function getOpenTicketsByRegion(params: RegionQueryParams): Promise<QueryRow[]> {
  const region = normalizeName(params.region);
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(region, '')) = ?
          OR LOWER(COALESCE(location, '')) = ?
        )
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit)}
  `;

  return executeRows(sql, [region, region, ...roleScope.params]);
}

export async function getTicketsByRegion(params: RegionQueryParams): Promise<QueryRow[]> {
  const region = normalizeName(params.region);
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(region, '')) = ?
          OR LOWER(COALESCE(location, '')) = ?
        )
        ${visibleTicketSql()}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit)}
  `;

  return executeRows(sql, [region, region, ...roleScope.params]);
}

export async function getTicketsByServiceType(params: ServiceTypeQueryParams): Promise<QueryRow[]> {
  const serviceType = normalizeName(params.serviceType);
  const roleScope = applyRoleScope(params.user);
  const searchTerm = `%${serviceType}%`;
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(implementation_type, '')) LIKE ?
          OR LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
        )
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, [searchTerm, searchTerm, searchTerm, ...roleScope.params]);
}

export async function getTicketsByCustomer(params: CustomerHistoryParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const searchTerm = `%${normalizeName(params.customerName)}%`;
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE LOWER(COALESCE(customer_name, '')) LIKE ?
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, [searchTerm, ...roleScope.params]);
}

export async function getOpenTicketsByCustomer(params: CustomerHistoryParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const searchTerm = `%${normalizeName(params.customerName)}%`;
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE LOWER(COALESCE(customer_name, '')) LIKE ?
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, [searchTerm, ...roleScope.params]);
}

export async function getTicketsByIssue(params: TextSearchQueryParams): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const normalizedValue = normalizeName(params.value);
  const searchTerm = `%${normalizedValue}%`;
  const region = normalizeName(params.region);
  const regionSql = region
    ? "AND (LOWER(COALESCE(region, '')) = ? OR LOWER(COALESCE(location, '')) = ?)"
    : "";
  const serviceTypeSql = ["installation", "reinstallation", "migration", "device removal"].includes(normalizedValue)
    ? "OR LOWER(COALESCE(implementation_type, '')) LIKE ?"
    : "";
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE (
          LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR LOWER(COALESCE(vehicle_details, '')) LIKE ?
          OR LOWER(COALESCE(notes, '')) LIKE ?
          ${serviceTypeSql}
        )
        ${regionSql}
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, [
    searchTerm,
    searchTerm,
    searchTerm,
    searchTerm,
    ...(serviceTypeSql ? [searchTerm] : []),
    ...(region ? [region, region] : []),
    ...roleScope.params,
  ]);
}

export async function getUnassignedTickets(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, '')) IS NULL
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getTicketsNeedingAttention(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT scoped.*, COUNT(*) OVER() AS totalMatches
    FROM (
      ${ticketSelectSql()}
      WHERE 1 = 1
        ${ticketStatusSql("open")}
        ${dateRangeSql(params.dateRange)}
        AND (
          LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(issue_description, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR LOWER(COALESCE(comment, '')) LIKE ?
          OR COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, '')) IS NULL
        )
        ${roleScope.sql}
    ) scoped
    ORDER BY id DESC
    LIMIT ${limitSql(params.limit, 50)}
  `;
  const attentionTerms = ["%no connection%", "%offline%", "%ignition%", "%tracker not working%", "%battery%"];

  return executeRows(sql, [...attentionTerms, ...attentionTerms, ...roleScope.params]);
}

export async function getTechnicianWorkload(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned') AS staffName,
      COUNT(*) AS totalTickets,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openTickets,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) IN ('pending', 'new', 'new lead', 'hold', 'ongoing') THEN 1 ELSE 0 END) AS pendingTickets,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) IN ('completed', 'won', 'solved') THEN 1 ELSE 0 END) AS completedTickets
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned')
    ORDER BY openTickets DESC, totalTickets DESC, staffName ASC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getMostCommonIssues(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(issue_description, ''), NULLIF(comment, ''), NULLIF(implementation_type, ''), 'Unspecified') AS issue,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords
    FROM service_requests
    WHERE 1 = 1
      ${visibleTicketSql()}
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(issue_description, ''), NULLIF(comment, ''), NULLIF(implementation_type, ''), 'Unspecified')
    ORDER BY totalRecords DESC, openRecords DESC
    LIMIT ${limitSql(params.limit, 20)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getCustomerWithMostRequests(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(customer_name, ''), 'Unknown customer') AS customerName,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords
    FROM service_requests
    WHERE 1 = 1
      ${visibleTicketSql()}
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(customer_name, ''), 'Unknown customer')
    ORDER BY totalRecords DESC, openRecords DESC
    LIMIT ${limitSql(params.limit, 20)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getHighestWorkload(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  return getTechnicianWorkload({ ...params, limit: 1 });
}

export async function getLowestWorkload(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned') AS staffName,
      COUNT(*) AS totalTickets,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openTickets
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned')
    ORDER BY openTickets ASC, totalTickets ASC, staffName ASC
    LIMIT ${limitSql(params.limit, 1)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getStaffPerformance(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned') AS staffName,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) IN ('completed', 'won', 'solved') THEN 1 ELSE 0 END) AS completedRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) IN ('lost', 'deleted', 'duplicate') THEN 1 ELSE 0 END) AS closedNegativeRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) NOT IN ('completed', 'won', 'solved', 'lost', 'deleted', 'duplicate') THEN 1 ELSE 0 END) AS activeRecords
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(requested_person, ''), NULLIF(sales_person, ''), 'Unassigned')
    ORDER BY completedRecords DESC, totalRecords DESC, staffName ASC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getDuplicateRequests(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      LOWER(TRIM(COALESCE(customer_name, ''))) AS customerKey,
      LOWER(TRIM(COALESCE(issue_description, comment, ''))) AS issueKey,
      MIN(id) AS firstId,
      MAX(id) AS latestId,
      COUNT(*) AS duplicateCount,
      MAX(customer_name) AS customerName,
      MAX(issue_description) AS issueDescription,
      MAX(comment) AS comment
    FROM service_requests
    WHERE
      TRIM(COALESCE(customer_name, '')) <> ''
      AND TRIM(COALESCE(issue_description, comment, '')) <> ''
      ${roleScope.sql}
    GROUP BY
      LOWER(TRIM(COALESCE(customer_name, ''))),
      LOWER(TRIM(COALESCE(issue_description, comment, '')))
    HAVING COUNT(*) > 1
    ORDER BY duplicateCount DESC, latestId DESC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getDashboardSummary(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const customerRoleScope = applyCustomerRoleScope(params.user);
  const sql = `
    SELECT
      COUNT(*) AS totalRecords,
      (SELECT COUNT(*) FROM customers c WHERE 1 = 1 ${customerRoleScope.sql}) AS registeredCustomers,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('new lead', 'new') OR LOWER(COALESCE(job_status, '')) = 'new' THEN 1 ELSE 0 END) AS newRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) IN ('completed', 'won', 'solved') THEN 1 ELSE 0 END) AS completedRecords,
      SUM(COALESCE(new_qty, 0) + COALESCE(migrate_qty, 0) + COALESCE(trading_qty, 0) + COALESCE(service_qty, 0) + COALESCE(other_qty, 0)) AS totalUnits,
      COUNT(DISTINCT customer_name) AS uniqueCustomers
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
  `;

  return executeRows(sql, [...customerRoleScope.params, ...roleScope.params]);
}

export async function getRegionSummary(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const regionFilter = params.region
    ? "AND LOWER(COALESCE(NULLIF(region, ''), NULLIF(location, ''), 'Unknown')) = ?"
    : "";
  const sql = `
    SELECT
      COALESCE(NULLIF(region, ''), NULLIF(location, ''), 'Unknown') AS region,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords,
      SUM(COALESCE(new_qty, 0) + COALESCE(migrate_qty, 0) + COALESCE(trading_qty, 0) + COALESCE(service_qty, 0) + COALESCE(other_qty, 0)) AS totalUnits
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${regionFilter}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(region, ''), NULLIF(location, ''), 'Unknown')
    ORDER BY totalRecords DESC, region ASC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, [
    ...(params.region ? [normalizeName(params.region)] : []),
    ...roleScope.params,
  ]);
}

export async function getStatusSummary(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      COALESCE(NULLIF(status, ''), NULLIF(job_status, ''), 'Unknown') AS status,
      COUNT(*) AS totalRecords
    FROM service_requests
    WHERE 1 = 1
      ${dateRangeSql(params.dateRange)}
      ${roleScope.sql}
    GROUP BY COALESCE(NULLIF(status, ''), NULLIF(job_status, ''), 'Unknown')
    ORDER BY totalRecords DESC, status ASC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getDailySummary(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      CASE
        WHEN created_at IS NULL OR TRIM(created_at) = '' THEN DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d')
        ELSE TRIM(created_at)
      END AS day,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) IN ('completed', 'won', 'solved') THEN 1 ELSE 0 END) AS completedRecords,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords
    FROM service_requests
    WHERE 1 = 1
      ${roleScope.sql}
    GROUP BY CASE
        WHEN created_at IS NULL OR TRIM(created_at) = '' THEN DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d')
        ELSE TRIM(created_at)
      END
    ORDER BY day DESC
    LIMIT ${limitSql(params.limit, 7)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getMonthlySummary(params: SafeQueryOptions = {}): Promise<QueryRow[]> {
  const roleScope = applyRoleScope(params.user);
  const sql = `
    SELECT
      LEFT(CASE
        WHEN created_at IS NULL OR TRIM(created_at) = '' THEN DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d')
        ELSE TRIM(created_at)
      END, 7) AS month,
      COUNT(*) AS totalRecords,
      SUM(CASE WHEN LOWER(COALESCE(status, job_status, '')) IN ('completed', 'won', 'solved') THEN 1 ELSE 0 END) AS completedRecords,
      SUM(CASE WHEN LOWER(COALESCE(job_status, status, '')) NOT IN ('completed', 'won', 'lost', 'duplicate', 'deleted', 'solved') THEN 1 ELSE 0 END) AS openRecords
    FROM service_requests
    WHERE 1 = 1
      ${roleScope.sql}
    GROUP BY LEFT(CASE
        WHEN created_at IS NULL OR TRIM(created_at) = '' THEN DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d')
        ELSE TRIM(created_at)
      END, 7)
    ORDER BY month DESC
    LIMIT ${limitSql(params.limit, 12)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getStaffChatHistory(params: ChatHistoryParams = {}): Promise<QueryRow[]> {
  const roleScope = applyChatRoleScope(params.user, params.channelName);
  const sql = `
    SELECT id, role, content, timestamp, username
    FROM messages
    WHERE username LIKE 'staff:%'
      ${roleScope.sql}
    ORDER BY timestamp DESC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export async function getGuestChatHistory(params: ChatHistoryParams = {}): Promise<QueryRow[]> {
  const roleScope = applyChatRoleScope(params.user, params.channelName);
  const sql = `
    SELECT id, role, content, timestamp, username
    FROM messages
    WHERE username LIKE 'guest:%'
      ${roleScope.sql}
    ORDER BY timestamp DESC
    LIMIT ${limitSql(params.limit, 25)}
  `;

  return executeRows(sql, roleScope.params);
}

export interface LatestRequestsParams extends SafeQueryOptions {
  limit?: number;
}
