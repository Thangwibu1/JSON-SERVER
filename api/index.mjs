// api/index.mjs — Vercel Serverless Function
import { createApp } from 'json-server/lib/app.js';
import { Low, Memory } from 'lowdb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Đọc db.json một lần (cached trong cùng serverless instance)
const dbData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'db.json'), 'utf8')
);
const swaggerSpec = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'swagger.json'), 'utf8')
);

// Cache app instance (reused across requests trong cùng một instance)
let appInstance = null;
let dbInstance = null;

async function getApp() {
  if (appInstance) return appInstance;
  dbInstance = new Low(new Memory(), dbData);
  await dbInstance.read();
  appInstance = createApp(dbInstance);
  return appInstance;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function generateNextId(list, prefix, idField) {
  let maxNum = 0;
  for (const item of list) {
    const idVal = item[idField];
    if (typeof idVal === 'string' && idVal.startsWith(prefix)) {
      const numPart = idVal.slice(prefix.length);
      const num = parseInt(numPart, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  const nextNum = maxNum + 1;
  return `${prefix}${String(nextNum).padStart(3, '0')}`;
}

function buildSwaggerHtml(host) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Movie Theater API - Swagger UI</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
    <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.11.0/favicon-32x32.png" sizes="32x32" />
    <style>
      html { box-sizing: border-box; overflow-y: scroll; }
      *, *:before, *:after { box-sizing: inherit; }
      body { margin: 0; background: #fafafa; }
      .topbar {
        background: #1b1b1b;
        padding: 10px 0;
        border-bottom: 3px solid #f29c1f;
      }
      .topbar .wrapper {
        display: flex;
        align-items: center;
        max-width: 1460px;
        margin: 0 auto;
        padding: 0 20px;
      }
      .topbar-logo {
        color: #fff;
        font-family: sans-serif;
        font-size: 20px;
        font-weight: bold;
        text-decoration: none;
        display: flex;
        align-items: center;
      }
      .topbar-logo span { color: #f29c1f; margin-left: 5px; }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="wrapper">
        <a class="topbar-logo" href="#">🎬 MovieTheater<span>API Mock</span></a>
      </div>
    </div>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" charset="UTF-8"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
    <script>
      window.onload = function() {
        SwaggerUIBundle({
          url: "/swagger.json",
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl],
          layout: "StandaloneLayout"
        });
      };
    </script>
  </body>
</html>`;
}

export default async function handler(req, res) {
  const rawUrl = req.url || '/';
  const pathname = rawUrl.split('?')[0];

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Swagger UI page
  if (pathname === '/api-docs' || pathname === '/api-docs/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(buildSwaggerHtml(req.headers.host));
    return;
  }

  // swagger.json với server URL động
  if (pathname === '/swagger.json') {
    const host = req.headers.host || 'localhost:3000';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const baseUrl = `${proto}://${host}`;

    const dynamicSpec = {
      ...swaggerSpec,
      servers: [
        { url: baseUrl, description: 'Current server (Vercel / Local)' },
        { url: 'http://localhost:3000', description: 'Local development' },
      ],
    };

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(dynamicSpec, null, 2));
    return;
  }

  // Handle Custom Register endpoint
  if ((pathname === '/register' || pathname === '/api/register') && req.method === 'POST') {
    try {
      await getApp();
      const dbData = dbInstance.data;

      let body = req.body;
      if (typeof body === 'string') {
        body = JSON.parse(body);
      } else if (!body || Object.keys(body).length === 0) {
        body = await parseBody(req);
      }

      const { username, password, passwordHash, fullName, email, phoneNumber } = body;
      
      // 1. Simple validation
      if (!username || (!password && !passwordHash) || !fullName || !email || !phoneNumber) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields' }));
        return;
      }

      // Ensure collections exist
      if (!dbData.ACCOUNT) dbData.ACCOUNT = [];
      if (!dbData.MEMBER_PROFILE) dbData.MEMBER_PROFILE = [];

      // Check if username or email already exists
      const exists = dbData.ACCOUNT.some(
        acc => acc.username === username || acc.email === email
      );
      if (exists) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Username or Email already exists' }));
        return;
      }

      // 2. Generate IDs
      const nextAccountId = generateNextId(dbData.ACCOUNT, 'acc_', 'accountId');
      const nextMemberProfileId = generateNextId(dbData.MEMBER_PROFILE, 'mem_prof_', 'memberId');

      // 3. Create Account record
      const now = new Date().toISOString();
      const newAccount = {
        id: nextAccountId,
        accountId: nextAccountId,
        username,
        passwordHash: passwordHash || password,
        fullName,
        email,
        phoneNumber,
        dateOfBirth: body.dateOfBirth || null,
        gender: body.gender || null,
        identityCard: body.identityCard || null,
        address: body.address || null,
        avatarUrl: body.avatarUrl || null,
        role: body.role || 'MEMBER',
        status: body.status || 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now
      };

      // 4. Create Member Profile record (if role is MEMBER)
      let newProfile = null;
      if (newAccount.role === 'MEMBER') {
        newProfile = {
          id: nextMemberProfileId,
          memberId: nextMemberProfileId,
          accountId: nextAccountId,
          points: 0,
          tier: 'STANDARD',
          favoriteGenres: body.favoriteGenres || [],
          joinedAt: now
        };
      }

      // Save records to arrays
      dbData.ACCOUNT.push(newAccount);
      if (newProfile) {
        dbData.MEMBER_PROFILE.push(newProfile);
      }

      // 5. Write back to LowDB
      await dbInstance.write();

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: 'Registration successful',
        account: newAccount,
        memberProfile: newProfile
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Registration failed', details: err.message }));
    }
    return;
  }

  // Tất cả routes còn lại → json-server
  const app = await getApp();
  app.handler(req, res);
}
