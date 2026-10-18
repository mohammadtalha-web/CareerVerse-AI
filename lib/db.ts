import mysql, { type Pool } from "mysql2/promise";

declare global {
  var careerVersePool: Pool | undefined;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function poolSize(): number {
  const configured = process.env.DB_POOL_SIZE?.trim();
  if (!configured) return 10;
  const size = Number(configured);
  if (!Number.isInteger(size) || size < 2 || size > 50) {
    throw new Error("DB_POOL_SIZE must be an integer between 2 and 50.");
  }
  return size;
}

export function getDatabase(): Pool {
  if (globalThis.careerVersePool) return globalThis.careerVersePool;

  const port = Number(process.env.DB_PORT ?? "3306");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("DB_PORT must be a valid TCP port.");
  }

  globalThis.careerVersePool = mysql.createPool({
    host: requiredEnvironment("DB_HOST"),
    port,
    user: requiredEnvironment("DB_USER"),
    password: process.env.DB_PASSWORD ?? "",
    database: requiredEnvironment("DB_NAME"),
    charset: "utf8mb4",
    connectionLimit: poolSize(),
    maxIdle: poolSize(),
    idleTimeout: 60_000,
    queueLimit: 100,
    waitForConnections: true,
    connectTimeout: 10_000,
    enableKeepAlive: true,
    decimalNumbers: true,
    dateStrings: false,
  });

  return globalThis.careerVersePool;
}
