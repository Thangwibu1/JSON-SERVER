// Vercel Serverless Function. This intentionally uses only Node.js APIs so it
// does not depend on json-server's local static-directory scanner on Vercel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const initialDatabase = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'db.json'), 'utf8')
);
const swaggerSpec = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'swagger.json'), 'utf8')
);

// A warm Vercel function keeps mutations for subsequent requests. A new cold
// instance starts again from db.json, which is appropriate for this mock API.
const database = structuredClone(initialDatabase);

const idFields = {
  ACCOUNT: 'accountId',
  MEMBER_PROFILE: 'memberId',
  CINEMA_ROOM: 'roomId',
  SEAT: 'seatId',
  MOVIE: 'movieId',
  SHOWTIME: 'showtimeId',
  SHOWTIME_SEAT: 'showtimeSeatId',
  PROMOTION: 'promotionId',
  BOOKING: 'bookingId',
  BOOKING_SEAT: 'bookingSeatId',
  TICKET: 'ticketId',
  POINT_HISTORY: 'pointHistoryId',
};

const idPrefixes = {
  ACCOUNT: 'acc_',
  MEMBER_PROFILE: 'mem_prof_',
  CINEMA_ROOM: 'room_',
  SEAT: 'seat_',
  MOVIE: 'mov_',
  SHOWTIME: 'show_',
  SHOWTIME_SEAT: 'sh_st_',
  PROMOTION: 'promo_',
  BOOKING: 'bk_',
  BOOKING_SEAT: 'bk_st_',
  TICKET: 'tk_',
  POINT_HISTORY: 'point_',
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString() || '{}');
  }

  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON payload: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function generateNextId(resource) {
  const list = database[resource];
  const idField = idFields[resource];
  const prefix = idPrefixes[resource];
  let max = 0;

  for (const item of list) {
    const value = String(item[idField] ?? item.id ?? '');
    if (!value.startsWith(prefix)) continue;
    const numericPart = Number.parseInt(value.slice(prefix.length), 10);
    if (Number.isFinite(numericPart)) max = Math.max(max, numericPart);
  }

  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function findItemIndex(resource, id) {
  const idField = idFields[resource];
  return database[resource].findIndex(
    (item) => String(item.id) === id || String(item[idField]) === id
  );
}

function filterCollection(items, url) {
  const reserved = new Set(['_sort', '_order', '_page', '_limit', '_per_page']);
  let result = items.filter((item) => {
    for (const [key, value] of url.searchParams.entries()) {
      if (reserved.has(key)) continue;
      if (String(item[key]) !== value) return false;
    }
    return true;
  });

  const sortField = url.searchParams.get('_sort');
  if (sortField) {
    const descending = sortField.startsWith('-') || url.searchParams.get('_order') === 'desc';
    const field = sortField.replace(/^-/, '');
    result = [...result].sort((left, right) => {
      const comparison = String(left[field] ?? '').localeCompare(
        String(right[field] ?? ''), undefined, { numeric: true }
      );
      return descending ? -comparison : comparison;
    });
  }

  const page = Number.parseInt(url.searchParams.get('_page'), 10);
  const pageSize = Number.parseInt(
    url.searchParams.get('_per_page') ?? url.searchParams.get('_limit'), 10
  );
  if (Number.isFinite(page) && Number.isFinite(pageSize) && page > 0 && pageSize > 0) {
    result = result.slice((page - 1) * pageSize, page * pageSize);
  }

  return result;
}

function buildSwaggerHtml() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Movie Theater API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css">
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({
        url: '/swagger.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        layout: 'BaseLayout'
      });
    </script>
  </body>
</html>`;
}

async function register(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const {
    username,
    password,
    passwordHash,
    fullName,
    email,
    phoneNumber,
    dateOfBirth,
    gender,
    identityCard,
    address,
  } = body;

  if (
    !username ||
    (!password && !passwordHash) ||
    !fullName ||
    !email ||
    !phoneNumber ||
    !dateOfBirth ||
    !gender ||
    !identityCard ||
    !address
  ) {
    sendJson(res, 400, { error: 'Missing required fields' });
    return;
  }

  const duplicateField = database.ACCOUNT.find(
    (account) =>
      account.username.toLowerCase() === username.toLowerCase() ||
      account.email.toLowerCase() === email.toLowerCase() ||
      account.phoneNumber === phoneNumber ||
      account.identityCard === identityCard
  );
  if (duplicateField) {
    sendJson(res, 409, {
      error: 'Username, email, phone number or identity card already exists',
    });
    return;
  }

  const now = new Date().toISOString();
  const accountId = generateNextId('ACCOUNT');
  const account = {
    id: accountId,
    accountId,
    username,
    passwordHash: passwordHash || password,
    fullName,
    email,
    phoneNumber,
    dateOfBirth,
    gender,
    identityCard,
    address,
    avatarUrl: body.avatarUrl || null,
    role: 'MEMBER',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
  database.ACCOUNT.push(account);

  let memberProfile = null;
  if (account.role === 'MEMBER') {
    const memberId = generateNextId('MEMBER_PROFILE');
    memberProfile = {
      id: memberId,
      memberId,
      accountId,
      points: 0,
      tier: 'STANDARD',
      favoriteGenres: body.favoriteGenres || [],
      joinedAt: now,
    };
    database.MEMBER_PROFILE.push(memberProfile);
  }

  sendJson(res, 201, {
    message: 'Registration successful',
    account,
    memberProfile,
  });
}

async function handleResource(req, res, resource, id, url) {
  const collection = database[resource];

  if (req.method === 'GET' && !id) {
    sendJson(res, 200, filterCollection(collection, url));
    return;
  }

  if (req.method === 'GET' && id) {
    const index = findItemIndex(resource, id);
    if (index < 0) return sendJson(res, 404, { error: 'Not Found' });
    sendJson(res, 200, collection[index]);
    return;
  }

  if (req.method === 'POST' && !id) {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'Body must be a JSON object' });
    }
    const idField = idFields[resource];
    const newId = body.id || body[idField] || generateNextId(resource);
    if (findItemIndex(resource, String(newId)) >= 0) {
      return sendJson(res, 409, { error: `Resource with id ${newId} already exists` });
    }
    const created = { ...body, [idField]: body[idField] || newId, id: newId };
    collection.push(created);
    sendJson(res, 201, created);
    return;
  }

  if ((req.method === 'PUT' || req.method === 'PATCH') && id) {
    const index = findItemIndex(resource, id);
    if (index < 0) return sendJson(res, 404, { error: 'Not Found' });
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      return sendJson(res, 400, { error: 'Body must be a JSON object' });
    }
    const existing = collection[index];
    const replacement = req.method === 'PATCH'
      ? { ...existing, ...body }
      : { ...body };
    const idField = idFields[resource];
    replacement.id = replacement.id || existing.id || id;
    replacement[idField] = replacement[idField] || existing[idField] || id;
    collection[index] = replacement;
    sendJson(res, 200, replacement);
    return;
  }

  if (req.method === 'DELETE' && id) {
    const index = findItemIndex(resource, id);
    if (index < 0) return sendJson(res, 404, { error: 'Not Found' });
    const [deleted] = collection.splice(index, 1);
    sendJson(res, 200, deleted);
    return;
  }

  sendJson(res, 405, { error: 'Method Not Allowed' });
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const host = req.headers.host || 'localhost:3000';
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const url = new URL(req.url || '/', `${protocol}://${host}`);
  let pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (pathname === '/api') pathname = '/';
  else if (pathname.startsWith('/api/')) pathname = pathname.slice(4);

  if (pathname === '/') {
    sendJson(res, 200, {
      name: 'Movie Theater API',
      documentation: '/api-docs',
      resources: Object.fromEntries(
        Object.entries(database).map(([name, records]) => [name, records.length])
      ),
    });
    return;
  }

  if (pathname === '/swagger.json') {
    sendJson(res, 200, {
      ...swaggerSpec,
      servers: [
        { url: `${protocol}://${host}`, description: 'Current server' },
        { url: 'http://localhost:3000', description: 'Local development' },
      ],
    });
    return;
  }

  if (pathname === '/api-docs') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(buildSwaggerHtml());
    return;
  }

  if (pathname === '/register') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });
    await register(req, res);
    return;
  }

  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const resource = segments[0];
  const id = segments[1];
  if (!resource || !Object.hasOwn(database, resource) || segments.length > 2) {
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }

  await handleResource(req, res, resource, id, url);
}
