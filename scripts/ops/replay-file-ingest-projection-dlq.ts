import { Pool } from "pg";

const databaseDSN = process.env.DATABASE_DSN?.trim();
const messageId = process.argv[2]?.trim();

if (!databaseDSN) throw new Error("DATABASE_DSN is required");
if (!messageId) throw new Error("stable message id argument is required");

const pool = new Pool({ connectionString: databaseDSN });
try {
  const result = await pool.query<{ transport_id: string }>(
    `SELECT public.geul_pgmq_replay_file_ingest_projection($1)::text AS transport_id`,
    [messageId],
  );
  const replayed = result.rows[0];
  if (!replayed?.transport_id) {
    throw new Error(`replayable projection message not found: ${messageId}`);
  }
  console.log(
    JSON.stringify({ messageId, transportId: replayed.transport_id }),
  );
} finally {
  await pool.end();
}
