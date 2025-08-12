// /api/quiz.js
import { pool } from "../lib/db.js";
import { readBody } from "../lib/_utils.js";

function ok(res, data) { res.status(200).json(data); }
function bad(res, code){ res.status(400).json({ error: code }); }

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
    if (action === "state") {
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");

      // активный раунд
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
      if (!q.rowCount) return ok(res, { round: { ...round, question: null } });

      const question = q.rows[0];
      return ok(res, { round: { ...round, question } });
    }

    if (action === "answer" && req.method === "POST") {
      const body = await readBody(req);
      const tg_id = body.tg_id;
      const choice_index = body.choice_index;

      if (tg_id == null || choice_index == null) return bad(res, "bad_request");

      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");

      // участник → user_id & текущий вопрос
      const u = await pool.query("select id from users where tg_id=$1", [tg_id]);
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

      // сохранить ответ (одноразово)
      await pool.query(
        `insert into quiz_answers(question_id, user_id, choice_index)
         values ($1,$2,$3)
         on conflict (question_id, user_id) do nothing`,
        [questionId, userId, choice_index]
      );

      return ok(res, { ok: true });
    }

    // --- ADMIN --- //
    const adminActions = new Set(["admin_import","admin_start","admin_next","admin_reveal"]);
    if (adminActions.has(action)) {
      const token = req.headers["x-admin-token"];
      if (!token || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: "unauthorized" });
    }

    if (action === "admin_import" && req.method === "POST") {
      const body = await readBody(req);
      const { title = "Раунд 1", questions = [] } = body;

      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");

      const rnd = await pool.query(
        `insert into quiz_rounds(event_id, title, is_open, current_q)
         values ($1,$2,false,0)
         returning id, title`,
        [eventId, title]
      );
      const roundId = rnd.rows[0].id;

      // bulk insert вопросов
      for (let i=0; i<questions.length; i++){
        const q = questions[i];
        await pool.query(
          `insert into quiz_questions(round_id, q_index, text, options, correct_index)
           values ($1,$2,$3,$4,$5)`,
          [roundId, i, q.text, JSON.stringify(q.options), q.correct_index]
        );
      }
      return ok(res, { ok:true, round_id: roundId, count: questions.length });
    }

    if (action === "admin_start" && req.method === "POST") {
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");

      // закрыть другие раунды
      await pool.query(`update quiz_rounds set is_open=false where event_id=$1`, [eventId]);

      const body = await readBody(req);
      const round_id = body.round_id;

      // открыть выбранный раунд на первом вопросе
      await pool.query(
        `update quiz_rounds set is_open=true, current_q=0 where id=$1`,
        [round_id]
      );
      return ok(res, { ok:true });
    }

    if (action === "admin_next" && req.method === "POST") {
      const body = await readBody(req);
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");

      // текущий открытый раунд
      const r = await pool.query(
        `select id, current_q from quiz_rounds
          where event_id=$1 and is_open=true
          order by id desc limit 1`,
        [eventId]
      );
      if (!r.rowCount) return bad(res, "round_closed");

      const round = r.rows[0];

      // следующий вопрос
      await pool.query(
        `update quiz_rounds set current_q = current_q + 1 where id=$1`,
        [round.id]
      );
      return ok(res, { ok:true });
    }

    if (action === "admin_reveal" && req.method === "POST") {
      const body = await readBody(req);
      const eventId = await getEventId(event_slug);
      if (!eventId) return bad(res, "event_not_found");

      const r = await pool.query(
        `select id, current_q from quiz_rounds
          where event_id=$1 and is_open=true
          order by id desc limit 1`,
        [eventId]
      );
      if (!r.rowCount) return bad(res, "round_closed");
      const round = r.rows[0];

      // текущий вопрос и правильный ответ
      const q = await pool.query(
        `select id, correct_index from quiz_questions
          where round_id=$1 and q_index=$2`,
        [round.id, round.current_q]
      );
      if (!q.rowCount) return bad(res, "question_missing");
      const question = q.rows[0];

      // всем, кто ответил правильно — +10 баллов
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

      return ok(res, { ok:true, awarded: upd.rowCount });
    }

    // нераспознанное действие
    return bad(res, "unknown_action");
  } catch (e) {
    console.error("quiz error:", e);
    res.status(500).json({ error: "server_error" });
  }
}
