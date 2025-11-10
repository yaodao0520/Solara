const API_BASE_URL = 'https://music-api.gdstudio.xyz/api.php';
const KUWO_HOST_PATTERN = /(^|\.)kuwo\.cn$/i;
const SAFE_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'accept-ranges',
  'content-length',
  'content-range',
  'etag',
  'last-modified',
  'expires'
];
const DEFAULT_CACHE_CONTROL = 'no-store';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const KUWO_REFERER = 'https://www.kuwo.cn/search/list';

function getClientIp(req) {
  const forwarded = getHeader(req, 'x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  const realIp = getHeader(req, 'x-real-ip');
  return typeof realIp === 'string' && realIp.length > 0 ? realIp : undefined;
}

function createKuwoToken() {
  return Math.random().toString(36).slice(2, 10);
}

function getHeader(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function createCorsHeaders(headers) {
  const result = {};
  for (const key of Object.keys(headers)) {
    if (SAFE_RESPONSE_HEADERS.includes(key.toLowerCase())) {
      result[key] = headers[key];
    }
  }
  if (!result['Cache-Control']) {
    result['Cache-Control'] = DEFAULT_CACHE_CONTROL;
  }
  result['Access-Control-Allow-Origin'] = '*';
  return result;
}

function handleOptions(res) {
  res.status(204);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.end();
}

function isAllowedKuwoHost(hostname) {
  return KUWO_HOST_PATTERN.test(hostname);
}

function normalizeKuwoUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!isAllowedKuwoHost(parsed.hostname)) return null;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.protocol = 'http:';
    return parsed;
  } catch (error) {
    return null;
  }
}

async function proxyKuwoAudio(targetUrl, req, res) {
  const normalized = normalizeKuwoUrl(targetUrl);
  if (!normalized) {
    res.status(400).send('Invalid target');
    return;
  }

  const init = {
    method: req.method,
    headers: {
      'User-Agent': getHeader(req, 'user-agent') || DESKTOP_UA,
      Referer: 'https://www.kuwo.cn/'
    }
  };

  const rangeHeader = getHeader(req, 'range');
  if (typeof rangeHeader === 'string') {
    init.headers.Range = rangeHeader;
  }

  const upstream = await fetch(normalized.toString(), init);
  const headersObj = {};
  upstream.headers.forEach((value, key) => {
    headersObj[key] = value;
  });

  const corsHeaders = createCorsHeaders(headersObj);
  if (!corsHeaders['Cache-Control']) {
    corsHeaders['Cache-Control'] = 'public, max-age=3600';
  }

  res.status(upstream.status);
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }

  const body = await upstream.arrayBuffer();
  res.end(Buffer.from(body));
}

async function proxyApiRequest(url, req, res) {
  const apiUrl = new URL(API_BASE_URL);
  url.searchParams.forEach((value, key) => {
    if (key === 'target' || key === 'callback') return;
    apiUrl.searchParams.set(key, value);
  });

  if (!apiUrl.searchParams.has('types')) {
    res.status(400).send('Missing types');
    return;
  }

  const source = apiUrl.searchParams.get('source');
  const baseHeaders = {
    'User-Agent': getHeader(req, 'user-agent') || DESKTOP_UA,
    Accept: 'application/json, text/plain, */*'
  };

  if (source === 'kuwo') {
    const token = createKuwoToken();
    baseHeaders.Referer = KUWO_REFERER;
    baseHeaders.Origin = 'https://www.kuwo.cn';
    baseHeaders['Accept-Language'] = 'zh-CN,zh;q=0.9';
    baseHeaders['X-Requested-With'] = 'XMLHttpRequest';
    baseHeaders.Cookie = `kw_token=${token}; csrf=${token}`;
    baseHeaders.csrf = token;

    const clientIp = getClientIp(req);
    if (clientIp) {
      baseHeaders['X-Forwarded-For'] = clientIp;
      baseHeaders['X-Real-IP'] = clientIp;
    }
  }

  const upstream = await fetch(apiUrl.toString(), {
    headers: baseHeaders
  });

  const headersObj = {};
  upstream.headers.forEach((value, key) => {
    headersObj[key] = value;
  });

  const corsHeaders = createCorsHeaders(headersObj);
  if (!corsHeaders['Content-Type']) {
    corsHeaders['Content-Type'] = 'application/json; charset=utf-8';
  }

  res.status(upstream.status);
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }

  const bodyBuf = await upstream.arrayBuffer();
  res.end(Buffer.from(bodyBuf));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    handleOptions(res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).send('Method not allowed');
    return;
  }

  const url = new URL(`https://dummy${req.url ?? '/'}`);
  const target = url.searchParams.get('target');

  if (target) {
    await proxyKuwoAudio(target, req, res);
    return;
  }

  await proxyApiRequest(url, req, res);
};
