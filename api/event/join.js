// /api/event/join.js
import { pool } from "../../lib/db.js";
import { readBody } from "../../lib/_utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const {
      tg_id,
      username,
      display_name,
      avatar_url,
      event_slug = "pr-demo",
    } = await readBody(req);

    if (!tg_id) return res.status(400).json({ error: "tg_id required" });

    // 1) событие
    const ev = await pool.query(
      "select id, slug, name from events where slug=$1 and is_active=true",
      [event_slug]
    );
    if (!ev.rowCount) return res.status(404).json({ error: "event_not_found" });
    const event = ev.rows[0];

    // 2) ensure user
    await pool.query(
      `insert into users (tg_id, username, display_name)
       values ($1,$2,$3)
       on conflict (tg_id) do update
         set username=excluded.username,
             display_name=excluded.display_name,
             last_seen=now()`,
      [tg_id, username || null, display_name || null]
    );

    const u = await pool.query("select id from users where tg_id=$1", [tg_id]);
    const userId = u.rows[0].id;

    // 3) upsert participant
    const part = await pool.query(
      `insert into participants (event_id, user_id, display_name, avatar_url)
       values ($1,$2,$3,$4)
       on conflict (event_id, user_id) do update
         set display_name = coalesce(excluded.display_name, participants.display_name),
             avatar_url   = coalesce(excluded.avatar_url,   participants.avatar_url)
       returning id, event_id, user_id, display_name, avatar_url, score`,
      [event.id, userId, display_name || null, avatar_url || null]
    );

    res.json({ ok: true, event, participant: part.rows[0] });
  } catch (e) {
    console.error("event/join error:", e);
    res.status(500).json({ error: "server_error" });
  }
}
