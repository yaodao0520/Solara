import type { VercelRequest, VercelResponse } from '@vercel/node';

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

function createCorsHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
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

function handleOptions(res: VercelResponse) {
  res.status(204);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.end();
}

function isAllowedKuwoHost(hostname: string): boolean {
  return KUWO_HOST_PATTERN.test(hostname);
}

function normalizeKuwoUrl(rawUrl: string): URL | null {
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

async function proxyKuwoAudio(targetUrl: string, req: VercelRequest, res: VercelResponse) {
  const normalized = normalizeKuwoUrl(targetUrl);
  if (!normalized) {
    res.status(400).send('Invalid target');
    return;
  }

  const init: RequestInit = {
    method: req.method,
    headers: {
      'User-Agent': (req.headers['user-agent'] as string) ?? 'Mozilla/5.0',
      Referer: 'https://www.kuwo.cn/'
    }
  };

  const rangeHeader = req.headers['range'];
  if (typeof rangeHeader === 'string') {
    (init.headers as Record<string, string>)['Range'] = rangeHeader;
  }

  const upstream = await fetch(normalized.toString(), init);
  const headersObj: Record<string, string> = {};
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

async function proxyApiRequest(url: URL, req: VercelRequest, res: VercelResponse) {
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
  const baseHeaders: Record<string, string> = {
    'User-Agent': (req.headers['user-agent'] as string) ?? 'Mozilla/5.0',
    Accept: 'application/json, text/plain, */*'
  };

  if (source === 'kuwo') {
    baseHeaders['Referer'] = 'https://www.kuwo.cn/';
    baseHeaders['Origin'] = 'https://www.kuwo.cn';
    baseHeaders['Accept-Language'] = 'zh-CN,zh;q=0.9';
  }

  const upstream = await fetch(apiUrl.toString(), {
    headers: baseHeaders
  });

  const headersObj: Record<string, string> = {};
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
}
