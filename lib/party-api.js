'use strict';
/* =====================================================================
   Party Night: API delle stanze (condivisa tra server locale e Vercel).
   Le "stanze" stanno in un database Redis (Upstash) quando il sito è
   online, oppure in memoria quando si usa party-server.js sul computer.

   Flusso: l'host (pc) tiene la partita e pubblica gli "schermi" per ogni
   telefono; i telefoni fanno polling e rispondono con /api/act.
   ===================================================================== */
const crypto = require('crypto');

const TTL = 6 * 3600;          // le stanze scadono dopo 6 ore
const ONLINE_MS = 12000;       // un telefono è "online" se ha battuto un colpo da meno di 12 s
const MAX_PLAYERS = 16;
const MAX_BODY = 64 * 1024;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
const validCode = c => /^[A-Z]{4}$/.test(c);
const validPid = p => /^[a-f0-9]{10}$/.test(p);
const newCode = () => { let c = ''; for(let i = 0; i < 4; i++) c += LETTERS[crypto.randomInt(LETTERS.length)]; return c; };
const J = (status, json) => ({status, json});
const parse = s => { try{ return JSON.parse(s); }catch(e){ return null; } };

/* ---------- store in memoria (uso locale) ---------- */
function createMemoryStore(){
  const data = new Map();     // key -> {v, exp}
  const live = k => { const e = data.get(k); if(!e) return null; if(e.exp && e.exp < Date.now()){ data.delete(k); return null; } return e; };
  const setExp = (e, sec) => { if(sec) e.exp = Date.now() + sec * 1000; };
  const exec = ([cmd, ...a]) => {
    switch(String(cmd).toUpperCase()){
      case 'GET': { const e = live(a[0]); return e ? e.v : null; }
      case 'SET': {
        const [k, v, ...opt] = a; const nx = opt.map(String).includes('NX');
        if(nx && live(k)) return null;
        const e = {v:String(v)}; const i = opt.map(String).indexOf('EX'); if(i >= 0) setExp(e, Number(opt[i + 1]));
        data.set(k, e); return 'OK';
      }
      case 'EXISTS': return live(a[0]) ? 1 : 0;
      case 'DEL': return data.delete(a[0]) ? 1 : 0;
      case 'EXPIRE': { const e = live(a[0]); if(e){ setExp(e, Number(a[1])); return 1; } return 0; }
      case 'INCR': { const e = live(a[0]) || {v:'0'}; e.v = String(Number(e.v) + 1); data.set(a[0], e); return Number(e.v); }
      case 'HSET': { const e = live(a[0]) || {v:new Map()}; e.v.set(a[1], String(a[2])); data.set(a[0], e); return 1; }
      case 'HEXISTS': { const e = live(a[0]); return e && e.v.has(a[1]) ? 1 : 0; }
      case 'HLEN': { const e = live(a[0]); return e ? e.v.size : 0; }
      case 'HGETALL': { const e = live(a[0]); return e ? [...e.v].flat() : []; }
      case 'LPUSH': { const e = live(a[0]) || {v:[]}; e.v.unshift(String(a[1])); data.set(a[0], e); return e.v.length; }
      case 'RPOP': {
        const e = live(a[0]); if(!e || !e.v.length) return null;
        const n = a[1] ? Number(a[1]) : 1; const out = e.v.splice(Math.max(0, e.v.length - n), n).reverse();
        return a[1] ? out : out[0];
      }
      default: throw new Error('comando non supportato: ' + cmd);
    }
  };
  setInterval(() => { for(const k of data.keys()) live(k); }, 60000).unref();
  return { run: async cmds => cmds.map(exec) };
}

/* ---------- store Upstash Redis (REST, nessuna dipendenza) ---------- */
function createUpstashStore(url, token){
  return {
    async run(cmds){
      const r = await fetch(url.replace(/\/$/, '') + '/pipeline', {
        method:'POST',
        headers:{Authorization:'Bearer ' + token, 'Content-Type':'application/json'},
        body:JSON.stringify(cmds)
      });
      const out = await r.json();
      if(!r.ok || !Array.isArray(out)) throw new Error('database: ' + (out && out.error || r.status));
      return out.map(x => { if(x.error) throw new Error(x.error); return x.result; });
    }
  };
}

/* ---------- gestore delle richieste ---------- */
async function handle(ctx, store){
  const {method, route, query = {}, ip = 'x', lan = [], port = null} = ctx;
  let body = ctx.body || {};
  if(typeof body === 'string') body = parse(body) || {};
  if(JSON.stringify(body).length > MAX_BODY) return J(413, {error:'richiesta troppo grande'});
  const run = async (...cmds) => store.run(cmds);
  const one = async cmd => (await store.run([cmd]))[0];
  const now = Date.now();
  const code = String(query.room || body.room || '').toUpperCase();

  async function limit(name, max){          // antiabuso: max richieste al minuto per IP
    const k = `rl:${name}:${ip}:${Math.floor(now / 60000)}`;
    const [n] = await run(['INCR', k], ['EXPIRE', k, 70]);
    return n <= max;
  }
  async function getRoom(c){ const raw = c && validCode(c) ? await one(['GET', 'room:' + c]) : null; return raw ? parse(raw) : null; }

  /* --- GET info --- */
  if(route === 'info' && method === 'GET') return J(200, {ips:lan, port});

  /* --- GET room-info (pubblico: serve alla pagina di ingresso) --- */
  if(route === 'room-info' && method === 'GET'){
    const room = await getRoom(code);
    return J(200, room ? {exists:true, roster:room.roster || []} : {exists:false});
  }

  /* --- GET poll (telefono) --- */
  if(route === 'poll' && method === 'GET'){
    const pid = String(query.pid || '');
    if(!validCode(code) || !validPid(pid)) return J(400, {error:'parametri non validi'});
    const hb = query.hb === '1';
    const cmds = [['GET', `scr:${code}:${pid}`]];
    if(hb) cmds.push(['EXISTS', 'room:' + code], ['HEXISTS', 'mem:' + code, pid]);
    const res = await store.run(cmds);
    if(hb){
      if(!res[1] || !res[2]) return J(200, {gone:true});
      await run(['HSET', 'mem:' + code, pid, JSON.stringify({name:cleanName(query.name), ts:now})]);
    }
    const rec = res[0] ? parse(res[0]) : null;
    if(!rec) return J(200, {ver:'0'});
    if(String(query.v || '') === rec.ver) return J(200, {ver:rec.ver, same:true});
    return J(200, {ver:rec.ver, screen:rec.screen});
  }

  /* --- GET hpoll (host): atti dei telefoni + elenco membri --- */
  if(route === 'hpoll' && method === 'GET'){
    if(!validCode(code)) return J(400, {error:'codice non valido'});
    const wantMembers = query.members === '1';
    const cmds = [['GET', 'room:' + code], ['RPOP', 'acts:' + code, 50]];
    if(wantMembers) cmds.push(['HGETALL', 'mem:' + code]);
    const res = await store.run(cmds);
    const room = res[0] ? parse(res[0]) : null;
    if(!room) return J(404, {error:'stanza non trovata'});
    if(room.key !== query.key) return J(403, {error:'chiave host non valida'});
    const acts = (res[1] || []).map(parse).filter(Boolean);
    let members;
    if(wantMembers){
      members = [];
      const flat = res[2] || [];
      for(let i = 0; i < flat.length; i += 2){
        const m = parse(flat[i + 1]); if(!m) continue;
        members.push({pid:flat[i], name:m.name, online:now - m.ts < ONLINE_MS});
      }
    }
    return J(200, {acts, members});
  }

  if(method !== 'POST') return J(405, {error:'metodo non consentito'});

  /* --- POST room: crea o riapre (host) --- */
  if(route === 'room'){
    if(!(await limit('room', 30))) return J(429, {error:'troppe richieste'});
    const wantCode = String(body.code || '').toUpperCase();
    const key = typeof body.key === 'string' && /^[a-f0-9]{16,64}$/.test(body.key) ? body.key : null;
    if(validCode(wantCode) && key){
      const existing = await getRoom(wantCode);
      if(existing && existing.key === key){ await run(['EXPIRE', 'room:' + wantCode, TTL]); return J(200, {code:wantCode, key}); }
      if(!existing){
        const ok = await one(['SET', 'room:' + wantCode, JSON.stringify({key, roster:[], created:now}), 'NX', 'EX', TTL]);
        if(ok) return J(200, {code:wantCode, key});
      }
    }
    for(let i = 0; i < 10; i++){
      const c = newCode(), k = crypto.randomBytes(12).toString('hex');
      const ok = await one(['SET', 'room:' + c, JSON.stringify({key:k, roster:[], created:now}), 'NX', 'EX', TTL]);
      if(ok) return J(200, {code:c, key:k});
    }
    return J(503, {error:'impossibile creare la stanza'});
  }

  const room = await getRoom(code);
  if(!room) return J(404, {error:'stanza non trovata'});

  /* --- POST join: un telefono entra --- */
  if(route === 'join'){
    if(!(await limit('join', 60))) return J(429, {error:'troppe richieste'});
    const name = cleanName(body.name);
    let pid = typeof body.pid === 'string' && validPid(body.pid) ? body.pid : null;
    const known = pid ? await one(['HEXISTS', 'mem:' + code, pid]) : 0;
    if(!known){
      if(!name) return J(400, {error:'nome mancante'});
      const n = await one(['HLEN', 'mem:' + code]);
      if(n >= MAX_PLAYERS) return J(403, {error:'stanza piena'});
      pid = crypto.randomBytes(5).toString('hex');
    }
    const finalName = name || cleanName(body.fallbackName) || 'Giocatore';
    await run(['HSET', 'mem:' + code, pid, JSON.stringify({name:finalName, ts:now})], ['EXPIRE', 'mem:' + code, TTL]);
    return J(200, {pid, name:finalName});
  }

  /* --- POST act: un telefono invia una scelta --- */
  if(route === 'act'){
    const pid = String(body.pid || '');
    if(!validPid(pid)) return J(400, {error:'giocatore non valido'});
    if(!(await one(['HEXISTS', 'mem:' + code, pid]))) return J(403, {error:'giocatore sconosciuto'});
    await run(['LPUSH', 'acts:' + code, JSON.stringify({pid, data:body.data, t:now})], ['EXPIRE', 'acts:' + code, TTL]);
    return J(200, {ok:true});
  }

  /* --- POST screens: l'host aggiorna gli schermi dei telefoni --- */
  if(route === 'screens'){
    if(room.key !== body.key) return J(403, {error:'chiave host non valida'});
    const cmds = [];
    const ver = now.toString(36) + crypto.randomBytes(2).toString('hex');
    for(const [pid, screen] of Object.entries(body.screens || {})){
      if(!validPid(pid)) continue;
      cmds.push(['SET', `scr:${code}:${pid}`, JSON.stringify({ver, screen}), 'EX', TTL]);
    }
    if(Array.isArray(body.roster)){
      const roster = body.roster.slice(0, MAX_PLAYERS).map(cleanName).filter(Boolean);
      if(JSON.stringify(roster) !== JSON.stringify(room.roster || [])){
        cmds.push(['SET', 'room:' + code, JSON.stringify({...room, roster}), 'EX', TTL]);
      }
    }
    if(cmds.length) await store.run(cmds);
    return J(200, {ok:true});
  }

  return J(404, {error:'endpoint sconosciuto'});
}

module.exports = { handle, createMemoryStore, createUpstashStore };
