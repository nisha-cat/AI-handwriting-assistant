import mysql from 'mysql2/promise';

export function createPool(databaseUrl: string): mysql.Pool {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    connectTimeout: 5000,
    waitForConnections: true,
    queueLimit: 50,
    timezone: 'Z',
    charset: 'utf8mb4',
  });
  // Keep CURRENT_TIMESTAMP defaults in UTC regardless of server configuration.
  pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });
  return pool;
}
