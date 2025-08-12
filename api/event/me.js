// /api/event/me.js
import { pool } from "../db.js";
import { readBody } from "../_utils.js";

export default async function handler(req, res) {
  try {
    const body = req.method === "POST" ? (await readBody(req)) : req.query;
    const { tg_id, event_slug = "pr-demo" } = body || {};
    if (!tg_id) return res.status(400).json({ error: "tg_id required" });

    const ev = await pool.query(
      "select id, slug, name from events where slug=$1 and is_active=true",
      [event_slug]
    );
    if (!ev.rowCount) return res.status(404).json({ error: "event_not_found" });
    const event = ev.rows[0];

    const u = await pool.query("select id from users where tg_id=$1", [tg_id]);
    if (!u.rowCount) {
      return res.json({ registered: false, event, participant: null });
    }
    const userId = u.rows[0].id;

    const part = await pool.query(
      `select id, event_id, user_id, display_name, avatar_url, score
         from participants
        where event_id=$1 and user_id=$2`,
      [event.id, userId]
    );

    if (!part.rowCount) {
      return res.json({ registered: false, event, participant: null });
    }
    return res.json({ registered: true, event, participant: part.rows[0] });
  } catch (e) {
    console.error("event/me error:", e);
    res.status(500).json({ error: "server_error" });
  }
}
