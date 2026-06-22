import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
