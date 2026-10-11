/* =====================================================================
   Net: lato HOST del gioco multi-dispositivo.
   Il browser dell'host tiene la partita; i telefoni (play.html) mostrano
   gli "schermi" che l'host pubblica e rispondono con le loro scelte.
   Funziona sia online (Vercel + Upstash Redis) sia con party-server.js.
   Richiede qrcode.js.
   ===================================================================== */
const Net = (() => {
  const KEY = 'party-room-v1';
  const POLL_MS = 800;
  const st = {code:null, key:null, base:null, members:[], status:'idle', onAct:()=>{}, onChange:()=>{}};
  let panelEl = null, lastSent = '', running = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const notify = () => { try{ st.onChange(); }catch(e){} if(panelEl) drawPanel(); };
  const setStatus = s => { if(st.status !== s){ st.status = s; notify(); } };

  async function api(path, body){
    const r = await fetch(path, body === undefined ? {cache:'no-store'} : {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if(!r.ok){ const e = new Error(j.error || r.status); e.status = r.status; e.code = j.error; throw e; }
    return j;
  }

  async function openRoom(){
    let saved = null; try{ saved = JSON.parse(localStorage.getItem(KEY)); }catch(e){}
    const r = await api('/api/room', saved || {});
    st.code = r.code; st.key = r.key;
    try{ localStorage.setItem(KEY, JSON.stringify({code:r.code, key:r.key})); }catch(e){}
  }

  async function start({onAct, onChange} = {}){
    if(onAct) st.onAct = onAct;
    if(onChange) st.onChange = onChange;
    if(location.protocol === 'file:'){ st.status = 'nofile'; return notify(); }
    try{
      const info = await api('/api/info');
      // in locale: link per i telefoni con l'IP della rete; online: l'indirizzo del sito
      const local = ['localhost', '127.0.0.1'].includes(location.hostname);
      st.base = local && info.ips && info.ips[0] ? `http://${info.ips[0]}:${info.port || location.port}` : location.origin;
      await openRoom();
      setStatus('online');
      if(!running){ running = true; loop(); }
    }catch(e){
      st.status = e.code === 'nodb' ? 'nodb' : 'offline';
      notify();
    }
  }

  /* polling dell'host: acts dei telefoni + elenco presenti */
  async function loop(){
    let tick = 0;
    while(true){
      try{
        const j = await api(`/api/hpoll?room=${st.code}&key=${st.key}${tick % 3 === 0 ? '&members=1' : ''}`);
        if(st.status !== 'online'){ lastSent = ''; st.status = 'online'; notify(); }
        if(j.members){
          const prev = JSON.stringify(st.members);
          st.members = j.members;
          if(prev !== JSON.stringify(j.members)) notify();
        }
        for(const a of j.acts || []){ try{ st.onAct(a.pid, a.data); }catch(err){ console.error(err); } }
      }catch(e){
        if(e.status === 404 || e.status === 403){
          try{ await openRoom(); lastSent = ''; }catch(err){ setStatus('offline'); }   // stanza scaduta: la riapre
        }else setStatus('offline');
      }
      tick++;
      await sleep(POLL_MS);
    }
  }

  /* Invia gli schermi ai telefoni (solo se qualcosa è cambiato). */
  function push(screens, roster){
    if(st.status !== 'online') return;
    const payload = JSON.stringify({screens, roster});
    if(payload === lastSent) return;
    lastSent = payload;
    api('/api/screens', {room:st.code, key:st.key, screens, roster}).catch(() => { lastSent = ''; });
  }

  const joinUrl = () => st.code ? `${st.base}/play.html?room=${st.code}` : '';
  const online = pid => st.members.some(m => m.pid === pid && m.online);
  const known = pid => st.members.some(m => m.pid === pid);

  function qrSvg(text){
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({cellSize:6, margin:2, scalable:true});
  }

  /* ----- pannello "📱 Telefoni" ----- */
  function drawPanel(){
    if(!panelEl) return;
    const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let inner;
    if(st.status === 'nofile'){
      inner = `<h3>Apri il sito</h3>
        <p>Hai aperto il file direttamente dal computer: per giocare dai telefoni usa il sito online oppure avvia il server locale:</p>
        <pre>cd JEOPARDY\nnode party-server.js</pre>`;
    }else if(st.status === 'nodb'){
      inner = `<h3>Database non collegato</h3>
        <p>Per giocare dai telefoni online serve il database: su Vercel apri il progetto → <b>Storage</b> → crea <b>Upstash Redis</b> e collegalo, poi ridistribuisci.</p>`;
    }else if(!st.code){
      inner = `<h3>Server non raggiungibile</h3>
        <p>Controlla la connessione e ricarica la pagina. In locale, avvia il server con:</p><pre>node party-server.js</pre>`;
    }else{
      const url = joinUrl();
      inner = `<h3>📱 Entra dal telefono</h3>
        <div class="qrbox">${qrSvg(url)}</div>
        <p class="code">Codice stanza <b>${st.code}</b></p>
        <p class="url">${esc(url)}</p>
        <div class="mem">${st.members.length
          ? st.members.map(m => `<span class="${m.online ? 'on' : ''}">${m.online ? '🟢' : '⚪'} ${esc(m.name)}</span>`).join('')
          : '<em>Nessun telefono collegato per ora…</em>'}</div>
        ${st.status !== 'online' ? '<p class="warn">⚠️ Connessione persa, riprovo…</p>' : ''}`;
    }
    panelEl.querySelector('.netcard').innerHTML = `<button class="netx" onclick="Net.closePanel()">✕</button>${inner}`;
  }
  function openPanel(){
    if(panelEl) return;
    if(!document.getElementById('net-css')){
      const s = document.createElement('style'); s.id = 'net-css';
      s.textContent = `
      .netov{position:fixed;inset:0;z-index:200;background:#02051acc;backdrop-filter:blur(6px);display:grid;place-items:center;padding:14px}
      .netcard{position:relative;background:#0b1568;border:3px solid #ffcf3d;border-radius:22px;padding:22px;width:min(420px,100%);max-height:100%;overflow:auto;text-align:center;color:#f4f6ff;font-family:'Fredoka',system-ui,sans-serif}
      .netcard h3{font-family:'Anton',Impact,sans-serif;font-weight:400;letter-spacing:.03em;font-size:1.6rem;color:#ffcf3d;margin-bottom:10px}
      .netcard .qrbox{background:#fff;border-radius:16px;padding:10px;width:min(260px,70vw);margin:0 auto 10px}
      .netcard .qrbox svg{display:block;width:100%;height:auto}
      .netcard .code{font-size:1.1rem}.netcard .code b{font-family:'Anton',Impact,sans-serif;font-size:2rem;letter-spacing:.2em;color:#ffcf3d;font-weight:400}
      .netcard .url{color:#9aa6e8;word-break:break-all;font-size:.9rem;margin:4px 0 12px}
      .netcard .mem{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
      .netcard .mem span{background:#ffffff14;border-radius:99px;padding:4px 12px;font-weight:600}
      .netcard .mem em{color:#9aa6e8}
      .netcard pre{background:#050a3a;border-radius:10px;padding:10px;text-align:left;margin-top:8px}
      .netcard .warn{color:#ff5470;margin-top:10px}
      .netx{position:absolute;top:10px;right:12px;background:none;border:0;color:#9aa6e8;font-size:1.3rem;cursor:pointer}`;
      document.head.appendChild(s);
    }
    panelEl = document.createElement('div');
    panelEl.className = 'netov';
    panelEl.innerHTML = '<div class="netcard"></div>';
    panelEl.addEventListener('click', e => { if(e.target === panelEl) closePanel(); });
    document.body.appendChild(panelEl);
    drawPanel();
  }
  function closePanel(){ if(panelEl){ panelEl.remove(); panelEl = null; } }

  return {
    start, push, openPanel, closePanel, joinUrl, online, known,
    get members(){ return st.members; },
    get status(){ return st.status; },
    get code(){ return st.code; },
    get onlineCount(){ return st.members.filter(m => m.online).length; }
  };
})();
