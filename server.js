#!/usr/bin/env node
/* =====================================================================
   Party Night: server locale per giocare dai telefoni.
   Nessuna dipendenza: solo moduli integrati di Node.
     node server.js            (oppure: npm start)
   - serve i file del progetto
   - gestisce le "stanze": il browser dell'host mantiene la partita,
     i telefoni mostrano i pulsanti e inviano le scelte (via SSE + POST).
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const MAX_ROOMS = 50;
const MAX_BODY = 64 * 1024;
const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon'
};
const NEVER_SERVE = new Set(['server.js', 'package.json', 'package-lock.json']);

/* ---------- stanze in memoria ---------- */
const rooms = new Map();   // code -> {code,key,host:Set<res>,players:Map<pid,{name,res:Set,screen}>,roster:[],touched}
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode(){
  for(let tries = 0; tries < 100; tries++){
    let c = ''; for(let i = 0; i < 4; i++) c += LETTERS[crypto.randomInt(LETTERS.length)];
    if(!rooms.has(c)) return c;
  }
  return null;
}
function lanIPs(){
  const out = [];
  for(const list of Object.values(os.networkInterfaces()))
    for(const n of list || []) if(n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}
const members = room => [...room.players].map(([pid,p]) => ({pid, name:p.name, online:p.res.size > 0}));
function sse(res, event, data){ try{ res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }catch(e){} }
function toHost(room, event, data){ room.host.forEach(res => sse(res, event, data)); }
function json(res, status, obj){
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(obj));
}
function body(req, cb){
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if(size > MAX_BODY){ req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try{ cb(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }catch(e){ cb(null); } });
}
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);

/* ---------- API ---------- */
function api(req, res, url){
  const q = url.searchParams;

  if(req.method === 'GET' && url.pathname === '/api/info')
    return json(res, 200, {ips: lanIPs(), port: PORT});

  if(req.method === 'GET' && url.pathname === '/api/room-info'){
    const room = rooms.get((q.get('room') || '').toUpperCase());
    return json(res, 200, room ? {exists:true, roster:room.roster} : {exists:false});
  }

  if(req.method === 'GET' && url.pathname === '/api/events'){
    const room = rooms.get((q.get('room') || '').toUpperCase());
    if(!room) return json(res, 404, {error:'stanza non trovata'});
    const asHost = q.get('key') && q.get('key') === room.key;
    const pid = q.get('pid');
    if(!asHost && !room.players.has(pid)) return json(res, 403, {error:'giocatore sconosciuto'});
    res.writeHead(200, {'Content-Type':'text/event-stream', 'Cache-Control':'no-store', 'Connection':'keep-alive', 'X-Accel-Buffering':'no'});
    res.write('retry: 2000\n\n');
    if(asHost){
      room.host.add(res);
      sse(res, 'hello', {members:members(room)});
      req.on('close', () => room.host.delete(res));
    }else{
      const p = room.players.get(pid);
      p.res.add(res);
      sse(res, 'hello', {name:p.name});
      if(p.screen) sse(res, 'screen', p.screen);
      toHost(room, 'members', {members:members(room)});
      req.on('close', () => { p.res.delete(res); toHost(room, 'members', {members:members(room)}); });
    }
    return;
  }

  if(req.method !== 'POST') return json(res, 405, {error:'metodo non consentito'});
  body(req, data => {
    if(!data) return json(res, 400, {error:'JSON non valido'});

    if(url.pathname === '/api/room'){            // crea o riapre una stanza (host)
      const code = String(data.code || '').toUpperCase();
      const existing = rooms.get(code);
      if(existing && data.key === existing.key){ existing.touched = Date.now(); return json(res, 200, {code, key:existing.key}); }
      if(rooms.size >= MAX_ROOMS) return json(res, 503, {error:'troppe stanze'});
      const c = (!existing && /^[A-Z]{4}$/.test(code) && data.key) ? code : newCode();
      const key = (c === code && data.key) ? String(data.key).slice(0, 64) : crypto.randomBytes(12).toString('hex');
      rooms.set(c, {code:c, key, host:new Set(), players:new Map(), roster:[], touched:Date.now()});
      return json(res, 200, {code:c, key});
    }

    const room = rooms.get(String(data.room || '').toUpperCase());
    if(!room) return json(res, 404, {error:'stanza non trovata'});
    room.touched = Date.now();

    if(url.pathname === '/api/join'){            // un telefono entra
      const name = cleanName(data.name);
      let pid = data.pid;
      if(!room.players.has(pid)){
        if(!name) return json(res, 400, {error:'nome mancante'});
        if(room.players.size >= 16) return json(res, 403, {error:'stanza piena'});
        pid = crypto.randomBytes(5).toString('hex');
        room.players.set(pid, {name, res:new Set(), screen:null});
      }else if(name){
        room.players.get(pid).name = name;
      }
      const p = room.players.get(pid);
      toHost(room, 'join', {pid, name:p.name});
      toHost(room, 'members', {members:members(room)});
      return json(res, 200, {pid, name:p.name});
    }

    if(url.pathname === '/api/act'){             // un telefono invia una scelta
      if(!room.players.has(data.pid)) return json(res, 403, {error:'giocatore sconosciuto'});
      toHost(room, 'act', {pid:data.pid, data:data.data});
      return json(res, 200, {ok:true});
    }

    if(data.key !== room.key) return json(res, 403, {error:'chiave host non valida'});

    if(url.pathname === '/api/screens'){         // l'host aggiorna lo schermo dei telefoni
      if(Array.isArray(data.roster)) room.roster = data.roster.slice(0, 16).map(cleanName).filter(Boolean);
      for(const [pid, spec] of Object.entries(data.screens || {})){
        const p = room.players.get(pid); if(!p) continue;
        p.screen = spec;
        p.res.forEach(r => sse(r, 'screen', spec));
      }
      return json(res, 200, {ok:true, members:members(room)});
    }
    return json(res, 404, {error:'endpoint sconosciuto'});
  });
}

/* ---------- file statici ---------- */
function serveStatic(req, res, url){
  let rel = decodeURIComponent(url.pathname);
  if(rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const ext = path.extname(file).toLowerCase();
  if(!file.startsWith(ROOT + path.sep) || !TYPES[ext] || NEVER_SERVE.has(path.basename(file)) || path.basename(file).startsWith('.')){
    res.writeHead(404); return res.end('Not found');
  }
  fs.readFile(file, (err, buf) => {
    if(err){ res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type':TYPES[ext], 'Cache-Control':'no-store'});
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  try{
    const url = new URL(req.url, 'http://x');
    if(url.pathname.startsWith('/api/')) return api(req, res, url);
    if(req.method !== 'GET' && req.method !== 'HEAD'){ res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  }catch(e){ res.writeHead(400); res.end('Bad request'); }
});

/* keep-alive SSE + pulizia stanze inattive (6 ore) */
setInterval(() => {
  const now = Date.now();
  for(const [code, room] of rooms){
    room.host.forEach(r => { try{ r.write(': ping\n\n'); }catch(e){} });
    room.players.forEach(p => p.res.forEach(r => { try{ r.write(': ping\n\n'); }catch(e){} }));
    const idle = room.host.size === 0 && [...room.players.values()].every(p => p.res.size === 0);
    if(idle && now - room.touched > 6 * 3600 * 1000) rooms.delete(code);
  }
}, 20000).unref();

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  console.log('\n🎉  Party Night è acceso!\n');
  console.log('   Sul tuo computer:   http://localhost:' + PORT);
  ips.forEach(ip => console.log('   Per i telefoni:     http://' + ip + ':' + PORT));
  console.log('\n   Apri uno dei link, scegli un gioco e premi "📱 Telefoni" per il QR code.');
  console.log('   (Computer e telefoni devono essere sulla stessa rete Wi-Fi.)\n');
});
