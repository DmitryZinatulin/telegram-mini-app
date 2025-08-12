// /api/quiz.js
import { pool } from "../lib/db.js";
import { readBody } from "../lib/_utils.js";

function ok(res, data) {
  res.status(200).json(data);
}
function bad(res, code) {
  res.status(400).json({ error: code });
}

async function getEventId(slug) {
  const ev = await pool.query("select id from events where slug=$1", [slug]);
  if (!ev.rowCount) return null;
  return ev.rows[0].id;
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const action = url.searchParams.get("action");
  const event_slug = url.searchParams.get("event_slug") || "pr-demo";

  try {
    // -------------------- PUBLIC --------------------
    if (action === "state") {
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");

      const r = await pool.query(
        `select id, title, is_open, current_q
           from quiz_rounds
          where event_id=$1 and is_open=true
          order by id desc limit 1`,
        [eventId]
      );
      if (!r.rowCount) return ok(res, { round: null });

      const round = r.rows[0];
      const q = await pool.query(
        `select id, q_index, text, options
           from quiz_questions
          where round_id=$1 and q_index=$2`,
        [round.id, round.current_q]
      );

      return ok(res, { round: { ...round, question: q.rows[0] || null } });
    }

    if (action === "answer" && req.method === "POST") {
      const body = await readBody(req);
      const { tg_id, choice_index } = body || {};
      if (tg_id == null || choice_index == null) return bad(res, "bad_request");

      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");

      const u = await pool.query("select id from users where tg_id=$1", [
        tg_id,
      ]);
      if (!u.rowCount) return bad(res, "user_not_found");
      const userId = u.rows[0].id;

      const r = await pool.query(
        `select id, current_q from quiz_rounds
          where event_id=$1 and is_open=true
          order by id desc limit 1`,
        [eventId]
      );
      if (!r.rowCount) return bad(res, "round_closed");
      const round = r.rows[0];

      const q = await pool.query(
        `select id from quiz_questions where round_id=$1 and q_index=$2`,
        [round.id, round.current_q]
      );
      if (!q.rowCount) return bad(res, "question_missing");
      const questionId = q.rows[0].id;

      await pool.query(
        `insert into quiz_answers(question_id, user_id, choice_index)
         values ($1,$2,$3)
         on conflict (question_id, user_id) do nothing`,
        [questionId, userId, choice_index]
      );

      return ok(res, { ok: true });
    }

    // -------------------- ADMIN GUARD --------------------
    const adminSet = new Set([
      "admin_import",
      "admin_start",
      "admin_next",
      "admin_reveal",
      // CRUD
      "admin_rounds",
      "admin_round_upsert",
      "admin_round_open",
      "admin_round_close",
      "admin_questions",
      "admin_question_add",
      "admin_question_update",
      "admin_question_delete",
    ]);
    if (adminSet.has(action)) {
      const token = req.headers["x-admin-token"];
      if (!token || token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: "unauthorized" });
      }
    }

    // -------------------- ADMIN: IMPORT (из JSON) [осталось для совместимости] --------------------
    if (action === "admin_import" && req.method === "POST") {
      const body = await readBody(req);
      const { title = "Раунд", questions = [] } = body || {};
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");

      const rnd = await pool.query(
        `insert into quiz_rounds(event_id, title, is_open, current_q)
         values ($1,$2,false,0)
         returning id, title`,
        [eventId, title]
      );
      const roundId = rnd.rows[0].id;

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        await pool.query(
          `insert into quiz_questions(round_id, q_index, text, options, correct_index)
           values ($1,$2,$3,$4,$5)`,
          [roundId, i, q.text, JSON.stringify(q.options), q.correct_index]
        );
      }
      return ok(res, { ok: true, round_id: roundId, count: questions.length });
    }

    // -------------------- ADMIN: ROUND LIST --------------------
    if (action === "admin_rounds") {
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");

      const rounds = await pool.query(
        `select id, title, is_open, current_q, created_at
           from quiz_rounds
          where event_id=$1
          order by id desc`,
        [eventId]
      );
      return ok(res, { rounds: rounds.rows });
    }

    // create/update round (title)
    if (action === "admin_round_upsert" && req.method === "POST") {
      const body = await readBody(req);
      const { id, title } = body || {};
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");
      if (!title || !title.trim()) return bad(res, "title_required");

      if (id) {
        await pool.query(`update quiz_rounds set title=$1 where id=$2`, [
          title.trim(),
          id,
        ]);
        return ok(res, { ok: true, id });
      } else {
        const ins = await pool.query(
          `insert into quiz_rounds(event_id, title, is_open, current_q)
           values ($1,$2,false,0)
           returning id`,
          [eventId, title.trim()]
        );
        return ok(res, { ok: true, id: ins.rows[0].id });
      }
    }

    if (action === "admin_round_open" && req.method === "POST") {
      const body = await readBody(req);
      const { id } = body || {};
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");
      await pool.query(
        `update quiz_rounds set is_open=false where event_id=$1`,
        [eventId]
      );
      await pool.query(
        `update quiz_rounds set is_open=true, current_q=0 where id=$1`,
        [id]
      );
      return ok(res, { ok: true });
    }

    if (action === "admin_round_close" && req.method === "POST") {
      const body = await readBody(req);
      const { id } = body || {};
      await pool.query(`update quiz_rounds set is_open=false where id=$1`, [
        id,
      ]);
      return ok(res, { ok: true });
    }

    // -------------------- ADMIN: QUESTIONS --------------------
    if (action === "admin_questions") {
      const round_id = Number(url.searchParams.get("round_id") || 0);
      const qs = await pool.query(
        `select id, q_index, text, options, correct_index
           from quiz_questions
          where round_id=$1
          order by q_index asc`,
        [round_id]
      );
      return ok(res, { questions: qs.rows });
    }

    if (action === "admin_question_add" && req.method === "POST") {
      const body = await readBody(req);
      const { round_id, text, options, correct_index } = body || {};
      if (
        !round_id ||
        !text ||
        !Array.isArray(options) ||
        options.length < 2 ||
        correct_index == null
      )
        return bad(res, "bad_request");

      const next = await pool.query(
        `select coalesce(max(q_index),-1)+1 as idx from quiz_questions where round_id=$1`,
        [round_id]
      );

      const ins = await pool.query(
        `insert into quiz_questions(round_id, q_index, text, options, correct_index)
         values ($1,$2,$3,$4,$5)
         returning id`,
        [
          round_id,
          next.rows[0].idx,
          text.trim(),
          JSON.stringify(options),
          Number(correct_index),
        ]
      );
      return ok(res, { ok: true, id: ins.rows[0].id });
    }

    if (action === "admin_question_update" && req.method === "POST") {
      const body = await readBody(req);
      const { id, text, options, correct_index } = body || {};
      if (!id) return bad(res, "bad_request");
      await pool.query(
        `update quiz_questions set
           text=coalesce($2,text),
           options=coalesce($3,options),
           correct_index=coalesce($4,correct_index)
         where id=$1`,
        [
          id,
          text?.trim() ?? null,
          options ? JSON.stringify(options) : null,
          correct_index != null ? Number(correct_index) : null,
        ]
      );
      return ok(res, { ok: true });
    }

    if (action === "admin_question_delete" && req.method === "POST") {
      const body = await readBody(req);
      const { id } = body || {};
      if (!id) return bad(res, "bad_request");

      // сохраняем последовательность q_index (переиндексация)
      const row = await pool.query(
        `select round_id, q_index from quiz_questions where id=$1`,
        [id]
      );
      if (!row.rowCount) return ok(res, { ok: true });
      const { round_id, q_index } = row.rows[0];

      await pool.query(`delete from quiz_questions where id=$1`, [id]);
      await pool.query(
        `update quiz_questions
            set q_index = q_index - 1
          where round_id=$1 and q_index > $2`,
        [round_id, q_index]
      );
      return ok(res, { ok: true });
    }

    // -------------------- ADMIN: FLOW (start/next/reveal) --------------------
    if (action === "admin_start" && req.method === "POST") {
      const body = await readBody(req);
      const { round_id } = body || {};
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");
      await pool.query(
        `update quiz_rounds set is_open=false where event_id=$1`,
        [eventId]
      );
      await pool.query(
        `update quiz_rounds set is_open=true, current_q=0 where id=$1`,
        [round_id]
      );
      return ok(res, { ok: true });
    }

    if (action === "admin_next" && req.method === "POST") {
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");
      const r = await pool.query(
        `select id from quiz_rounds where event_id=$1 and is_open=true order by id desc limit 1`,
        [eventId]
      );
      if (!r.rowCount) return bad(res, "round_closed");
      await pool.query(
        `update quiz_rounds set current_q=current_q+1 where id=$1`,
        [r.rows[0].id]
      );
      return ok(res, { ok: true });
    }

    if (action === "admin_reveal" && req.method === "POST") {
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");
      const r = await pool.query(
        `select id, current_q from quiz_rounds where event_id=$1 and is_open=true order by id desc limit 1`,
        [eventId]
      );
      if (!r.rowCount) return bad(res, "round_closed");
      const round = r.rows[0];

      const q = await pool.query(
        `select id, correct_index from quiz_questions where round_id=$1 and q_index=$2`,
        [round.id, round.current_q]
      );
      if (!q.rowCount) return bad(res, "question_missing");
      const question = q.rows[0];

      const upd = await pool.query(
        `with correct_users as (
           select a.user_id
             from quiz_answers a
            where a.question_id=$1 and a.choice_index=$2
         ),
         par as (
           select p.user_id
             from participants p
            where p.event_id=$3
              and p.user_id in (select user_id from correct_users)
         )
         update participants p
            set score = score + 10
           from par
          where p.event_id=$3 and p.user_id=par.user_id
          returning p.user_id`,
        [question.id, question.correct_index, eventId]
      );
      return ok(res, { ok: true, awarded: upd.rowCount });
    }

    // создать пустой "пул" (round с is_bank=true)
    if (action === "admin_bank_upsert" && req.method === "POST") {
      const body = await readBody(req);
      const { id, title } = body || {};
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");
      if (!title || !title.trim()) return bad(res, "title_required");

      if (id) {
        await pool.query(`update quiz_rounds set title=$1 where id=$2`, [
          title.trim(),
          id,
        ]);
        return ok(res, { ok: true, id });
      } else {
        const ins = await pool.query(
          `insert into quiz_rounds(event_id, title, is_open, current_q, is_bank)
       values ($1,$2,false,0,true)
       returning id`,
          [eventId, title.trim()]
        );
        return ok(res, { ok: true, id: ins.rows[0].id });
      }
    }

    // клон: из bank -> новый обычный раунд (копируем вопросы)
    if (action === "admin_clone_from_bank" && req.method === "POST") {
      const body = await readBody(req);
      const { bank_id, title } = body || {};
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");

      const ins = await pool.query(
        `insert into quiz_rounds(event_id, title, is_open, current_q, is_bank)
     values ($1,$2,false,0,false)
     returning id`,
        [eventId, title || "Раунд"]
      );
      const newId = ins.rows[0].id;

      const qs = await pool.query(
        `select q_index, text, options, correct_index
       from quiz_questions
      where round_id=$1 order by q_index asc`,
        [bank_id]
      );

      for (const q of qs.rows) {
        await pool.query(
          `insert into quiz_questions(round_id, q_index, text, options, correct_index)
       values ($1,$2,$3,$4,$5)`,
          [newId, q.q_index, q.text, q.options, q.correct_index]
        );
      }
      return ok(res, { ok: true, new_round_id: newId, count: qs.rowCount });
    }

    // Fallback
    return bad(res, "unknown_action");
  } catch (e) {
    console.error("quiz error:", e);
    res.status(500).json({ error: "server_error" });
  }
}
