/**
 * Applies every .sql file in sql/migrations, in filename order, that
 * hasn't already been recorded in schema_migrations. Each migration runs
 * inside its own transaction so a failing file rolls back cleanly instead
 * of leaving the schema half-applied.
 *
 * Usage: npm run db:migrate
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "@/lib/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../../sql/migrations");

async function migrate() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const { rows } = await pool.query(`SELECT name FROM schema_migrations`);
  const applied = new Set(rows.map((r) => r.name as string));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }

    const sqlText = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      console.log(`apply ${file}...`);
      await client.query("BEGIN");
      await client.query(sqlText);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      console.log(`done  ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  console.log("Migrations up to date.");
}

migrate()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
