import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';
import fs from 'fs';

// Load pool configuration from environment variables
const poolConfig: any = {
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'synohub',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let useSocket = false;
if (process.env.DB_SOCKET && process.env.DB_SOCKET.trim() !== '') {
  try {
    if (fs.existsSync(process.env.DB_SOCKET)) {
      useSocket = true;
    } else {
      console.warn(`[db/index.ts] Socket path ${process.env.DB_SOCKET} provided but file does not exist. Falling back to TCP.`);
    }
  } catch (err) {
    console.warn(`[db/index.ts] Error checking socket path. Falling back to TCP.`);
  }
}

if (useSocket) {
  poolConfig.socketPath = process.env.DB_SOCKET;
  console.log('[db/index.ts] Connecting using socketPath:', poolConfig.socketPath);
} else {
  poolConfig.host = process.env.DB_HOST && process.env.DB_HOST !== 'localhost' ? process.env.DB_HOST : '127.0.0.1';
  poolConfig.port = parseInt(process.env.DB_PORT || '3307');
  console.log('[db/index.ts] Connecting using TCP:', poolConfig.host, poolConfig.port);
}

export const pool = mysql.createPool(poolConfig);

export const db = drizzle(pool, { schema, mode: 'default' });

export const isFallbackEnabled = false;

export async function getNextId(tableName: string, idColumnName: string): Promise<number> {
  const [rows]: any = await pool.query(`SELECT MAX(${idColumnName}) as maxId FROM ${tableName}`);
  const maxId = rows[0]?.maxId;
  return (maxId !== null && maxId !== undefined && maxId !== '') ? Number(maxId) + 1 : 1000;
}

export async function resolveUserIdByName(name: string): Promise<number> {
  if (!name) return 0;
  const trimmed = name.trim().toLowerCase();
  if (trimmed === "guest" || trimmed === "system") return 0;
  const [rows]: any = await pool.query(
    "SELECT user_id FROM tbl_users WHERE LOWER(user_name) = ? OR LOWER(user_username) = ? LIMIT 1",
    [trimmed, trimmed]
  );
  return rows[0]?.user_id || 0;
}
