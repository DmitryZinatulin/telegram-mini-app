import { pool } from "../../lib/db.js";

export default async function handler(req, res) {
  try {
    const event_slug = req.query.event_slug || "pr-demo";

    const ev = await pool.query("select id from events where slug=$1", [event_slug]);
    if (!ev.rowCount) return res.status(404).json({ error: "event_not_found" });
    const eventId = ev.rows[0].id;

    const st = await pool.query(
      `select phase, quiz_open, logic_open, contact_open, onehundred_open, auction_open, updated_at
         from event_state where event_id=$1`,
      [eventId]
    );

    // если вдруг нет строки — создаём по умолчанию
    let state = st.rows[0];
    if (!state) {
      const ins = await pool.query(
        `insert into event_state(event_id) values($1)
         returning phase, quiz_open, logic_open, contact_open, onehundred_open, auction_open, updated_at`,
        [eventId]
      );
      state = ins.rows[0];
    }

    res.json({ event_slug, state });
  } catch (e) {
    console.error("event/state error:", e);
    res.status(500).json({ error: "server_error" });
  }
}
