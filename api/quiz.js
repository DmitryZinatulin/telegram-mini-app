// api/quiz.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tg_id } = req.body || {};
    console.log('Quiz API called by user:', tg_id);

    res.status(200).json({
      message: `Привет! Это тестовый ответ для пользователя ${tg_id || 'без ID'}`
    });
  } catch (err) {
    console.error('Quiz API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
