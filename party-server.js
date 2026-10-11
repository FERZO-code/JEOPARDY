#!/usr/bin/env node
/* =====================================================================
   Party Night: server locale (facoltativo).
   Serve a giocare dai telefoni SENZA internet/database, in casa:
     node party-server.js        (oppure: npm start)
   Online (Vercel) non serve: lì le stesse API girano come funzione
   serverless e le stanze stanno in Upstash Redis (vedi api/party.js).
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { handle, createMemoryStore } = require('./lib/party-api');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon'
};
const NEVER_SERVE = new Set(['party-server.js', 'package.json', 'package-lock.json', 'vercel.json']);
const store = createMemoryStore();

function lanIPs(){
  const out = [];
  for(const list of Object.values(os.networkInterfaces()))
    for(const n of list || []) if(n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}

function readBody(req){
  return new Promise(resolve => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if(size > 64 * 1024) req.destroy(); else chunks.push(c); });
    req.on('end', () => { try{ resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }catch(e){ resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function api(req, res, url){
  const query = Object.fromEntries(url.searchParams);
  const body = req.method === 'POST' ? await readBody(req) : {};
  const out = await handle({
    method: req.method, route: url.pathname.slice(5), query, body,
    ip: req.socket.remoteAddress || 'x', lan: lanIPs(), port: PORT
  }, store);
  res.writeHead(out.status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(out.json));
}

function serveStatic(req, res, url){
  let rel = decodeURIComponent(url.pathname);
  if(rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file);
  if(!file.startsWith(ROOT + path.sep) || !TYPES[ext] || NEVER_SERVE.has(base) || base.startsWith('.')
     || file.startsWith(path.join(ROOT, 'lib') + path.sep) || file.startsWith(path.join(ROOT, 'api') + path.sep)){
    res.writeHead(404); return res.end('Not found');
  }
  fs.readFile(file, (err, buf) => {
    if(err){ res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type':TYPES[ext], 'Cache-Control':'no-store'});
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  try{
    const url = new URL(req.url, 'http://x');
    if(url.pathname.startsWith('/api/')) return await api(req, res, url);
    if(req.method !== 'GET' && req.method !== 'HEAD'){ res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  }catch(e){ res.writeHead(500); res.end('Errore'); }
}).listen(PORT, '0.0.0.0', () => {
  console.log('\n🎉  Party Night (server locale) è acceso!\n');
  console.log('   Sul tuo computer:   http://localhost:' + PORT);
  lanIPs().forEach(ip => console.log('   Per i telefoni:     http://' + ip + ':' + PORT));
  console.log('\n   Apri uno dei link, scegli un gioco e premi "📱 Telefoni" per il QR code.');
  console.log('   (Computer e telefoni devono essere sulla stessa rete Wi-Fi.)\n');
});
