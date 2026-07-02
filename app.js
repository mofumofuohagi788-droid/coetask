"use strict";
const $=s=>document.querySelector(s);
const store={
  key:'coetask.v1',
  load(){ try{return JSON.parse(localStorage.getItem(this.key))||[]}catch(e){return[]} },
  save(v){ localStorage.setItem(this.key, JSON.stringify(v)); }
};
let tasks = store.load();
const sharedStore={
  key:'coetask.shared.v1',
  load(){ try{return JSON.parse(localStorage.getItem(this.key))||[]}catch(e){return[]} },
  save(v){ localStorage.setItem(this.key, JSON.stringify(v)); }
};
let sharedItems = sharedStore.load();

/* アラーム設定（複数選択可・端末内保存） */
const ALARMS=[
  {k:'w1',     label:'1週間前'},
  {k:'d3',     label:'3日前'},
  {k:'d1',     label:'前日(同時刻)'},
  {k:'morning',label:'当日の朝9時'},
  {k:'h1',     label:'1時間前'},
  {k:'m30',    label:'30分前'},
  {k:'m10',    label:'10分前'},
];
const settings={
  key:'coetask.settings.v1',
  data:(()=>{ try{return JSON.parse(localStorage.getItem('coetask.settings.v1'))||null}catch(e){return null} })()
        || {alarms:['h1','m30','m10'], team:null},
  save(){ localStorage.setItem(this.key, JSON.stringify(this.data)); }
};
if(!settings.data.alarms) settings.data.alarms=['h1','m30','m10'];

/* ==== チーム共有（Firebase Firestore・無料枠） ====
   下の PASTE_ を自分のFirebaseプロジェクト値に置換すると共有が有効化される。
   未設定でも「個人（端末内）」モードは通常どおり動作する。 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCnUEahIa1b_kRzK3Anywj6mVntr0kZ4-U",
  authDomain: "coetask-1c803.firebaseapp.com",
  projectId: "coetask-1c803",
  storageBucket: "coetask-1c803.firebasestorage.app",
  messagingSenderId: "418960031713",
  appId: "1:418960031713:web:335357b9406a2d51315ca0"
};
const team={
  on:false, code:null, _db:null, _fs:null, _col:null, _sharedCol:null, _unsub:null, _unsubShared:null,
  configured(){ return !/^PASTE/.test(FIREBASE_CONFIG.apiKey); },
  async connect(code){
    code=(code||'').trim();
    if(!code){ toast('チームコードを入力してください'); return false; }
    if(!this.configured()){ toast('Firebase未設定（手順書STEPを実施）'); return false; }
    if(this.on && this.code===code) return true;   // 既に同チーム接続中なら何もしない
    try{
      const [appMod,fsMod]=await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
      ]);
      // アプリ/DBは一度だけ生成（二重初期化の例外を防止）
      const app=appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
      this._db=this._db || fsMod.getFirestore(app);
      this._fs=fsMod;
      // 既存リスナーを必ず解除してから張り直す（多重購読でチラつく/取りこぼす問題を防止）
      if(this._unsub){ this._unsub(); this._unsub=null; }
      if(this._unsubShared){ this._unsubShared(); this._unsubShared=null; }
      this._col=fsMod.collection(this._db,'teams',code,'tasks');
      this._sharedCol=fsMod.collection(this._db,'teams',code,'shared');
      this._unsub=fsMod.onSnapshot(this._col,
        snap=>{ tasks=snap.docs.map(d=>d.data()); render(); },
        err=>toast('同期エラー：'+(err.code||err.message)));
      this._unsubShared=fsMod.onSnapshot(this._sharedCol,
        snap=>{ sharedItems=snap.docs.map(d=>d.data()); renderShared(); },
        err=>toast('共有ページ同期エラー：'+(err.code||err.message)));
      this.on=true; this.code=code;
      settings.data.team=code; settings.save();
      renderTeam(); toast('チーム「'+code+'」に接続'); return true;
    }catch(e){ toast('接続失敗：'+(e.message||e)); this.on=false; return false; }
  },
  save(t){ if(!this.on)return; this._fs.setDoc(this._fs.doc(this._col,t.id),JSON.parse(JSON.stringify(t))).catch(()=>toast('保存失敗')); },
  saveShared(item){ if(!this.on)return; this._fs.setDoc(this._fs.doc(this._sharedCol,item.id),JSON.parse(JSON.stringify(item))).catch(()=>toast('共有ページ保存失敗')); },
  remove(id){ if(!this.on)return; this._fs.deleteDoc(this._fs.doc(this._col,id)).catch(()=>{}); },
  removeShared(id){ if(!this.on)return; this._fs.deleteDoc(this._fs.doc(this._sharedCol,id)).catch(()=>{}); },
  async push(list){ for(const t of list) this.save(t); },   // 個人タスクをチームへ投入
  async pushShared(list){ for(const item of list) this.saveShared(item); },
  disconnect(){ if(this._unsub)this._unsub(); if(this._unsubShared)this._unsubShared();
    this._unsub=null; this._unsubShared=null; this._col=null; this._sharedCol=null;
    this.on=false; this.code=null;
    settings.data.team=null; settings.save(); tasks=store.load(); sharedItems=sharedStore.load(); render(); renderShared(); renderTeam(); toast('個人モードに戻りました'); }
};

/* データ層：チーム接続時はFirestore、未接続時はlocalStorage */
function persist(t){
  if(team.on){ team.save(t); return; }          // 表示更新はonSnapshotに一元化（重複/チラつき防止）
  const i=tasks.findIndex(x=>x.id===t.id);
  if(i<0) tasks.push(t); else tasks[i]=t;
  store.save(tasks); render();
}
function removeTask(id){
  if(team.on){ team.remove(id); return; }
  tasks=tasks.filter(x=>x.id!==id); store.save(tasks); render();
}
function persistShared(item){
  if(team.on){ team.saveShared(item); return; }
  const i=sharedItems.findIndex(x=>x.id===item.id);
  if(i<0) sharedItems.push(item); else sharedItems[i]=item;
  sharedStore.save(sharedItems); renderShared();
}
function removeShared(id){
  if(team.on){ team.removeShared(id); return; }
  sharedItems=sharedItems.filter(x=>x.id!==id); sharedStore.save(sharedItems); renderShared();
}

/* ---------- 日本語 日時パーサ ---------- */
const WD={'日':0,'月':1,'火':2,'水':3,'木':4,'金':5,'土':6};
const KANJI={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'半':30};
function toNum(s){
  if(s==null) return null;
  s=String(s).trim();
  if(/^\d+$/.test(s)) return parseInt(s,10);
  if(s==='半') return 30;
  // 十/十五/二十三 などの簡易漢数字
  if(s.includes('十')){
    const[a,b]=s.split('十');
    return (a?KANJI[a]||0:1)*10 + (b?KANJI[b]||0:0);
  }
  return KANJI[s]??null;
}
// 発話テキスト -> {title, due:Date|null}
function parse(raw){
  let t=(raw||'').replace(/[、。]/g,' ').trim();
  const now=new Date();
  let due=null, hasDate=false, hasTime=false, repeat=null;
  const consume=re=>{ const m=t.match(re); if(m){ t=t.replace(m[0],' '); } return m; };

  const base=new Date(now); base.setSeconds(0,0);
  let d=new Date(base);

  // 繰り返し（毎日 / 毎週 / 毎月）
  if(consume(/毎晩/)){ repeat='daily'; hasDate=true; d.setHours(20,0,0,0); hasTime=true; }
  else if(consume(/毎朝|毎日|毎日中/)){ repeat='daily'; hasDate=true; }
  else if(consume(/毎週間?/)){ repeat='weekly'; hasDate=true; }
  else if(consume(/毎月/)){ repeat='monthly'; hasDate=true; }

  // 相対（N分後 / N時間後 / N日後）※直後の助詞も一緒に除去
  let m=consume(/(\d+|[一二三四五六七八九十]+)\s*分後[にはで]?/);
  if(m){ d=new Date(now.getTime()+toNum(m[1])*60000); hasDate=hasTime=true; }
  m=consume(/(\d+|[一二三四五六七八九十]+)\s*時間後[にはで]?/);
  if(m){ d=new Date(now.getTime()+toNum(m[1])*3600000); hasDate=hasTime=true; }
  m=consume(/(\d+|[一二三四五六七八九十]+)\s*日後[にはで]?/);
  if(m){ d.setDate(d.getDate()+toNum(m[1])); hasDate=true; }

  // 語彙的な日付
  if(!hasDate){
    if(consume(/(今日中|今日|本日|きょう)[にはまで]*/)){ hasDate=true; }
    else if(consume(/(明後日|あさって)[のにはで]?/)){ d.setDate(d.getDate()+2); hasDate=true; }
    else if(consume(/(明日|あした|あす)[のにはで]?/)){ d.setDate(d.getDate()+1); hasDate=true; }
    else if(consume(/(今夜|今晩)[にはで]?/)){ hasDate=true; d.setHours(20,0,0,0); hasTime=true; }
  }
  // 曜日（来週◯曜／◯曜日）
  m=consume(/(来週)?\s*([日月火水木金土])曜日?/);
  if(m){
    const target=WD[m[2]]; let add=(target-d.getDay()+7)%7;
    if(add===0) add=7;           // 同じ曜日は次
    if(m[1]) add+= (add<=0?7:0); // 来週指定
    if(m[1] && add<7) add+=7;
    d.setDate(d.getDate()+add); hasDate=true;
  }
  // N月N日
  m=consume(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if(m){ d.setMonth(toNum(m[1])-1); d.setDate(toNum(m[2]));
         if(d<now && !hasTime) d.setFullYear(d.getFullYear()+1); hasDate=true; }

  // 午前/午後・朝昼夜
  let ampm=null;
  if(consume(/午後|夕方|夜/)) ampm='pm';
  else if(consume(/午前|朝/)) ampm='am';
  if(consume(/(正午|昼)[にはで]?/)){ d.setHours(12,0,0,0); hasTime=true; }

  // 時刻（N時 / N時半 / N時M分 / N:M）※直後の助詞も除去
  m=consume(/(\d{1,2}|[一二三四五六七八九十]+)\s*時\s*(半|(\d{1,2}|[一二三四五六七八九十]+)\s*分)?[にはで]?/);
  if(m){
    let h=toNum(m[1]); let min=0;
    if(m[2]==='半') min=30; else if(m[3]!=null) min=toNum(m[3]);
    if(ampm==='pm' && h<12) h+=12;
    if(ampm==='am' && h===12) h=0;
    d.setHours(h,min,0,0); hasTime=true;
  } else {
    m=consume(/(\d{1,2}):(\d{2})[にはで]?/);
    if(m){ let h=+m[1]; if(ampm==='pm'&&h<12)h+=12; d.setHours(h,+m[2],0,0); hasTime=true; }
  }

  if(hasTime && !hasDate) hasDate=true; // 時刻のみ → 今日扱い
  if(hasDate){
    if(!hasTime) d.setHours(9,0,0,0);      // 時刻未指定は朝9時
    due=d;                                 // 過去当日は期限切れ表示に使う
  }
  // タイトル整形：日時を抽出した時のみ残留助詞を除去（通常語の誤削りを防ぐ）
  let title=t.replace(/\s+/g,' ').trim();
  if(hasDate){
    title=title.split(' ').filter(w=>!/^(に|の|で|は|を|へ|まで|までに)$/.test(w)).join(' ')
               .replace(/^(に|の|で|は|を|へ|まで|までに)(?=\S)/,'').trim();
  }
  return { title: title||raw.trim(), due: due?due.getTime():null, repeat };
}

/* ---------- 表示 ---------- */
const DOW=['日','月','火','水','木','金','土'];
function fmt(ts){
  const d=new Date(ts), n=new Date();
  const sameDay=d.toDateString()===n.toDateString();
  const tmr=new Date(n); tmr.setDate(n.getDate()+1);
  const isTmr=d.toDateString()===tmr.toDateString();
  const hm=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  let day = sameDay?'今日': isTmr?'明日':
            `${d.getMonth()+1}/${d.getDate()}(${DOW[d.getDay()]})`;
  return `${day} ${hm}`;
}
function dayStart(ts){ const d=new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }

function render(){
  const now=Date.now(), todayStart=dayStart(now), tmrStart=todayStart+864e5;
  $('#todayLabel').textContent = fmt(now).split(' ')[0]+' の予定';

  const active=tasks.filter(t=>!t.done);
  const groups={over:[],today:[],up:[],none:[]};
  for(const t of active){
    if(t.due==null) groups.none.push(t);
    else if(t.due<now) groups.over.push(t);
    else if(t.due<tmrStart) groups.today.push(t);
    else groups.up.push(t);
  }
  const byDue=(a,b)=>(a.due??Infinity)-(b.due??Infinity);
  [groups.over,groups.today,groups.up,groups.none].forEach(g=>g.sort(byDue));

  $('#cOver').textContent=groups.over.length;
  $('#cToday').textContent=groups.today.length;
  $('#cUp').textContent=groups.up.length;
  $('#cDone').textContent=tasks.filter(t=>t.done).length;

  const done=tasks.filter(t=>t.done).sort((a,b)=>b.doneAt-a.doneAt).slice(0,20);
  const sections=[
    ['期限切れ','overdue',groups.over],
    ['今日','today',groups.today],
    ['今後',' ',groups.up],
    ['期限なし',' ',groups.none],
    ['完了','done',done],
  ];
  let html='';
  let total=active.length;
  for(const[name,cls,arr] of sections){
    if(!arr.length) continue;
    html+=`<div class="group ${cls.trim()}">${name}<span class="cnt">${arr.length}</span></div><ul>`;
    for(const t of arr) html+=row(t,now);
    html+='</ul>';
  }
  $('#list').innerHTML = total||done.length ? html
    : `<div class="empty">まだ予定はありません。<br>下の🎙️を押して話しかけてください。</div>`;
}
function row(t,now){
  const od=t.due!=null && t.due<now && !t.done;
  let when='';
  if(t.due!=null){
    const soon=!od && t.due<now+2*3600000;
    when=`<span class="when ${od?'od':soon?'soon':''}">🕑 ${fmt(t.due)}${od?' ・超過':''}</span>`;
  }
  const cal = `<div class="cal" data-act="cal" title="日時変更">📅</div>`;
  const ics = t.due!=null ? `<div class="cal" data-act="ics" title="カレンダー登録(.ics)">📤</div>` : '';
  const repLabel = t.repeat==='monthly'?'毎月':t.repeat==='weekly'?'毎週':t.repeat==='daily'?'毎日':'';
  const rep = repLabel ? `<span class="rep">🔁${repLabel}</span>` : '';
  const monthly = t.due!=null ? `<div class="cal" data-act="monthly" title="毎月表示">${t.repeat==='monthly'?'🔁':'↻'}</div>` : '';
  return `<li class="${t.done?'done':''} ${od?'od':''}" data-id="${t.id}">
    <div class="check" data-act="toggle">✓</div>
    <div class="body">
      <div class="ttl" data-act="edit" title="タップで編集">${esc(t.title)}</div>
      <div class="meta">${when||'<span>期限なし</span>'}${rep}</div>
    </div>
    ${monthly}
    ${cal}
    ${ics}
    <div class="del" data-act="del">✕</div>
  </li>`;
}
function esc(s){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function safeUrl(raw){
  const s=(raw||'').trim();
  if(!s) return '';
  try{
    const u=new URL(/^https?:\/\//i.test(s)?s:'https://'+s);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  }catch(e){ return ''; }
}

/* ---------- タスク編集（タイトル手入力・日時変更） ---------- */
function startEdit(li,t){
  const ttl=li.querySelector('.ttl'); if(!ttl) return;
  const inp=document.createElement('input');
  inp.className='editttl'; inp.value=t.title;
  ttl.replaceWith(inp); inp.focus(); inp.select();
  let done=false;
  const commit=save=>{ if(done)return; done=true;
    const v=inp.value.trim();
    if(save && v && v!==t.title){ t.title=v; persist(t); toast('タイトルを変更'); }
    else render();
  };
  inp.addEventListener('keydown',ev=>{
    if(ev.key==='Enter'){ ev.preventDefault(); commit(true); }
    else if(ev.key==='Escape'){ commit(false); }
  });
  inp.addEventListener('blur',()=>commit(true));
}
function toLocalInput(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function editDue(t){
  const inp=document.createElement('input');
  inp.type='datetime-local';
  inp.style.cssText='position:fixed; left:8px; bottom:120px; z-index:50; opacity:0;';
  inp.value=toLocalInput(t.due?new Date(t.due):new Date());
  document.body.appendChild(inp);
  let done=false;
  const finish=()=>{ if(done)return; done=true; setTimeout(()=>inp.remove(),200); };
  inp.addEventListener('change',()=>{
    if(inp.value){ t.due=new Date(inp.value).getTime(); persist(t); toast('日時を変更：'+fmt(t.due)); }
    finish();
  });
  inp.addEventListener('blur',finish);
  inp.focus();
  if(inp.showPicker){ try{ inp.showPicker(); }catch(e){ inp.click(); } } else inp.click();
}

/* ---------- 共有ページ ---------- */
const SCOPE_LABEL={month:'今月の重要事項',week:'今週の重要事項',regular:'定期確認'};
function monthKey(ts=Date.now()){
  const d=new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function resetMonthlyShared(){
  const key=monthKey();
  let changed=false;
  for(const item of sharedItems){
    if(item.monthly && item.done && item.doneMonth && item.doneMonth!==key){
      item.done=false; item.doneAt=null; item.doneMonth=null; changed=true;
      if(team.on) team.saveShared(item);
    }
  }
  if(changed && !team.on) sharedStore.save(sharedItems);
}
function renderShared(){
  resetMonthlyShared();
  const sorted=sharedItems.slice().sort((a,b)=>(a.done===b.done?0:a.done?1:-1) || (b.createdAt||0)-(a.createdAt||0));
  const groups=[
    ['今月の重要事項','month',sorted.filter(x=>x.scope==='month')],
    ['今週の重要事項','week',sorted.filter(x=>x.scope==='week')],
    ['定期確認','regular',sorted.filter(x=>x.scope==='regular')],
  ];
  let html='';
  for(const [label,scope,arr] of groups){
    if(!arr.length) continue;
    html+=`<div class="group">${label}<span class="cnt">${arr.length}</span></div><ul>`;
    for(const item of arr) html+=sharedRow(item);
    html+='</ul>';
  }
  $('#sharedList').innerHTML = html || `<div class="empty">共有ページはまだ空です。<br>今月・今週の重要事項や確認リンクを追加してください。</div>`;
}
function sharedRow(item){
  const url=safeUrl(item.url);
  const link=url?`<a class="sharelink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`:'';
  return `<li class="shareitem ${item.done?'done':''}" data-id="${item.id}">
    <div class="sharetop">
      <div class="check" data-act="shareToggle">✓</div>
      <div class="sharebody">
        <div class="sharetitle">${esc(item.title)}</div>
        ${item.note?`<div class="sharetext">${esc(item.note)}</div>`:''}
        ${link}
        <div>
          <span class="badge">${SCOPE_LABEL[item.scope]||'共有'}</span>
          ${item.monthly?'<span class="badge monthly">毎月表示</span>':''}
        </div>
      </div>
      <div class="cal" data-act="shareMonthly" title="毎月表示">${item.monthly?'🔁':'↻'}</div>
      <div class="del" data-act="shareDel">✕</div>
    </div>
  </li>`;
}
function addSharedItem(){
  const title=$('#shareTitle').value.trim();
  const note=$('#shareNote').value.trim();
  const url=$('#shareUrl').value.trim();
  if(!title && !note && !url){ toast('共有する内容を入力してください'); return; }
  const item={
    id:Date.now()+''+Math.random().toString(36).slice(2,6),
    scope:$('#shareScope').value,
    title:title||note.split(/\r?\n/)[0]||url,
    note,
    url,
    monthly:$('#shareMonthly').checked,
    done:false,
    doneAt:null,
    createdAt:Date.now()
  };
  persistShared(item);
  $('#shareTitle').value=''; $('#shareNote').value=''; $('#shareUrl').value=''; $('#shareMonthly').checked=false;
  toast('共有ページに追加しました');
}

/* ---------- 操作 ---------- */
function setView(name){
  const shared=name==='shared';
  $('#tabTasks').classList.toggle('on',!shared);
  $('#tabShared').classList.toggle('on',shared);
  $('#taskView').classList.toggle('on',!shared);
  $('#sharedView').classList.toggle('on',shared);
  $('.bar').style.display=shared?'none':'flex';
  if(shared) renderShared();
}
$('#tabTasks').addEventListener('click',()=>setView('tasks'));
$('#tabShared').addEventListener('click',()=>setView('shared'));

function addTask(text){
  const p=parse(text);
  if(!p.title) return;
  const task={id:Date.now()+''+Math.random().toString(36).slice(2,6),
              title:p.title, due:p.due, repeat:p.repeat||null, done:false, doneAt:null, createdAt:Date.now()};
  persist(task);
  const rp=p.repeat==='monthly'?'（毎月）':p.repeat==='daily'?'（毎日）':p.repeat==='weekly'?'（毎週）':'';
  toast(p.due? `追加：${p.title}${rp}（${fmt(p.due)}）` : `追加：${p.title}${rp}`);
}
$('#list').addEventListener('click',e=>{
  const li=e.target.closest('li'); if(!li) return;
  const id=li.dataset.id, act=e.target.dataset.act;
  const t=tasks.find(x=>x.id===id); if(!t) return;
  if(act==='edit'){ startEdit(li,t); return; }
  if(act==='cal'){ editDue(t); return; }
  if(act==='ics'){ exportICS(t); return; }
  if(act==='del'){ removeTask(id); return; }
  if(act==='monthly'){
    t.repeat = t.repeat==='monthly' ? null : 'monthly';
    persist(t); toast(t.repeat==='monthly'?'毎月表示にしました':'毎月表示を解除しました'); return;
  }
  if(act==='toggle'){
    if(t.repeat && !t.done){                 // 繰り返し：完了で次回へ送る
      const d=new Date(t.due);
      if(t.repeat==='monthly') d.setMonth(d.getMonth()+1);
      else if(t.repeat==='weekly') d.setDate(d.getDate()+7); else d.setDate(d.getDate()+1);
      t.due=d.getTime(); persist(t); toast(`完了 → 次回：${fmt(t.due)}`); return;
    }
    t.done=!t.done; t.doneAt=t.done?Date.now():null; persist(t);
  }
});
$('#sharedList').addEventListener('click',e=>{
  const li=e.target.closest('li'); if(!li) return;
  const id=li.dataset.id, act=e.target.dataset.act;
  const item=sharedItems.find(x=>x.id===id); if(!item) return;
  if(act==='shareDel'){ removeShared(id); return; }
  if(act==='shareMonthly'){
    item.monthly=!item.monthly; persistShared(item);
    toast(item.monthly?'共有項目を毎月表示にしました':'共有項目の毎月表示を解除しました'); return;
  }
  if(act==='shareToggle'){
    item.done=!item.done; item.doneAt=item.done?Date.now():null; item.doneMonth=item.done?monthKey():null; persistShared(item); return;
  }
});
$('#shareAdd').addEventListener('click',addSharedItem);

/* ---------- iOS純正カレンダー連携（.ics + 10分前アラーム） ---------- */
function icsDate(ts){ const d=new Date(ts); const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`; }
function icsEsc(s){ return String(s).replace(/[\\;,]/g,m=>'\\'+m).replace(/\n/g,'\\n'); }
const DUR={w1:'-P1W',d3:'-P3D',d1:'-P1D',h1:'-PT1H',m30:'-PT30M',m10:'-PT10M'};
function alarmLines(t){
  const out=[]; const desc=icsEsc(t.title);
  for(const k of settings.data.alarms){
    let trig;
    if(k==='morning'){                       // 当日朝9時（イベント前のみ有効）
      const m=new Date(t.due); m.setHours(9,0,0,0);
      if(m.getTime()>=t.due) continue;
      trig=`TRIGGER;VALUE=DATE-TIME:${icsDate(m.getTime())}`;
    } else if(DUR[k]) trig=`TRIGGER:${DUR[k]}`; else continue;
    out.push('BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${desc}`,trig,'END:VALARM');
  }
  return out;
}
function exportICS(t){
  if(t.due==null){ toast('期限のあるタスクのみ登録できます'); return; }
  const start=icsDate(t.due), end=icsDate(t.due+30*60000), stamp=icsDate(Date.now());
  const rrule = t.repeat==='daily' ? ['RRULE:FREQ=DAILY']
    : t.repeat==='weekly' ? [`RRULE:FREQ=WEEKLY;BYDAY=${['SU','MO','TU','WE','TH','FR','SA'][new Date(t.due).getDay()]}`]
    : t.repeat==='monthly' ? ['RRULE:FREQ=MONTHLY']
    : [];
  const ics=[
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//coetask//JP','CALSCALE:GREGORIAN','METHOD:PUBLISH',
    'BEGIN:VEVENT',`UID:${t.id}@coetask`,`DTSTAMP:${stamp}`,
    `DTSTART:${start}`,`DTEND:${end}`,...rrule,`SUMMARY:${icsEsc(t.title)}`,
    ...alarmLines(t),
    'END:VEVENT','END:VCALENDAR'
  ].join('\r\n');
  const blob=new Blob([ics],{type:'text/calendar;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=(t.title||'task').replace(/[\\/:*?"<>|]/g,'_')+'.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
  const names=settings.data.alarms.map(k=>(ALARMS.find(a=>a.k===k)||{}).label).filter(Boolean).join('/');
  toast('カレンダーに登録'+(names?`（${names}に通知）`:''));
}
const input=$('#addtxt');
input.addEventListener('keydown',e=>{ if(e.key==='Enter'&&input.value.trim()){ addTask(input.value); input.value=''; }});

let toastT;
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('on');
  clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('on'),2600); }

/* ---------- 音声入力 ---------- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const mic=$('#mic'), ov=$('#listening'), heard=$('#heard');
let rec=null, recording=false, recTimer=null;
function stopRec(){ clearTimeout(recTimer); if(rec){ try{rec.stop()}catch(e){} } recording=false; mic.classList.remove('rec'); ov.classList.remove('on'); }
$('#closeL').addEventListener('click',stopRec);

mic.addEventListener('click',()=>{
  if(!SR){ toast('この端末は音声入力に非対応です。手入力をご利用ください'); input.focus(); return; }
  if(recording){ stopRec(); return; }
  rec=new SR(); rec.lang='ja-JP'; rec.interimResults=true; rec.maxAlternatives=1; rec.continuous=true;
  let finalText='';
  // 発話中は切らない。声の反応が途切れて5秒経ったら停止
  const armSilence=()=>{ clearTimeout(recTimer); recTimer=setTimeout(()=>{ try{rec.stop()}catch(e){} },5000); };
  rec.onstart=()=>{ recording=true; mic.classList.add('rec'); ov.classList.add('on'); heard.textContent='お話しください…'; armSilence(); };
  rec.onspeechstart=armSilence;
  rec.onresult=e=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const r=e.results[i];
      if(r.isFinal) finalText+=r[0].transcript; else interim+=r[0].transcript;
    }
    heard.textContent=(finalText+interim)||'…';
    armSilence();                 // 声を拾うたびに5秒カウントをリセット
  };
  rec.onerror=e=>{ heard.textContent='認識できませんでした'; toast('音声エラー：'+e.error); };
  rec.onend=()=>{
    clearTimeout(recTimer);
    recording=false; mic.classList.remove('rec'); ov.classList.remove('on');
    const txt=finalText.trim();
    if(txt) addTask(txt);
  };
  try{ rec.start(); }catch(e){ stopRec(); }
});

/* ---------- 通知設定シート ---------- */
const sheet=$('#sheet'), opts=$('#opts');
function renderOpts(){
  opts.innerHTML=ALARMS.map(a=>{
    const on=settings.data.alarms.includes(a.k);
    return `<div class="opt ${on?'on':''}" data-k="${a.k}"><div class="sw"></div><div>${a.label}</div></div>`;
  }).join('');
}
const teamStatus=$('#teamStatus'), teamCodeIn=$('#teamCode'), teamBtn=$('#teamBtn');
function renderTeam(){
  if(team.on){
    teamStatus.textContent='🟢 チーム「'+team.code+'」に接続中（共有）';
    teamStatus.classList.add('live');
    teamCodeIn.value=team.code; teamCodeIn.disabled=true;
    teamBtn.textContent='退出'; teamBtn.classList.add('leave');
  }else{
    teamStatus.textContent = team.configured()? '個人モード（この端末のみ）'
      : '個人モード（共有にはFirebase設定が必要）';
    teamStatus.classList.remove('live');
    teamCodeIn.disabled=false;
    teamBtn.textContent='参加'; teamBtn.classList.remove('leave');
  }
}
teamBtn.addEventListener('click', async ()=>{
  if(team.on){ team.disconnect(); return; }
  const code=teamCodeIn.value.trim();
  const localTasks=tasks.slice();
  const localShared=sharedItems.slice();
  const hadLocal=localTasks.length>0;
  const hadShared=localShared.length>0;
  const ok=await team.connect(code);
  if(ok && hadLocal){
    // 参加時、この端末の既存タスクをチームへ投入するか
    if(confirm('この端末の予定 '+localTasks.length+' 件をチームにも共有しますか？')) team.push(localTasks);
  }
  if(ok && hadShared){
    if(confirm('この端末の共有ページ '+localShared.length+' 件をチームにも共有しますか？')) team.pushShared(localShared);
  }
});
$('#gear').addEventListener('click',()=>{ renderOpts(); renderTeam(); sheet.classList.add('on'); });
$('#sheetClose').addEventListener('click',()=>sheet.classList.remove('on'));
sheet.addEventListener('click',e=>{ if(e.target===sheet) sheet.classList.remove('on'); });
opts.addEventListener('click',e=>{
  const el=e.target.closest('.opt'); if(!el) return;
  const k=el.dataset.k, arr=settings.data.alarms, i=arr.indexOf(k);
  if(i>=0) arr.splice(i,1); else arr.push(k);
  settings.data.alarms=ALARMS.filter(a=>arr.includes(a.k)).map(a=>a.k); // 表示順を維持
  settings.save(); renderOpts();
});

/* ---------- カレンダー表示（週/月・別画面） ---------- */
const calState={mode:'month', cursor:new Date()};
function pad2(n){ return String(n).padStart(2,'0'); }
function hm(ts){ const d=new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function tasksByDay(){
  const map={};
  for(const t of tasks){ if(t.due==null||t.done) continue;
    const d=new Date(t.due); const k=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    (map[k]=map[k]||[]).push(t); }
  return map;
}
function renderCal(){
  const map=tasksByDay(), cur=calState.cursor;
  const td=new Date(); const todayK=`${td.getFullYear()}-${td.getMonth()}-${td.getDate()}`;
  if(calState.mode==='month'){
    $('#calTitle').textContent=`${cur.getFullYear()}年${cur.getMonth()+1}月`;
    const first=new Date(cur.getFullYear(),cur.getMonth(),1);
    const start=new Date(first); start.setDate(1-first.getDay());
    let html='<div class="calgrid">';
    for(const w of DOW) html+=`<div class="caldow">${w}</div>`;
    for(let i=0;i<42;i++){
      const d=new Date(start); d.setDate(start.getDate()+i);
      const inMonth=d.getMonth()===cur.getMonth();
      const k=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const items=(map[k]||[]).sort((a,b)=>a.due-b.due);
      html+=`<div class="calcell ${inMonth?'':'out'} ${k===todayK?'today':''}">
        <div class="caldnum">${d.getDate()}</div>
        ${items.slice(0,3).map(t=>`<div class="caltask">${esc(t.title)}</div>`).join('')}
        ${items.length>3?`<div class="calmore">+${items.length-3}</div>`:''}
      </div>`;
    }
    html+='</div>';
    $('#calBody').innerHTML=html;
  }else{
    const start=new Date(cur); start.setDate(cur.getDate()-cur.getDay()); start.setHours(0,0,0,0);
    const end=new Date(start); end.setDate(start.getDate()+6);
    $('#calTitle').textContent=`${start.getMonth()+1}/${start.getDate()} 〜 ${end.getMonth()+1}/${end.getDate()}`;
    let html='';
    for(let i=0;i<7;i++){
      const d=new Date(start); d.setDate(start.getDate()+i);
      const k=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const items=(map[k]||[]).sort((a,b)=>a.due-b.due);
      html+=`<div class="calweekday ${k===todayK?'today':''}">
        <div class="calwdhead">${d.getMonth()+1}/${d.getDate()}（${DOW[d.getDay()]}）</div>
        ${items.length?items.map(t=>`<div class="calwtask"><span>${hm(t.due)}</span>${esc(t.title)}</div>`).join(''):'<div class="calwempty">予定なし</div>'}
      </div>`;
    }
    $('#calBody').innerHTML=html;
  }
}
function openCal(){ calState.cursor=new Date(); renderCal(); $('#calView').classList.add('on'); }
function shiftCal(dir){ const c=calState.cursor;
  if(calState.mode==='month') c.setMonth(c.getMonth()+dir); else c.setDate(c.getDate()+7*dir);
  renderCal(); }
$('#openCal').addEventListener('click',openCal);
$('#calClose').addEventListener('click',()=>$('#calView').classList.remove('on'));
$('#calView').addEventListener('click',e=>{ if(e.target===$('#calView')) $('#calView').classList.remove('on'); });
$('#calPrev').addEventListener('click',()=>shiftCal(-1));
$('#calNext').addEventListener('click',()=>shiftCal(1));
document.querySelectorAll('.calmodebtn').forEach(b=>b.addEventListener('click',()=>{
  calState.mode=b.dataset.mode;
  document.querySelectorAll('.calmodebtn').forEach(x=>x.classList.toggle('on',x===b));
  renderCal();
}));

/* ---------- 起動 ---------- */
render();
renderShared();
setInterval(render,60000); // 1分ごとに期限判定を更新
// 前回チームに参加していれば自動再接続
if(settings.data.team && team.configured()){ team.connect(settings.data.team); }

/* オフライン対応・インストール要件：Service Worker（http(s)配信時のみ） */
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
