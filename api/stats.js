import { pool } from "./db.js";

export default async function handler(req, res) {
  const onlineQ = await pool.query(
    `select count(*)::int as c from sessions where last_ping > now() - interval '30 seconds'`
  );
  const totalQ  = await pool.query(`select count(*)::int as c from users`);
  const leadQ   = await pool.query(
    `select display_name, score from users order by score desc limit 10`
  );
  res.json({
    online: onlineQ.rows[0].c,
    total: totalQ.rows[0].c,
    leaderboard: leadQ.rows
  });
}
