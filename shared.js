/* =====================================================================
   Codice condiviso tra Home e giochi: emoji dai nomi, roster giocatori,
   suoni e coriandoli.
   ===================================================================== */
const COLORS = ['#ff5d8f','#4cc9f0','#ffd166','#06d6a0','#c77dff','#ff9f1c','#90be6d','#ef476f','#00b4d8','#f9c74f','#9d4edd','#2ec4b6'];
const POOL = ['🦊','🐼','🐸','🦄','🐙','🦖','🐯','🐵','🐧','🦉','🐲','🐰','🦁','🐨','🦋','🐢','🦈','🐬','🦩','🦔','🐝','🦜','🐺','🦝','🐻','🦘','🐞','🦚'];
const NAME_EMOJI = {
  // nomi con un significato
  leo:'🦁',leone:'🦁',daniele:'🦁',leonardo:'🎨',luna:'🌙',sole:'☀️',stella:'⭐',rosa:'🌹',fiore:'🌸',margherita:'🌼',viola:'💜',
  giorgio:'🐉',giorgia:'🐉',angelo:'😇',angela:'😇',gabriele:'👼',gabriella:'👼',michele:'⚔️',marina:'🌊',mare:'🌊',
  aurora:'🌅',alba:'🌅',chiara:'✨',felice:'😄',gioia:'😄',fortuna:'🍀',perla:'🦪',diamante:'💎',rubino:'💎',
  giona:'🐋',tobia:'🐟',pietro:'🪨',alessandro:'🏺',cesare:'🏛️',giulio:'🏛️',augusto:'🏛️',nerone:'🔥',napoleone:'👑',
  dante:'📖',mario:'🍄',luigi:'🧢',natale:'🎄',pasqua:'🐣',vittoria:'🏆',
  // animali
  aquila:'🦅',lupo:'🐺',orso:'🐻',volpe:'🦊',gatto:'🐱',gatta:'🐱',cane:'🐶',topo:'🐭',coniglio:'🐰',pesce:'🐟',delfino:'🐬',
  tigre:'🐯',scimmia:'🐵',pinguino:'🐧',gufo:'🦉',serpente:'🐍',squalo:'🦈',polpo:'🐙',rana:'🐸',farfalla:'🦋',ape:'🐝',
  // cibo
  pizza:'🍕',pasta:'🍝',nutella:'🍫',cioccolato:'🍫',pane:'🍞',gelato:'🍦',caffe:'☕',birra:'🍺',vino:'🍷',banana:'🍌',
  fragola:'🍓',mela:'🍎',limone:'🍋',arancia:'🍊',ciliegia:'🍒',pomodoro:'🍅',patata:'🥔',sushi:'🍣',burger:'🍔',panino:'🥪',
  // soprannomi
  ninja:'🥷',pirata:'🏴‍☠️',robot:'🤖',alieno:'👽',fantasma:'👻',mago:'🧙',strega:'🧙‍♀️',drago:'🐉',unicorno:'🦄',
  campione:'🏆',genio:'🧠',boss:'😎',capo:'😎',dj:'🎧',calcio:'⚽',re:'👑',regina:'👸',principe:'🤴',principessa:'👸'
};
const NAME_STEMS = [['leon','🦁'],['gatt','🐱'],['cagn','🐶'],['drag','🐉'],['pirat','🏴‍☠️'],['princip','🤴'],['regin','👸'],
  ['stell','⭐'],['pizz','🍕'],['cioccol','🍫'],['fior','🌸'],['aquil','🦅'],['angel','😇'],['diavol','😈']];
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z\s]/g,' ').trim();

function suggestEmoji(name, taken=[]){
  const words = norm(name).split(/\s+/).filter(Boolean);
  let found = null;
  for(const w of words){
    if(NAME_EMOJI[w]){ found = NAME_EMOJI[w]; break; }
    const st = NAME_STEMS.find(([k]) => w.startsWith(k));
    if(st){ found = st[1]; break; }
  }
  if(found && !taken.includes(found)) return found;
  // nessuna corrispondenza: emoji "stabile" scelta dal nome, evitando quelle già prese
  let h = 0; for(const ch of norm(name)) h = (h*31 + ch.charCodeAt(0)) >>> 0;
  for(let i=0;i<POOL.length;i++){ const e = POOL[(h+i)%POOL.length]; if(!taken.includes(e)) return e; }
  return POOL[h % POOL.length];
}

/* ---------- roster condiviso (stessi giocatori in tutti i giochi) ---------- */
const ROSTER_KEY = 'party-roster-v1';
function loadRoster(){
  try{ const r = JSON.parse(localStorage.getItem(ROSTER_KEY)); return Array.isArray(r) ? r : null; }catch(e){ return null; }
}
function saveRoster(players){
  try{ localStorage.setItem(ROSTER_KEY, JSON.stringify(players.map(p => ({name:p.name, av:p.av, color:p.color})))); }catch(e){}
}

/* ---------- utilità (raggruppate per non confliggere con gli script dei giochi) ---------- */
const Party = {
  muted: false,
  esc: s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  shuffle(a){
    a = [...a];
    for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; }
    return a;
  },
  _ctx: null,
  tone(seq){
    if(Party.muted) return;
    try{
      Party._ctx = Party._ctx || new (window.AudioContext||window.webkitAudioContext)();
      const ctx = Party._ctx; let t = ctx.currentTime;
      seq.forEach(([f,d,type]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type||'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.18,t+.02); g.gain.exponentialRampToValueAtTime(.0001,t+d);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t+d+.02); t += d*.9;
      });
    }catch(e){}
  },
  burst(list, n=40){
    for(let i=0;i<n;i++){
      const e = document.createElement('div');
      e.className = 'fx'; e.textContent = list[i % list.length];
      e.style.left = Math.random()*100 + 'vw';
      e.style.fontSize = (16+Math.random()*26) + 'px';
      e.style.animationDuration = (1.8+Math.random()*2.2) + 's';
      e.style.animationDelay = Math.random()*.5 + 's';
      e.style.setProperty('--r', (Math.random()*720-360)+'deg');
      document.body.appendChild(e);
      setTimeout(()=>e.remove(), 5000);
    }
  }
};
