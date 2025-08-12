import { pool } from "../../lib/db.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).end();

    const token = req.headers["x-admin-token"];
    if (!token || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const event_slug = req.query.event_slug || "pr-demo";
    const { phase, quiz_open, logic_open, contact_open, onehundred_open, auction_open } = req.body || {};

    // найдём event_id
    const ev = await pool.query("select id from events where slug=$1", [event_slug]);
    if (!ev.rowCount) return res.status(404).json({ error: "event_not_found" });
    const eventId = ev.rows[0].id;

    // upsert в event_state
    const q = `
      insert into event_state(event_id, phase, quiz_open, logic_open, contact_open, onehundred_open, auction_open, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7, now())
      on conflict (event_id) do update set
        phase=excluded.phase,
        quiz_open=excluded.quiz_open,
        logic_open=excluded.logic_open,
        contact_open=excluded.contact_open,
        onehundred_open=excluded.onehundred_open,
        auction_open=excluded.auction_open,
        updated_at=now()
      returning phase, quiz_open, logic_open, contact_open, onehundred_open, auction_open, updated_at
    `;
    const vals = [
      eventId,
      phase || "lobby",
      !!quiz_open,
      !!logic_open,
      !!contact_open,
      !!onehundred_open,
      !!auction_open,
    ];
    const r = await pool.query(q, vals);

    return res.json({ ok: true, state: r.rows[0] });
  } catch (e) {
    console.error("admin/state_set error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
