// api/admin.js
import { pool } from "./lib/db.js";

// --- helpers
function needToken(req) {
  const got = req.headers["x-admin-token"] || req.headers["X-Admin-Token"] || req.headers["x-admin-token"];
  const want = process.env.ADMIN_TOKEN || "";
  if (!want || !got || String(got) !== String(want)) {
    const e = new Error("unauthorized");
    e.status = 401;
    throw e;
  }
}

async function eventIdBySlug(slug) {
  const ev = await pool.query("select id from events where slug=$1", [slug]);
  if (!ev.rowCount) {
    const e = new Error("event_not_found");
    e.status = 404;
    throw e;
  }
  return ev.rows[0].id;
}

function parseIntSafe(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export default async function handler(req, res) {
  try {
    const { action = "", event_slug = "" } = req.query || {};
    if (!action) return res.status(400).json({ error: "action_required" });
    if (!event_slug) return res.status(400).json({ error: "event_slug_required" });

    // все админ-экшены требуют токен
    needToken(req);

    // берём event_id
    const eventId = await eventIdBySlug(event_slug);

    // маршрутизация
    if (action === "state_set") {
      // PATCH состояния события
      const {
        phase,
        quiz_open,
        logic_open,
        contact_open,
        onehundred_open,
        auction_open,
      } = (req.body || {});

      // делаем upsert в event_state
      const q = `
        insert into event_state(event_id, phase, quiz_open, logic_open, contact_open, onehundred_open, auction_open, updated_at)
        values ($1, $2, coalesce($3,false), coalesce($4,false), coalesce($5,false), coalesce($6,false), coalesce($7,false), now())
        on conflict (event_id) do update set
          phase=excluded.phase,
          quiz_open=excluded.quiz_open,
          logic_open=excluded.logic_open,
          contact_open=excluded.contact_open,
          onehundred_open=excluded.onehundred_open,
          auction_open=excluded.auction_open,
          updated_at=now()
        returning event_id, phase, quiz_open, logic_open, contact_open, onehundred_open, auction_open, updated_at
      `;
      const r = await pool.query(q, [
        eventId,
        phase || "lobby",
        !!quiz_open,
        !!logic_open,
        !!contact_open,
        !!onehundred_open,
        !!auction_open,
      ]);
      return res.json({ ok: true, state: r.rows[0] });
    }

    // ----- participants: общие вспомогательные
    const sortMap = {
      score: "p.score",
      name: "p.display_name",
      created: "p.created_at",
    };

    if (action === "participants_list") {
      const sort = String(req.query.sort || "score");
      const order = String(req.query.order || "desc").toLowerCase() === "asc" ? "asc" : "desc";
      const q = String(req.query.q || "").trim();
      const limit = Math.min(Math.max(parseIntSafe(req.query.limit, 100), 1), 500);
      const offset = Math.max(parseIntSafe(req.query.offset, 0), 0);

      const sortCol = sortMap[sort] || sortMap.score;

      const args = [eventId];
      let where = "where p.event_id=$1";
      if (q) {
        args.push(`%${q}%`);
        where += ` and (p.display_name ilike $${args.length} or u.username ilike $${args.length})`;
      }

      const sql = `
        select
          p.id as participant_id,
          p.display_name,
          p.avatar_url,
          p.score,
          p.created_at,
          u.username,
          u.tg_id
        from participants p
        left join users u on u.id=p.user_id
        ${where}
        order by ${sortCol} ${order}
        limit ${limit} offset ${offset}
      `;
      const items = await pool.query(sql, args);

      const cnt = await pool.query(
        `select count(*)::int as c from participants p ${where}`,
        args
      );

      return res.json({ total: cnt.rows[0].c, items: items.rows });
    }

    if (action === "participants_adjust") {
      const { participant_id, delta } = req.body || {};
      if (!participant_id || !Number.isFinite(Number(delta)))
        return res.status(400).json({ error: "bad_params" });

      const r = await pool.query(
        `update participants set score=score+($2)
         where id=$1 and event_id=$3
         returning id, score`,
        [participant_id, Number(delta), eventId]
      );
      if (!r.rowCount) return res.status(404).json({ error: "not_found" });
      return res.json({ ok: true, id: r.rows[0].id, score: r.rows[0].score });
    }

    if (action === "participants_set") {
      const { participant_id, score } = req.body || {};
      if (!participant_id || !Number.isFinite(Number(score)))
        return res.status(400).json({ error: "bad_params" });

      const r = await pool.query(
        `update participants set score=$2
         where id=$1 and event_id=$3
         returning id, score`,
        [participant_id, Number(score), eventId]
      );
      if (!r.rowCount) return res.status(404).json({ error: "not_found" });
      return res.json({ ok: true, id: r.rows[0].id, score: r.rows[0].score });
    }

    if (action === "participants_kick") {
      const { participant_id } = req.body || {};
      if (!participant_id) return res.status(400).json({ error: "bad_params" });

      const r = await pool.query(
        `delete from participants where id=$1 and event_id=$2`,
        [participant_id, eventId]
      );
      return res.json({ ok: true, deleted: r.rowCount });
    }

    if (action === "participants_bonus_all") {
      const { delta = 10 } = req.body || {};
      const r = await pool.query(
        `update participants set score=score+($2) where event_id=$1`,
        [eventId, Number(delta)]
      );
      return res.json({ ok: true, affected: r.rowCount });
    }

    if (action === "participants_reset_scores") {
      const { to = 50 } = req.body || {};
      const r = await pool.query(
        `update participants set score=$2 where event_id=$1`,
        [eventId, Number(to)]
      );
      return res.json({ ok: true, affected: r.rowCount });
    }

    // неизвестный экшен
    return res.status(400).json({ error: "unknown_action", action });
  } catch (e) {
    const code = e.status || 500;
    console.error("admin.js error:", e);
    res.status(code).json({ error: e.message || "server_error" });
  }
}
