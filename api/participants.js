// /api/participants.js
import { pool } from "./db.js";

async function getEventId(slug) {
  const ev = await pool.query("select id from events where slug=$1", [slug]);
  if (!ev.rowCount) return null;
  return ev.rows[0].id;
}

function needAdmin(req) {
  const t = req.headers["x-admin-token"];
  return t && t === process.env.ADMIN_TOKEN;
}

export default async function handler(req, res) {
  try {
    const action = (req.query.action || "list").toLowerCase();
    const event_slug = req.query.event_slug || req.body?.event_slug || "pr-demo";
    const eventId = await getEventId(event_slug);
    if (!eventId) return res.status(404).json({ error: "event_not_found" });

    // ---------- LIST ----------
    if (action === "list" && req.method === "GET") {
      const q = (req.query.q || "").trim();
      const sort = (req.query.sort || "score").toLowerCase(); // score|name|created
      const order = (req.query.order || "desc").toLowerCase(); // asc|desc
      const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
      const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

      const sortExpr =
        sort === "name"
          ? `p.display_name ${order === "asc" ? "asc" : "desc"}`
          : sort === "created"
          ? `p.created_at ${order === "asc" ? "asc" : "desc"}`
          : `p.score ${order === "asc" ? "asc" : "desc"}`;

      const params = [eventId];
      let where = `p.event_id = $1`;
      if (q) {
        params.push(`%${q.toLowerCase()}%`);
        where += ` and lower(p.display_name) like $${params.length}`;
      }

      params.push(limit, offset);
      const sql = `
        select
          p.id               as participant_id,
          p.display_name,
          p.avatar_url,
          p.score,
          p.created_at,
          u.username,
          u.tg_id
        from participants p
        left join users u on u.id = p.user_id
        where ${where}
        order by ${sortExpr}
        limit $${params.length - 1} offset $${params.length}
      `;
      const rows = (await pool.query(sql, params)).rows;

      const cnt = await pool.query(
        `select count(*)::int as c from participants p where ${where.replace(
          "p.event_id = $1",
          "p.event_id = $1"
        )}`,
        params.slice(0, q ? 2 : 1)
      );

      return res.json({ event_slug, total: cnt.rows[0].c, items: rows });
    }

    // всё, что ниже — админ-действия
    if (!needAdmin(req)) return res.status(401).json({ error: "unauthorized" });

    // ---------- ADJUST ----------
    if (action === "adjust" && req.method === "POST") {
      const { participant_id, delta } = req.body || {};
      if (!participant_id || !Number.isFinite(delta))
        return res.status(400).json({ error: "bad_params" });

      const r = await pool.query(
        `update participants set score = score + $1 where id = $2 and event_id = $3 returning id, score`,
        [delta, participant_id, eventId]
      );
      if (!r.rowCount) return res.status(404).json({ error: "not_found" });
      return res.json({ ok: true, id: r.rows[0].id, score: r.rows[0].score });
    }

    // ---------- SET SCORE ----------
    if (action === "set" && req.method === "POST") {
      const { participant_id, score } = req.body || {};
      if (!participant_id || !Number.isFinite(score))
        return res.status(400).json({ error: "bad_params" });

      const r = await pool.query(
        `update participants set score=$1 where id=$2 and event_id=$3 returning id, score`,
        [score, participant_id, eventId]
      );
      if (!r.rowCount) return res.status(404).json({ error: "not_found" });
      return res.json({ ok: true, id: r.rows[0].id, score: r.rows[0].score });
    }

    // ---------- KICK ----------
    if (action === "kick" && req.method === "POST") {
      const { participant_id } = req.body || {};
      if (!participant_id) return res.status(400).json({ error: "bad_params" });

      await pool.query(
        `delete from participants where id=$1 and event_id=$2`,
        [participant_id, eventId]
      );
      return res.json({ ok: true });
    }

    // ---------- BONUS ALL ----------
    if (action === "bonus_all" && req.method === "POST") {
      const { delta } = req.body || {};
      if (!Number.isFinite(delta))
        return res.status(400).json({ error: "bad_params" });

      await pool.query(
        `update participants set score = score + $1 where event_id = $2`,
        [delta, eventId]
      );
      return res.json({ ok: true });
    }

    // ---------- RESET SCORES ----------
    if (action === "reset_scores" && req.method === "POST") {
      const { to = 50 } = req.body || {};
      await pool.query(
        `update participants set score = $1 where event_id = $2`,
        [to, eventId]
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    console.error("participants api error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
