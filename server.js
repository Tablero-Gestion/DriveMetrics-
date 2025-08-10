const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, 'env.local') });
const bcrypt = require('bcryptjs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');

const publicRoot = __dirname;
const port = process.env.PORT ? Number(process.env.PORT) : 5502;

const mimeByExt = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function resolveFilePath(requestUrl) {
  try {
    const rawPath = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
    let filePath = path.join(publicRoot, rawPath);
    if (filePath.endsWith(path.sep)) {
      filePath = path.join(filePath, 'index.html');
    }
    // Prevent path traversal
    if (!filePath.startsWith(publicRoot)) {
      return null;
    }
    return filePath;
  } catch {
    return null;
  }
}

// In-memory demo users/sessions (volatile). For production, use a DB.
const users = new Map(); // username -> { username, password, createdAt }
const sessions = new Map(); // sid -> { username, createdAt }

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        const json = data ? JSON.parse(data) : {};
        resolve(json);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function parseCookies(req) {
  const header = req.headers['cookie'] || '';
  const out = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function sendJson(res, status, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

function createSession(username) {
  const sid = crypto.randomBytes(16).toString('hex');
  sessions.set(sid, { username, createdAt: Date.now() });
  return sid;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies['sid'];
  if (sid && sessions.has(sid)) {
    return { sid, ...sessions.get(sid) };
  }
  return null;
}

// Express app for API
const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.DOMAIN_URL || 'http://localhost:5502', credentials: true }));
app.use(helmet());
app.use(rateLimit({ windowMs: 60 * 1000, max: 100 }));
app.use('/api/auth', authRoutes);
// Compatibilidad con frontend que llama a /api/login y /api/registro
app.use('/api', authRoutes);
app.use('/api/payments', paymentRoutes);

const server = http.createServer((req, res) => {
  // Simple API router
  if (req.url.startsWith('/api/')) {
    // delegate to express app
    app(req, res);
    return;
  }

  const filePath = resolveFilePath(req.url);
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const finalPath = stats.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    const ext = path.extname(finalPath).toLowerCase();
    const contentType = mimeByExt[ext] || 'application/octet-stream';

    fs.readFile(finalPath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Static server running at http://127.0.0.1:${port}/`);
});



