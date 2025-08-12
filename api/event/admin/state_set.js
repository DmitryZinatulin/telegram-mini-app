import { pool } from "../db.js";
import { readBody } from "../_utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const token = req.headers["x-admin-token"];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const { event_slug = "pr-demo", patch = {} } = await readBody(req);

    const ev = await pool.query("select id from events where slug=$1", [event_slug]);
    if (!ev.rowCount) return res.status(404).json({ error: "event_not_found" });
    const eventId = ev.rows[0].id;

    const fields = [];
    const values = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      fields.push(`${k} = $${i++}`);
      values.push(v);
    }
    values.push(eventId);

    const sql = `
      update event_state
         set ${fields.join(", ")}, updated_at = now()
       where event_id = $${i}
       returning phase, quiz_open, logic_open, contact_open, onehundred_open, auction_open, updated_at
    `;
    const up = await pool.query(sql, values);
    res.json({ ok: true, state: up.rows[0] });
  } catch (e) {
    console.error("admin/state_set error:", e);
    res.status(500).json({ error: "server_error" });
  }
}
