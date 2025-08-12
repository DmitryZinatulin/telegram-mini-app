import { pool } from "../lib/db.js";
import { readBody } from "../lib/_utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { tg_id, username, display_name } = await readBody(req);
  if (!tg_id) return res.status(400).json({ error: "tg_id required" });

  await pool.query(
    `insert into users (tg_id, username, display_name)
     values ($1,$2,$3)
     on conflict (tg_id) do update
       set username=excluded.username,
           display_name=excluded.display_name,
           last_seen=now()`,
    [tg_id, username || null, display_name || null]
  );
  res.json({ ok: true });
}
