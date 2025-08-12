// /api/participants.js
import { pool } from "./db.js";

async function getEventId(slug) {
  const ev = await pool.query("select id from events where slug=$1", [slug]);
  return ev.rowCount ? ev.rows[0].id : null;
}

function isAdmin(req) {
  const t = req.headers["x-admin-token"];
  return t && t === process.env.ADMIN_TOKEN;
}

export default async function handler(req, res) {
  try {
    const action = (req.query.action || "list").toLowerCase();
    const event_slug =
      req.query.event_slug || req.body?.event_slug || "pr-demo";

    const eventId = await getEventId(event_slug);
    if (!eventId) return res.status(404).json({ error: "event_not_found" });

    // ---------- LIST ----------
    if (action === "list" && req.method === "GET") {
      const q = (req.query.q || "").trim().toLowerCase();
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

      // where + параметры для двух запросов (list и count)
      let where = `p.event_id = $1`;
      const vals = [eventId];
      if (q) {
        where += ` and lower(p.display_name) like $2`;
        vals.push(`%${q}%`);
      }

      // список
      const listSql = `
        select
          p.id as participant_id,
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
        limit $${vals.length + 1} offset $${vals.length + 2}
      `;
      const listVals = [...vals, limit, offset];
      const items = (await pool.query(listSql, listVals)).rows;

      // count
      const countSql = `select count(*)::int as c from participants p where ${where}`;
      const total = (await pool.query(countSql, vals)).rows[0].c;

      return res.json({ event_slug, total, items });
    }

    // дальше — админ-операции
    if (!isAdmin(req)) return res.status(401).json({ error: "unauthorized" });

    // ---------- ADJUST (+/- баллы) ----------
    if (action === "adjust" && req.method === "POST") {
      const { participant_id, delta } = req.body || {};
      if (!participant_id || !Number.isFinite(delta))
        return res.status(400).json({ error: "bad_params" });

      const r = await pool.query(
        `update participants set score = score + $1
         where id = $2 and event_id = $3
         returning id, score`,
        [delta, participant_id, eventId]
      );
      if (!r.rowCount) return res.status(404).json({ error: "not_found" });
      return res.json({ ok: true, id: r.rows[0].id, score: r.rows[0].score });
    }

    // ---------- SET (выставить баллы) ----------
    if (action === "set" && req.method === "POST") {
      const { participant_id, score } = req.body || {};
      if (!participant_id || !Number.isFinite(score))
        return res.status(400).json({ error: "bad_params" });

      const r = await pool.query(
        `update participants set score=$1
         where id=$2 and event_id=$3
         returning id, score`,
        [score, participant_id, eventId]
      );
      if (!r.rowCount) return res.status(404).json({ error: "not_found" });
      return res.json({ ok: true, id: r.rows[0].id, score: r.rows[0].score });
    }

    // ---------- KICK (удалить из события) ----------
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
