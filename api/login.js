module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const passwordEnv = process.env.PASSWORD || '';
  let providedPassword = '';

  try {
    const body = req.body ?? {};
    if (typeof body.password === 'string') {
      providedPassword = body.password;
    }
  } catch (error) {
    providedPassword = '';
  }

  if (!passwordEnv || providedPassword === passwordEnv) {
    const maxAge = 48 * 60 * 60;
    const cookieSegments = [
      `auth=${Buffer.from(passwordEnv).toString('base64')}`,
      `Max-Age=${maxAge}`,
      'Path=/',
      'SameSite=Lax',
      'HttpOnly'
    ];

    const forwardedProtoHeader = Array.isArray(req.headers['x-forwarded-proto'])
      ? req.headers['x-forwarded-proto'][0]
      : req.headers['x-forwarded-proto'];

    if (forwardedProtoHeader === 'https') {
      cookieSegments.push('Secure');
    }

    res.setHeader('Set-Cookie', cookieSegments.join('; '));
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true });
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(401).json({ success: false });
};
