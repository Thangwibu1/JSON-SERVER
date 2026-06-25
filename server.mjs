import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Spawn json-server on port 3001
const jsonServerPort = 3001;
const serverPort = process.env.PORT || 3000;

console.log('Starting json-server on port ' + jsonServerPort + '...');
const child = spawn('npx', ['json-server', 'db.json', '--port', String(jsonServerPort)], {
  shell: true,
  stdio: 'inherit'
});

// Create the wrapping server on port 3000
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Handle CORS preflight for /register
  if (url.pathname === '/register' && req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Length': '0'
    });
    res.end();
    return;
  }

  // Handle Custom Register endpoint
  if (url.pathname === '/register' && req.method === 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    parseBody(req)
      .then(body => {
        const { username, password, passwordHash, fullName, email, phoneNumber } = body;
        
        // 1. Simple validation
        if (!username || (!password && !passwordHash) || !fullName || !email || !phoneNumber) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required fields' }));
          return;
        }

        // 2. Read database file
        const dbPath = path.join(__dirname, 'db.json');
        let dbData;
        try {
          dbData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to read database file', details: err.message }));
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

        // 3. Generate IDs
        const nextAccountId = generateNextId(dbData.ACCOUNT, 'acc_', 'accountId');
        const nextMemberProfileId = generateNextId(dbData.MEMBER_PROFILE, 'mem_prof_', 'memberId');

        // 4. Create Account record
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

        // 5. Create Member Profile record (if role is MEMBER)
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

        // 6. Write back to db.json
        try {
          fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf8');
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to write to database file', details: err.message }));
          return;
        }

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Registration successful',
          account: newAccount,
          memberProfile: newProfile
        }));
      })
      .catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload', details: err.message }));
      });
    return;
  }
  
  // Serve swagger.json
  if (url.pathname === '/swagger.json') {
    const swaggerPath = path.join(__dirname, 'swagger.json');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    fs.createReadStream(swaggerPath).pipe(res);
    return;
  }
  
  // Serve Swagger UI html
  if (url.pathname === '/api-docs') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Movie Theater API - Swagger UI</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
    <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.11.0/favicon-32x32.png" sizes="32x32" />
    <style>
      html {
        box-sizing: border-box;
        overflow-y: scroll;
      }
      *, *:before, *:after {
        box-sizing: inherit;
      }
      body {
        margin: 0;
        background: #fafafa;
      }
      .topbar {
        background-color: #1b1b1b;
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
        color: #ffffff;
        font-family: sans-serif;
        font-size: 20px;
        font-weight: bold;
        text-decoration: none;
        display: flex;
        align-items: center;
      }
      .topbar-logo span {
        color: #f29c1f;
        margin-left: 5px;
      }
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
        const ui = SwaggerUIBundle({
          url: "/swagger.json",
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset
          ],
          plugins: [
            SwaggerUIBundle.plugins.DownloadUrl
          ],
          layout: "StandaloneLayout"
        });
        window.ui = ui;
      };
    </script>
  </body>
</html>
    `);
    return;
  }
  
  // Proxy all other requests to json-server on port 3001
  const proxyReq = http.request({
    host: 'localhost',
    port: jsonServerPort,
    path: req.url,
    method: req.method,
    headers: req.headers
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  
  proxyReq.on('error', (err) => {
    console.error('Proxy connection error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Gateway', message: 'Could not connect to json-server' }));
  });
  
  req.pipe(proxyReq);
});

server.listen(serverPort, () => {
  console.log('--------------------------------------------------');
  console.log(`🎬 JSON Server Proxy & Swagger UI are running!`);
  console.log(`   👉 Proxy Server (with Swagger UI): http://localhost:${serverPort}`);
  console.log(`   👉 API Documentation: http://localhost:${serverPort}/api-docs`);
  console.log(`   👉 Direct json-server: http://localhost:${jsonServerPort}`);
  console.log('--------------------------------------------------');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Lỗi: Port ${serverPort} đang được sử dụng bởi một tiến trình khác.`);
    console.error(`   Hãy chạy lệnh sau để giải phóng port, rồi thử lại:\n`);
    console.error(`   PowerShell: Stop-Process -Id (Get-NetTCPConnection -LocalPort ${serverPort}).OwningProcess -Force`);
    console.error(`   CMD/bash:   npx kill-port ${serverPort}\n`);
    child.kill();
    process.exit(1);
  } else {
    throw err;
  }
});

// Ensure child process dies when parent dies
process.on('exit', () => {
  child.kill();
});
process.on('SIGINT', () => {
  child.kill();
  process.exit();
});
process.on('SIGTERM', () => {
  child.kill();
  process.exit();
});
