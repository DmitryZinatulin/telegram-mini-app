export default async function handler(req, res) {
  res.json({ ok: true, now: new Date().toISOString() });
}
