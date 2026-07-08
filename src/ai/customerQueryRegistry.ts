import type { RowDataPacket } from "mysql2";
import {
  applyCustomerRoleScope,
  applyRoleScope,
  normalizeName,
  limitSql,
  executeRows,
  type SafeQueryOptions,
  type CustomerHistoryParams,
  type CustomerContactParams,
  type QueryRow,
} from "./queryRegistry";

function customerSelectSql(): string {
  return `
    SELECT
      c.id,
      c.name,
      c.contact_name AS contactName,
      c.phone,
      c.email,
      c.region,
      c.implementation_type AS implementationType,
      c.vehicle_count AS vehicleCount,
      c.created_by AS createdBy
    FROM customers c
  `;
}

export async function findCustomerByName(params: CustomerContactParams): Promise<QueryRow[]> {
  const customerRoleScope = applyCustomerRoleScope(params.user);
  const requestRoleScope = applyRoleScope(params.user);
  const normalizedValue = normalizeName(params.value);
  const compactValue = normalizedValue.replace(/\s+/g, "");
  const firstWord = normalizedValue.split(/\s+/).find(Boolean) || normalizedValue;
  const sql = `
    SELECT *
    FROM (
      SELECT
        c.id,
        c.name,
        c.contact_name AS contactName,
        c.phone,
        c.email,
        c.region,
        c.implementation_type AS implementationType,
        c.vehicle_count AS vehicleCount,
        c.created_by AS createdBy,
        'customer' AS sourceType,
        1 AS sourceRank
      FROM customers c
      WHERE (
        LOWER(COALESCE(c.name, '')) LIKE ?
        OR LOWER(REPLACE(COALESCE(c.name, ''), ' ', '')) LIKE ?
        OR SOUNDEX(COALESCE(c.name, '')) = SOUNDEX(?)
        OR LOWER(COALESCE(c.name, '')) LIKE ?
      )
        ${customerRoleScope.sql}

      UNION ALL

      SELECT
        MAX(id) AS id,
        customer_name AS name,
        MAX(contact_name) AS contactName,
        MAX(phone) AS phone,
        MAX(email) AS email,
        MAX(region) AS region,
        MAX(implementation_type) AS implementationType,
        SUM(COALESCE(new_qty, 0) + COALESCE(migrate_qty, 0) + COALESCE(trading_qty, 0) + COALESCE(service_qty, 0) + COALESCE(other_qty, 0)) AS vehicleCount,
        MAX(created_by) AS createdBy,
        'service_request' AS sourceType,
        2 AS sourceRank
      FROM service_requests
      WHERE COALESCE(customer_name, '') <> ''
        AND (
          LOWER(COALESCE(customer_name, '')) LIKE ?
          OR LOWER(REPLACE(COALESCE(customer_name, ''), ' ', '')) LIKE ?
          OR SOUNDEX(COALESCE(customer_name, '')) = SOUNDEX(?)
          OR LOWER(COALESCE(customer_name, '')) LIKE ?
        )
        ${requestRoleScope.sql}
      GROUP BY customer_name
    ) matched_customers
    ORDER BY sourceRank ASC, id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, [
    `%${normalizedValue}%`,
    `%${compactValue}%`,
    normalizedValue,
    `%${firstWord}%`,
    ...customerRoleScope.params,
    `%${normalizedValue}%`,
    `%${compactValue}%`,
    normalizedValue,
    `%${firstWord}%`,
    ...requestRoleScope.params,
  ]);
}

export async function findCustomerByPhone(params: CustomerContactParams): Promise<QueryRow[]> {
  const roleScope = applyCustomerRoleScope(params.user);
  const sql = `
    ${customerSelectSql()}
    WHERE COALESCE(c.phone, '') LIKE ?
      ${roleScope.sql}
    ORDER BY c.id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, [`%${String(params.value || "").trim()}%`, ...roleScope.params]);
}

export async function findCustomerByEmail(params: CustomerContactParams): Promise<QueryRow[]> {
  const roleScope = applyCustomerRoleScope(params.user);
  const sql = `
    ${customerSelectSql()}
    WHERE LOWER(COALESCE(c.email, '')) LIKE ?
      ${roleScope.sql}
    ORDER BY c.id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, [`%${normalizeName(params.value)}%`, ...roleScope.params]);
}

export async function getCustomerFleetSize(params: CustomerHistoryParams): Promise<QueryRow[]> {
  const roleScope = applyCustomerRoleScope(params.user);
  const sql = `
    SELECT
      c.name AS customerName,
      c.vehicle_count AS vehicleCount,
      c.region,
      c.implementation_type AS implementationType
    FROM customers c
    WHERE LOWER(COALESCE(c.name, '')) LIKE ?
      ${roleScope.sql}
    ORDER BY c.vehicle_count DESC, c.id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, [`%${normalizeName(params.customerName)}%`, ...roleScope.params]);
}

export async function getCustomerRegion(params: CustomerHistoryParams): Promise<QueryRow[]> {
  const roleScope = applyCustomerRoleScope(params.user);
  const sql = `
    SELECT
      c.name AS customerName,
      c.region,
      c.phone,
      c.email
    FROM customers c
    WHERE LOWER(COALESCE(c.name, '')) LIKE ?
      ${roleScope.sql}
    ORDER BY c.id DESC
    LIMIT ${limitSql(params.limit, 10)}
  `;

  return executeRows(sql, [`%${normalizeName(params.customerName)}%`, ...roleScope.params]);
}
