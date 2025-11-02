#!/usr/bin/env node
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const superagent = require('superagent');
const { program } = require('commander');

program
  .requiredOption('-h, --host <host>', 'host to listen on')
  .requiredOption('-p, --port <port>', 'port to listen on')
  .requiredOption('-c, --cache <path>', 'path to cache directory');

program.parse(process.argv);
const options = program.opts();

const HOST = options.host;
const PORT = parseInt(options.port, 10);
const CACHE_DIR = path.resolve(process.cwd(), options.cache);

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function sendResponse(res, status, headers = {}, body = null) {
  res.writeHead(status, headers);
  if (body) res.end(body);
  else res.end();
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function handleGet(code, req, res) {
  const filename = `${code}.jpg`;
  const filepath = path.join(CACHE_DIR, filename);
  try {
    const data = await fs.readFile(filepath);
    sendResponse(res, 200, { 'Content-Type': 'image/jpeg' }, data);
    return;
  } catch {
    // файл не в кеші — спробувати отримати з http.cat
  }

  try {
    const url = `https://http.cat/${code}`;
    const resp = await superagent.get(url).responseType('blob');
    const buffer = resp.body;
    if (!buffer || buffer.length === 0) {
      sendResponse(res, 404, {}, 'Not Found');
      return;
    }
    await fs.writeFile(filepath, buffer);
    sendResponse(res, 200, { 'Content-Type': 'image/jpeg' }, buffer);
  } catch {
    sendResponse(res, 404, {}, 'Not Found');
  }
}

async function handlePut(code, req, res) {
  const filename = `${code}.jpg`;
  const filepath = path.join(CACHE_DIR, filename);
  try {
    const body = await readRequestBody(req);
    if (!body || body.length === 0) {
      sendResponse(res, 400, {}, 'Empty body');
      return;
    }
    await fs.writeFile(filepath, body);
    sendResponse(res, 201, {}, 'Created');
  } catch {
    sendResponse(res, 500, {}, 'Internal Server Error');
  }
}

async function handleDelete(code, req, res) {
  const filename = `${code}.jpg`;
  const filepath = path.join(CACHE_DIR, filename);
  try {
    await fs.unlink(filepath);
    sendResponse(res, 200, {}, 'OK');
  } catch (err) {
    if (err.code === 'ENOENT') sendResponse(res, 404, {}, 'Not Found');
    else sendResponse(res, 500, {}, 'Internal Server Error');
  }
}

function parseCodeFromUrl(url) {
  const p = url.split('?')[0];
  const parts = p.split('/').filter(Boolean);
  return /^\d+$/.test(parts[0]) ? parts[0] : null;
}

async function onRequest(req, res) {
  const code = parseCodeFromUrl(req.url);
  if (!code) {
    sendResponse(res, 404, {}, 'Not Found');
    return;
  }

  if (req.method === 'GET') await handleGet(code, req, res);
  else if (req.method === 'PUT') await handlePut(code, req, res);
  else if (req.method === 'DELETE') await handleDelete(code, req, res);
  else sendResponse(res, 405, {}, 'Method not allowed');
}

(async () => {
  await ensureCacheDir();
  const server = http.createServer(onRequest);
  server.listen(PORT, HOST, () => {
    console.log(`Server listening at http://${HOST}:${PORT}, cache=${CACHE_DIR}`);
  });
})();
