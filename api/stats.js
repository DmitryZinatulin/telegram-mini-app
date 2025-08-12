// /api/event/stats.js
import { pool } from "../db.js";

export default async function handler(req, res) {
  try {
    const event_slug = req.query.event_slug || "pr-demo";

    const ev = await pool.query("select id from events where slug=$1", [event_slug]);
    if (!ev.rowCount) return res.status(404).json({ error: "event_not_found" });
    const eventId = ev.rows[0].id;

    const total = await pool.query(
      "select count(*)::int as c from participants where event_id=$1",
      [eventId]
    );
    const online = await pool.query(
      `select count(*)::int as c
         from participants p
         join sessions s on s.user_id = p.user_id
        where p.event_id=$1 and s.last_ping > now() - interval '30 seconds'`,
      [eventId]
    );
    const lead = await pool.query(
      `select display_name, score
         from participants
        where event_id=$1
        order by score desc, id asc
        limit 10`,
      [eventId]
    );

    res.json({
      event_slug,
      total: total.rows[0].c,
      online: online.rows[0].c,
      leaderboard: lead.rows,
    });
  } catch (e) {
    console.error("event/stats error:", e);
    res.status(500).json({ error: "server_error" });
  }
}
