// /api/admin/reset_scores.js
import { pool } from "../db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const token = req.headers["x-admin-token"];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const event_slug = (req.query.event_slug || "pr-demo").trim();
    const ev = await pool.query("select id from events where slug=$1", [event_slug]);
    if (!ev.rowCount) return res.status(404).json({ error: "event_not_found" });
    const eventId = ev.rows[0].id;

    const upd = await pool.query(
      "update participants set score=0 where event_id=$1 returning id",
      [eventId]
    );

    res.json({ ok: true, reset: upd.rowCount });
  } catch (e) {
    console.error("admin/reset_scores error:", e);
    res.status(500).json({ error: "server_error" });
  }
}
