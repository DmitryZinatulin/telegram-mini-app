import { pool } from "./db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { tg_id } = req.body || {};
  if (!tg_id) return res.status(400).json({ error: "tg_id required" });

  // обновляем last_seen
  await pool.query(`update users set last_seen=now() where tg_id=$1`, [tg_id]);

  // создаём/обновляем сессию
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

  res.json({ ok: true });
}
