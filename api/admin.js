// /api/admin.js
import { pool } from "./lib/db.js"; // путь поправь под свой (у тебя db.js в lib/)

function getAdminToken(req) {
  return req.headers["x-admin-token"] || req.headers["X-Admin-Token"] || req.query.admin_token;
}
function needAdmin(req) {
  const t = getAdminToken(req);
  return t && t === process.env.ADMIN_TOKEN;
}
async function eventIdBySlug(slug) {
  const r = await pool.query("select id from events where slug=$1", [slug]);
  return r.rowCount ? r.rows[0].id : null;
}

export default async function handler(req, res) {
  try {
    const action = String(req.query.action || "");
    const event_slug = String(req.query.event_slug || "pr-demo");
    const evId = await eventIdBySlug(event_slug);
    if (!evId) return res.status(404).json({ error: "event_not_found" });

    // ---------- state_set (админ) ----------
    if (action === "state_set") {
      if (!needAdmin(req)) return res.status(401).json({ error: "unauthorized" });

      const {
        phase,
        quiz_open,
        logic_open,
        contact_open,
        onehundred_open,
        auction_open,
      } = req.body || {};

      // гарантируем строку
      await pool.query(
        `insert into event_state(event_id) values($1)
         on conflict(event_id) do nothing`,
        [evId]
      );

      const up = await pool.query(
        `update event_state
           set phase=coalesce($2, phase),
               quiz_open=coalesce($3, quiz_open),
               logic_open=coalesce($4, logic_open),
               contact_open=coalesce($5, contact_open),
               onehundred_open=coalesce($6, onehundred_open),
               auction_open=coalesce($7, auction_open),
               updated_at=now()
         where event_id=$1
         returning phase, quiz_open, logic_open, contact_open, onehundred_open, auction_open, updated_at`,
        [evId, phase, quiz_open, logic_open, contact_open, onehundred_open, auction_open]
      );
      return res.json({ ok: true, state: up.rows[0] });
    }

    // ---------- participants_list (чтение без токена) ----------
    if (action === "participants_list" && req.method === "GET") {
      const q = String(req.query.q || "").trim();
      const sort = String(req.query.sort || "score").toLowerCase();   // score|name|created
      const order = String(req.query.order || "desc").toLowerCase();  // asc|desc
      const limit = Math.min(parseInt(req.query.limit || "100", 10), 500);
      const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

      const sortCol =
        sort === "name" ? "p.display_name" :
        sort === "created" ? "p.created_at" :
        "p.score";
      const sortDir = order === "asc" ? "asc" : "desc";

      const where = ["p.event_id = $1"];
      const vals = [evId];
      if (q) {
        vals.push(`%${q}%`);
        where.push("(p.display_name ilike $" + vals.length + " or u.username ilike $" + vals.length + ")");
      }

      const totalQ = await pool.query(
        `select count(*)::int as c
           from participants p
           join users u on u.id=p.user_id
          where ${where.join(" and ")}`,
        vals
      );

      vals.push(limit, offset);
      const listQ = await pool.query(
        `select p.id as participant_id, u.tg_id, u.username,
                p.display_name, p.avatar_url, p.score, p.created_at
           from participants p
           join users u on u.id=p.user_id
          where ${where.join(" and ")}
          order by ${sortCol} ${sortDir}, p.id asc
          limit $${vals.length-1} offset $${vals.length}`,
        vals
      );

      return res.json({ total: totalQ.rows[0].c, items: listQ.rows });
    }

    // ---------- ниже все операции требуют токен ----------
    if (!needAdmin(req)) return res.status(401).json({ error: "unauthorized" });

    if (action === "participants_adjust" && req.method === "POST") {
      const { participant_id, delta } = req.body || {};
      await pool.query(
        `update participants set score = score + $2 where id=$1 and event_id=$3`,
        [participant_id, Number(delta) || 0, evId]
      );
      return res.json({ ok: true });
    }

    if (action === "participants_set" && req.method === "POST") {
      const { participant_id, score } = req.body || {};
      await pool.query(
        `update participants set score = $2 where id=$1 and event_id=$3`,
        [participant_id, Number(score) || 0, evId]
      );
      return res.json({ ok: true });
    }

    if (action === "participants_kick" && req.method === "POST") {
      const { participant_id } = req.body || {};
      await pool.query(
        `delete from participants where id=$1 and event_id=$2`,
        [participant_id, evId]
      );
      return res.json({ ok: true });
    }

    if (action === "participants_bonus_all" && req.method === "POST") {
      const { delta } = req.body || {};
      await pool.query(
        `update participants set score = score + $1 where event_id=$2`,
        [Number(delta) || 0, evId]
      );
      return res.json({ ok: true });
    }

    if (action === "participants_reset_scores" && req.method === "POST") {
      const { to = 50 } = req.body || {};
      await pool.query(
        `update participants set score = $1 where event_id=$2`,
        [Number(to) || 50, evId]
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    console.error("admin.js error:", e);
    return res.status(e.status || 500).json({ error: e.message || "server_error" });
  }
}
