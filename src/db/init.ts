import { pool } from "./index";

export async function initDB() {
  try {
    console.log("Ensuring chat messages table exists...");
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        username VARCHAR(255) DEFAULT 'guest'
      )
    `);
    console.log("Database initialized for read-only CRM access and chat storage.");
  } catch (e) {
    console.error("Database initialization failed:", (e as Error).message);
  }
}
