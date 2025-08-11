import { pool } from "./db.js";
import { readBody } from "./_utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const body = await readBody(req);
  const { tg_id } = body || {};

  if (!tg_id) {
    console.error("ping: tg_id missing, body=", body);
    return res.status(400).json({ error: "tg_id required" });
  }

  try {
    await pool.query(`update users set last_seen=now() where tg_id=$1`, [tg_id]);

    const { rows } = await pool.query(`select id from users where tg_id=$1`, [tg_id]);
    const uid = rows?.[0]?.id;

    if (uid) {
      await pool.query(
        `insert into sessions(user_id, started_at, last_ping)
         values ($1, now(), now())
         on conflict do nothing`,
        [uid]
      );
      await pool.query(
        `update sessions set last_ping=now()
         where user_id=$1`,
        [uid]
      );
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("ping error:", e);
    return res.status(500).json({ error: "db_failed" });
  }
}
