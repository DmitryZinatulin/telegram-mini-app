// /api/leaderboard.js
import { pool } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    const event_slug = req.query.event_slug || "pr-demo";
    const limit = Math.min(parseInt(req.query.limit || "10", 10), 100);
    const tg_id = req.query.tg_id ? BigInt(req.query.tg_id) : null;

    const ev = await pool.query("select id from events where slug=$1", [event_slug]);
    if (!ev.rowCount) return res.status(404).json({ error: "event_not_found" });
    const eventId = ev.rows[0].id;

    const top = await pool.query(
      `select display_name, score
         from participants
        where event_id=$1
        order by score desc, id asc
        limit $2`,
      [eventId, limit]
    );

    let me = null;
    if (tg_id) {
      const u = await pool.query("select id from users where tg_id=$1", [tg_id]);
      if (u.rowCount) {
        const userId = u.rows[0].id;
        const r = await pool.query(
          `with ranks as (
             select user_id, score,
                    dense_rank() over (order by score desc) as rnk
               from participants
              where event_id=$1
           )
           select rnk as rank, score
             from ranks
            where user_id=$2`,
          [eventId, userId]
        );
        if (r.rowCount) me = r.rows[0];
      }
    }

    res.json({ event_slug, top: top.rows, me });
  } catch (e) {
    console.error("leaderboard error:", e);
    res.status(500).json({ error: "server_error" });
  }
}
