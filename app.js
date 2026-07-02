"use strict";
const $=s=>document.querySelector(s);
const uid=()=>Date.now()+''+Math.random().toString(36).slice(2,6);
const store={
  key:'coetask.v1',
  load(){ try{return JSON.parse(localStorage.getItem(this.key))||[]}catch(e){return[]} },
  save(v){ localStorage.setItem(this.key, JSON.stringify(v)); }
};
let tasks = store.load();      // 個人予定（端末内のみ・共有されない）
let teamTasks = [];            // 共有予定（Firestore・チームページ接続時のみ）
function allTasks(){ return team.on ? tasks.concat(teamTasks) : tasks; }

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
        || {alarms:['h1','m30','m10'], teams:[], page:0},
  save(){ localStorage.setItem(this.key, JSON.stringify(this.data)); }
};
if(!settings.data.alarms) settings.data.alarms=['h1','m30','m10'];
/* 旧「単一チーム」設定からの移行 */
if(!Array.isArray(settings.data.teams)){
  settings.data.teams = settings.data.team ? [{name:settings.data.team, code:settings.data.team}] : [];
  delete settings.data.team;
}
if(typeof settings.data.page!=='number') settings.data.page=0;

/* ==== チーム共有（Firebase Firestore・無料枠） ==== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCnUEahIa1b_kRzK3Anywj6mVntr0kZ4-U",
  authDomain: "coetask-1c803.firebaseapp.com",
  projectId: "coetask-1c803",
  storageBucket: "coetask-1c803.firebasestorage.app",
  messagingSenderId: "418960031713",
  appId: "1:418960031713:web:335357b9406a2d51315ca0"
};
const team={
  on:false, code:null, _db:null, _fs:null, _col:null, _unsub:null,
  configured(){ return !/^PASTE/.test(FIREBASE_CONFIG.apiKey); },
  async connect(code){
    code=(code||'').trim();
    if(!code){ toast('チームコードが未設定です'); return false; }
    if(!this.configured()){ toast('Firebase未設定（手順書STEPを実施）'); return false; }
    if(this.on && this.code===code) return true;
    try{
      const [appMod,fsMod]=await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
      ]);
      const app=appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
      this._db=this._db || fsMod.getFirestore(app);
      this._fs=fsMod;
      if(this._unsub){ this._unsub(); this._unsub=null; }
      this._col=fsMod.collection(this._db,'teams',code,'tasks');
      this._unsub=fsMod.onSnapshot(this._col,
        snap=>{ teamTasks=snap.docs.map(d=>Object.assign(d.data(),{shared:true})); render(); },
        err=>toast('同期エラー：'+(err.code||err.message)));
      this.on=true; this.code=code;
      return true;
    }catch(e){ toast('接続失敗：'+(e.message||e)); this.on=false; return false; }
  },
  save(t){ if(!this.on)return; this._fs.setDoc(this._fs.doc(this._col,t.id),JSON.parse(JSON.stringify(t))).catch(()=>toast('保存失敗')); },
  remove(id){ if(!this.on)return; this._fs.deleteDoc(this._fs.doc(this._col,id)).catch(()=>{}); },
  disconnect(){ if(this._unsub)this._unsub();
    this._unsub=null; this._col=null; this.on=false; this.code=null;
    teamTasks=[]; render(); }
};

/* ---------- チームページ（最大10・個人＋チーム別） ---------- */
let modeShared=false;   // 新規予定の既定：個人（チームページで👥に切替可）
function pages(){ return [{name:'個人',code:null}].concat(settings.data.teams); }
function currentPage(){ const ps=pages(); return ps[Math.min(settings.data.page||0,ps.length-1)]; }
async function setPage(i){
  const ps=pages(); if(i<0||i>=ps.length) return;
  settings.data.page=i; settings.save();
  if(!ps[i].code){ if(team.on) team.disconnect(); else render(); modeShared=false; }
  else{
    const ok=await team.connect(ps[i].code);
    if(!ok){ settings.data.page=0; settings.save(); if(team.on) team.disconnect(); }
  }
  renderPages(); render();
}
function renderPages(){
  const ps=pages();
  if((settings.data.page||0)>=ps.length){ settings.data.page=0; settings.save(); }
  const cur=settings.data.page||0;
  $('#pageName').textContent=ps[cur].name;
  $('#pages').innerHTML=ps.map((p,i)=>`<button class="pagechip ${i===cur?'on':''}" data-i="${i}">${esc(p.name)}</button>`).join('');
  const modeBtn=$('#modeBtn');
  modeBtn.style.display = cur>0 ? '' : 'none';
  modeBtn.textContent = modeShared?'👥':'👤';
  modeBtn.title = modeShared?'新規予定：共有（チームに同期）':'新規予定：個人（この端末のみ）';
}
$('#pages').addEventListener('click',e=>{
  const b=e.target.closest('.pagechip'); if(b) setPage(+b.dataset.i);
});
$('#modeBtn').addEventListener('click',()=>{
  if(!team.on){ toast('共有はチームページで使えます'); return; }
  modeShared=!modeShared; renderPages();
  toast(modeShared?'新規予定を「共有」で追加します':'新規予定を「個人」で追加します');
});
/* 左フリックで次ページ・右フリックで前ページ */
let _tx=null,_ty=null;
document.addEventListener('touchstart',e=>{ _tx=e.touches[0].clientX; _ty=e.touches[0].clientY; },{passive:true});
document.addEventListener('touchend',e=>{
  if(_tx==null) return;
  const dx=e.changedTouches[0].clientX-_tx, dy=e.changedTouches[0].clientY-_ty; _tx=_ty=null;
  if(document.querySelector('.sheet.on, .calview.on, .listening.on')) return;
  if(Math.abs(dx)<70 || Math.abs(dy)>50) return;
  const n=pages().length, cur=settings.data.page||0;
  const next=cur+(dx<0?1:-1);
  if(next>=0 && next<n) setPage(next);
},{passive:true});

/* データ層：共有予定はFirestore、個人予定はlocalStorage */
function persist(t){
  if(t.shared && team.on){ team.save(t); return; }   // 表示更新はonSnapshotに一元化
  t.shared=false;
  const i=tasks.findIndex(x=>x.id===t.id);
  if(i<0) tasks.push(t); else tasks[i]=t;
  store.save(tasks); render();
}
function removeTask(id){
  const t=allTasks().find(x=>x.id===id); if(!t) return;
  if(t.shared && team.on){ team.remove(id); return; }
  tasks=tasks.filter(x=>x.id!==id); store.save(tasks); render();
}
/* 個人⇔共有の切替（共有＝チームに同期・水色表示） */
function applyShareState(t,shared){
  if(shared===!!t.shared){ persist(t); return; }
  if(shared){
    if(!team.on){ toast('共有はチームページで使えます（⚙️でチーム追加）'); persist(t); return; }
    tasks=tasks.filter(x=>x.id!==t.id); store.save(tasks);
    t.shared=true; team.save(t); render();
  }else{
    if(team.on) team.remove(t.id);
    t.shared=false;
    const i=tasks.findIndex(x=>x.id===t.id);
    if(i<0) tasks.push(t); else tasks[i]=t;
    store.save(tasks); render();
  }
}

/* ---------- 日本語 日時パーサ ---------- */
const WD={'日':0,'月':1,'火':2,'水':3,'木':4,'金':5,'土':6};
const KANJI={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'半':30};
function toNum(s){
  if(s==null) return null;
  s=String(s).trim();
  if(/^\d+$/.test(s)) return parseInt(s,10);
  if(s==='半') return 30;
  if(s.includes('十')){
    const[a,b]=s.split('十');
    return (a?KANJI[a]||0:1)*10 + (b?KANJI[b]||0:0);
  }
  return KANJI[s]??null;
}
const SEP='(?:から|かけて|[〜～~ー－–—\\-−]|to)';
function rollDay(base, month, day, now){
  const d=new Date(base);
  if(month!=null) d.setMonth(month-1);
  d.setDate(day);
  if(d<now){ if(month!=null) d.setFullYear(d.getFullYear()+1); else d.setMonth(d.getMonth()+1); }
  return d;
}
function rollFrom(startD, month, day){
  const e=new Date(startD);
  if(month!=null) e.setMonth(month-1);
  e.setDate(day);
  if(e<startD) e.setMonth(e.getMonth()+1);
  return e;
}
function parse(raw){
  let t=(raw||'').replace(/[、。]/g,' ').normalize('NFKC').trim();
  const now=new Date();
  let due=null, dEnd=null, hasDate=false, hasTime=false, repeat=null;
  const consume=re=>{ const m=t.match(re); if(m){ t=t.replace(m[0],' '); } return m; };

  const base=new Date(now); base.setSeconds(0,0);
  let d=new Date(base);

  if(consume(/毎晩/)){ repeat='daily'; hasDate=true; d.setHours(20,0,0,0); hasTime=true; }
  else if(consume(/毎朝|毎日中|毎日/)){ repeat='daily'; hasDate=true; }
  else if(consume(/毎週間?/)){ repeat='weekly'; hasDate=true; }
  else if(consume(/毎月/)){ repeat='monthly'; hasDate=true; }

  let m=consume(/(\d+|[一二三四五六七八九十]+)\s*分後[にはで]?/);
  if(m){ d=new Date(now.getTime()+toNum(m[1])*60000); hasDate=hasTime=true; }
  m=consume(/(\d+|[一二三四五六七八九十]+)\s*時間後[にはで]?/);
  if(m){ d=new Date(now.getTime()+toNum(m[1])*3600000); hasDate=hasTime=true; }
  m=consume(/(\d+|[一二三四五六七八九十]+)\s*日後[にはで]?/);
  if(m){ d.setDate(d.getDate()+toNum(m[1])); hasDate=true; }

  let monthOff=null;
  if(consume(/来月/)) monthOff=1; else if(consume(/今月/)) monthOff=0;

  if(!hasDate){
    let mr=consume(new RegExp('(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日\\s*'+SEP+'+\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日'));
    if(mr){ d=rollDay(base,+mr[1],+mr[2],now); dEnd=rollFrom(d,+mr[3],+mr[4]); hasDate=true; }
    else{
      mr=consume(new RegExp('(\\d{1,2})\\s*日?\\s*'+SEP+'+\\s*(\\d{1,2})\\s*日(?:まで)?'));
      if(mr){
        const mo = monthOff!=null ? now.getMonth()+monthOff+1 : null;
        d=rollDay(base,mo,+mr[1],now); dEnd=rollFrom(d,mo,+mr[2]); hasDate=true;
      }
    }
  }

  if(!hasDate){
    if(consume(/(今日中|今日|本日|きょう)[にはまで]*/)){ hasDate=true; }
    else if(consume(/(明後日|あさって)[のにはで]?/)){ d.setDate(d.getDate()+2); hasDate=true; }
    else if(consume(/(明日|あした|あす)[のにはで]?/)){ d.setDate(d.getDate()+1); hasDate=true; }
    else if(consume(/(今夜|今晩)[にはで]?/)){ hasDate=true; d.setHours(20,0,0,0); hasTime=true; }
  }
  m=consume(/(来週)?\s*([日月火水木金土])曜日?/);
  if(!hasDate && m){
    const target=WD[m[2]]; let add=(target-d.getDay()+7)%7;
    if(add===0) add=7;
    if(m[1] && add<7) add+=7;
    d.setDate(d.getDate()+add); hasDate=true;
  }
  if(!hasDate){
    m=consume(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if(m){ d.setMonth(toNum(m[1])-1); d.setDate(toNum(m[2]));
           if(d<now && !hasTime) d.setFullYear(d.getFullYear()+1); hasDate=true; }
  }
  if(!hasDate){
    m=consume(/(\d{1,2})\s*日(?![後間])/);
    if(m){
      const day=toNum(m[1]);
      if(monthOff!=null){ d=new Date(base); d.setMonth(now.getMonth()+monthOff); d.setDate(day); }
      else d=rollDay(base,null,day,now);
      hasDate=true;
    }
  }

  let ampm=null;
  if(consume(/午後|ごご|夕方|夜/)) ampm='pm';
  else if(consume(/午前|ごぜん|朝/)) ampm='am';
  if(consume(/(正午|昼)[にはで]?/)){ d.setHours(12,0,0,0); hasTime=true; }

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

  if(hasTime && !hasDate) hasDate=true;
  if(hasDate){
    if(!hasTime) d.setHours(9,0,0,0);
    due=d;
    if(dEnd){ dEnd.setHours(d.getHours(), d.getMinutes(), 0, 0); }
  }
  let title=t.replace(/\s+/g,' ').trim();
  if(hasDate){
    title=title.split(' ').filter(w=>!/^(に|の|で|は|を|へ|まで|までに|から)$/.test(w)).join(' ')
               .replace(/^(に|の|で|は|を|へ|まで|までに|から)(?=\S)/,'').trim();
  }
  return { title: title||raw.trim(), due: due?due.getTime():null, dueEnd: dEnd?dEnd.getTime():null, repeat };
}

/* ---------- 表示 ---------- */
const DOW=['日','月','火','水','木','金','土'];
function pad2(n){ return String(n).padStart(2,'0'); }
function hm(ts){ const d=new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fmt(ts){
  const d=new Date(ts), n=new Date();
  const sameDay=d.toDateString()===n.toDateString();
  const tmr=new Date(n); tmr.setDate(n.getDate()+1);
  const isTmr=d.toDateString()===tmr.toDateString();
  let day = sameDay?'今日': isTmr?'明日':
            `${d.getMonth()+1}/${d.getDate()}(${DOW[d.getDay()]})`;
  return `${day} ${hm(ts)}`;
}
function dateOnly(ts){ const d=new Date(ts); return `${d.getMonth()+1}/${d.getDate()}(${DOW[d.getDay()]})`; }
function dayStart(ts){ const d=new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }

function render(){
  const now=Date.now(), todayStart=dayStart(now), tmrStart=todayStart+864e5;
  $('#todayLabel').textContent = fmt(now).split(' ')[0]+' の予定';

  const list=allTasks();
  const active=list.filter(t=>!t.done);
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
  $('#cDone').textContent=list.filter(t=>t.done).length;

  const done=list.filter(t=>t.done).sort((a,b)=>b.doneAt-a.doneAt).slice(0,20);
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
    : `<div class="empty">まだ予定はありません。<br>🎙️で話すか ✏️ で手入力してください。</div>`;
}
function row(t,now){
  const od=t.due!=null && t.due<now && !t.done;
  let when='';
  if(t.due!=null){
    const soon=!od && t.due<now+2*3600000;
    const range=t.dueEnd!=null ? ` 〜 ${dateOnly(t.dueEnd)}` : '';
    when=`<span class="when ${od?'od':soon?'soon':''}">🕑 ${fmt(t.due)}${range}${od?' ・超過':''}</span>`;
  }
  const url=safeUrl(t.url);
  const link=url?`<a class="tlink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">🔗リンク</a>`:'';
  const memo=t.memo?`<div class="memo">${esc(t.memo)}</div>`:'';
  const share=`<div class="cal" data-act="share" title="個人/共有の切替">${t.shared?'👥':'👤'}</div>`;
  const ics = t.due!=null ? `<div class="cal" data-act="ics" title="カレンダー登録(.ics)">📤</div>` : '';
  const repLabel = t.repeat==='monthly'?'毎月':t.repeat==='weekly'?'毎週':t.repeat==='daily'?'毎日':'';
  const rep = repLabel ? `<span class="rep">🔁${repLabel}</span>` : '';
  const monthly = t.due!=null ? `<div class="cal" data-act="monthly" title="毎月表示">${t.repeat==='monthly'?'🔁':'↻'}</div>` : '';
  return `<li class="${t.done?'done':''} ${od?'od':''} ${t.shared?'sh':''}" data-id="${t.id}">
    <div class="check" data-act="toggle">✓</div>
    <div class="body">
      <div class="ttl" data-act="edit" title="タップで編集">${esc(t.title)}</div>
      <div class="meta">${when||'<span>期限なし</span>'}${rep}${link}</div>
      ${memo}
    </div>
    ${share}
    ${monthly}
    ${ics}
    <div class="del" data-act="del">✕</div>
  </li>`;
}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function safeUrl(raw){
  const s=(raw||'').trim();
  if(!s) return '';
  try{
    const u=new URL(/^https?:\/\//i.test(s)?s:'https://'+s);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  }catch(e){ return ''; }
}

/* ---------- ✏️ 手入力・編集シート（日付/時間/件名/URL/メモ） ---------- */
let editing=null;   // null=新規
function toLocalDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function openNew(dateTs){
  editing=null;
  $('#editHead').textContent='✏️ 予定の入力';
  $('#eDate').value = dateTs!=null ? toLocalDate(new Date(dateTs)) : '';
  $('#eTime').value='';
  $('#eTitle').value=''; $('#eUrl').value=''; $('#eMemo').value='';
  $('#eShared').checked = team.on && modeShared;
  $('#eShared').disabled = !team.on;
  $('#eDel').style.display='none';
  $('#editSheet').classList.add('on');
  }
function openEdit(t){
  editing=t;
  $('#editHead').textContent='✏️ 予定の編集';
  if(t.due!=null){ const d=new Date(t.due); $('#eDate').value=toLocalDate(d); $('#eTime').value=`${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  else{ $('#eDate').value=''; $('#eTime').value=''; }
  $('#eTitle').value=t.title||'';
  $('#eUrl').value=t.url||'';
  $('#eMemo').value=t.memo||'';
  $('#eShared').checked=!!t.shared;
  $('#eShared').disabled = !team.on;
  $('#eDel').style.display='';
  $('#editSheet').classList.add('on');
}
function closeEdit(){ editing=null; $('#editSheet').classList.remove('on'); }
function saveEdit(){
  const title=$('#eTitle').value.trim();
  if(!title){ toast('件名を入力してください'); return; }
  const dv=$('#eDate').value, tv=$('#eTime').value;
  let due=null;
  if(dv){ due=new Date(dv+'T'+(tv||'09:00')).getTime(); }
  else if(tv){ const d=new Date(); const[h,mi]=tv.split(':'); d.setHours(+h,+mi,0,0); due=d.getTime(); }
  const wantShared=$('#eShared').checked && team.on;
  const url=$('#eUrl').value.trim(), memo=$('#eMemo').value.trim();
  if(editing){
    const t=editing;
    t.title=title; t.due=due; t.url=url; t.memo=memo;
    if(t.dueEnd!=null && (due==null || t.dueEnd<due)) t.dueEnd=null;
    applyShareState(t,wantShared);
    toast('保存しました');
  }else{
    const t={id:uid(), title, due, dueEnd:null, repeat:null, done:false, doneAt:null,
             createdAt:Date.now(), url, memo, shared:wantShared};
    persist(t);
    toast('追加：'+title+(wantShared?'（共有）':''));
  }
  closeEdit();
  if($('#calView').classList.contains('on')) renderCal();
}
$('#penBtn').addEventListener('click',()=>openNew());
$('#eSave').addEventListener('click',saveEdit);
$('#eClose').addEventListener('click',closeEdit);
$('#editSheet').addEventListener('click',e=>{ if(e.target===$('#editSheet')) closeEdit(); });
$('#eDel').addEventListener('click',()=>{
  if(!editing) return;
  removeTask(editing.id); closeEdit();
  if($('#calView').classList.contains('on')) renderCal();
  toast('削除しました');
});
/* シート内の🎙️：件名＋日時を音声で入力（手入力・ボイスどちらでも可） */
$('#eMic').addEventListener('click',()=>{
  if(!SR){ toast('この端末は音声入力に非対応です'); return; }
  const btn=$('#eMic'); const r=new SR();
  r.lang='ja-JP'; r.interimResults=true; r.maxAlternatives=1; r.continuous=true;
  let finalText='', sTimer=null;
  const arm=()=>{ clearTimeout(sTimer); sTimer=setTimeout(()=>{ try{r.stop()}catch(e){} },5000); };
  r.onstart=()=>{ btn.classList.add('rec'); toast('お話しください…（件名・日時）'); arm(); };
  r.onspeechstart=arm;
  r.onresult=e=>{ for(let i=e.resultIndex;i<e.results.length;i++){ const x=e.results[i];
    if(x.isFinal) finalText+=x[0].transcript; } arm(); };
  r.onerror=e=>{ toast('音声エラー：'+e.error); };
  r.onend=()=>{ clearTimeout(sTimer); btn.classList.remove('rec');
    const txt=finalText.trim(); if(!txt) return;
    const p=parse(txt);
    $('#eTitle').value=p.title||txt;
    if(p.due!=null){ const d=new Date(p.due); $('#eDate').value=toLocalDate(d); $('#eTime').value=`${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
    toast('音声を反映しました（内容を確認して保存）'); };
  try{ r.start(); }catch(e){}
});

/* ---------- タスク一覧の操作 ---------- */
function addTask(text){
  const p=parse(text);
  if(!p.title) return;
  const task={id:uid(), title:p.title, due:p.due, dueEnd:p.dueEnd||null, repeat:p.repeat||null,
              done:false, doneAt:null, createdAt:Date.now(), url:'', memo:'', shared:team.on&&modeShared};
  persist(task);
  const rp=p.repeat==='monthly'?'（毎月）':p.repeat==='daily'?'（毎日）':p.repeat==='weekly'?'（毎週）':'';
  const sh=task.shared?'（共有）':'';
  const whenTxt=p.due? (p.dueEnd? `${fmt(p.due)}〜${dateOnly(p.dueEnd)}` : fmt(p.due)) : '';
  toast(whenTxt? `追加：${p.title}${rp}${sh}（${whenTxt}）` : `追加：${p.title}${rp}${sh}`);
}
$('#list').addEventListener('click',e=>{
  if(e.target.closest('a')) return;   // URLリンクは通常遷移
  const li=e.target.closest('li'); if(!li) return;
  const id=li.dataset.id, act=e.target.dataset.act;
  const t=allTasks().find(x=>x.id===id); if(!t) return;
  if(act==='edit'){ openEdit(t); return; }
  if(act==='ics'){ exportICS(t); return; }
  if(act==='del'){ removeTask(id); return; }
  if(act==='share'){ applyShareState(t,!t.shared); return; }
  if(act==='monthly'){
    t.repeat = t.repeat==='monthly' ? null : 'monthly';
    persist(t); toast(t.repeat==='monthly'?'毎月表示にしました':'毎月表示を解除しました'); return;
  }
  if(act==='toggle'){
    if(t.repeat && !t.done){
      const d=new Date(t.due);
      if(t.repeat==='monthly') d.setMonth(d.getMonth()+1);
      else if(t.repeat==='weekly') d.setDate(d.getDate()+7); else d.setDate(d.getDate()+1);
      t.due=d.getTime(); persist(t); toast(`完了 → 次回：${fmt(t.due)}`); return;
    }
    t.done=!t.done; t.doneAt=t.done?Date.now():null; persist(t);
  }
});

/* ---------- iOS純正カレンダー連携（.ics 書き出し／取り込み） ---------- */
function icsDate(ts){ const d=new Date(ts);
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`; }
function icsDay(ts){ const d=new Date(ts);
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`; }
function icsEsc(s){ return String(s).replace(/[\\;,]/g,m=>'\\'+m).replace(/\n/g,'\\n'); }
const DUR={w1:'-P1W',d3:'-P3D',d1:'-P1D',h1:'-PT1H',m30:'-PT30M',m10:'-PT10M'};
function alarmLines(t){
  const out=[]; const desc=icsEsc(t.title);
  for(const k of settings.data.alarms){
    let trig;
    if(k==='morning'){
      const m=new Date(t.due); m.setHours(9,0,0,0);
      if(m.getTime()>=t.due) continue;
      trig=`TRIGGER;VALUE=DATE-TIME:${icsDate(m.getTime())}`;
    } else if(DUR[k]) trig=`TRIGGER:${DUR[k]}`; else continue;
    out.push('BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${desc}`,trig,'END:VALARM');
  }
  return out;
}
function eventLines(t){
  const rrule = t.repeat==='daily' ? ['RRULE:FREQ=DAILY']
    : t.repeat==='weekly' ? [`RRULE:FREQ=WEEKLY;BYDAY=${['SU','MO','TU','WE','TH','FR','SA'][new Date(t.due).getDay()]}`]
    : t.repeat==='monthly' ? ['RRULE:FREQ=MONTHLY']
    : [];
  const dt = t.dueEnd!=null
    ? [`DTSTART;VALUE=DATE:${icsDay(t.due)}`,`DTEND;VALUE=DATE:${icsDay(t.dueEnd+864e5)}`]
    : [`DTSTART:${icsDate(t.due)}`,`DTEND:${icsDate(t.due+30*60000)}`];
  const alarms = t.dueEnd!=null ? [] : alarmLines(t);
  return ['BEGIN:VEVENT',`UID:${t.id}@coetask`,`DTSTAMP:${icsDate(Date.now())}`,
    ...dt,...rrule,`SUMMARY:${icsEsc(t.title)}`,
    ...(t.url?[`URL:${icsEsc(t.url)}`]:[]),
    ...(t.memo?[`DESCRIPTION:${icsEsc(t.memo)}`]:[]),
    ...alarms,'END:VEVENT'];
}
function downloadBlob(content,type,name){
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
}
function icsWrap(lines){
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//coetask//JP','CALSCALE:GREGORIAN','METHOD:PUBLISH',
    ...lines,'END:VCALENDAR'].join('\r\n');
}
function exportICS(t){
  if(t.due==null){ toast('期限のあるタスクのみ登録できます'); return; }
  downloadBlob(icsWrap(eventLines(t)),'text/calendar;charset=utf-8',
    (t.title||'task').replace(/[\\/:*?"<>|]/g,'_')+'.ics');
  const names=settings.data.alarms.map(k=>(ALARMS.find(a=>a.k===k)||{}).label).filter(Boolean).join('/');
  toast('カレンダーに登録'+(names?`（${names}に通知）`:''));
}
function exportAllICS(){
  const list=allTasks().filter(t=>t.due!=null && !t.done);
  if(!list.length){ toast('書き出せる予定がありません'); return; }
  downloadBlob(icsWrap(list.flatMap(eventLines)),'text/calendar;charset=utf-8','coetask-all.ics');
  toast(list.length+'件の予定を書き出しました（カレンダーに追加してください）');
}
function importICSText(txt){
  const unesc=s=>s.replace(/\\n/gi,' ').replace(/\\([\\;,])/g,'$1').trim();
  const body=txt.replace(/\r/g,'').replace(/\n[ \t]/g,'');   // 行折返しを結合
  const events=body.split('BEGIN:VEVENT').slice(1);
  let n=0;
  for(const ev of events){
    const g=re=>{ const m=ev.match(re); return m?m[1].trim():''; };
    const sum=g(/\nSUMMARY[^:\n]*:(.+)/);
    const ds=g(/\nDTSTART[^:\n]*:(.+)/);
    if(!sum||!ds) continue;
    const m=ds.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if(!m) continue;
    const due=new Date(+m[1],+m[2]-1,+m[3], m[4]!=null?+m[4]:9, m[5]!=null?+m[5]:0).getTime();
    const title=unesc(sum);
    if(allTasks().some(x=>x.title===title && x.due===due)) continue;   // 重複スキップ
    tasks.push({id:uid(), title, due, dueEnd:null, repeat:null, done:false, doneAt:null,
      createdAt:Date.now(), url:unesc(g(/\nURL[^:\n]*:(.+)/)), memo:unesc(g(/\nDESCRIPTION[^:\n]*:(.+)/)), shared:false});
    n++;
  }
  store.save(tasks); render();
  toast(n? n+'件をカレンダーから取り込みました':'新しい予定はありませんでした');
}
$('#icsAllBtn').addEventListener('click',exportAllICS);
$('#icsImportBtn').addEventListener('click',()=>$('#icsFile').click());
$('#icsFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>importICSText(String(rd.result));
  rd.readAsText(f); e.target.value='';
});

/* ---------- CSV インポート／エクスポート（Windows版のみ表示） ---------- */
const IS_WIN=/Win/.test((navigator.userAgentData&&navigator.userAgentData.platform)||navigator.platform||'');
function csvEsc(v){ v=String(v??''); return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }
function exportCSV(){
  const rows=[['日付','時間','件名','url','メモ欄']];
  for(const t of allTasks()){
    const d=t.due!=null?new Date(t.due):null;
    rows.push([d?`${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())}`:'',
               d?hm(t.due):'', t.title, t.url||'', t.memo||'']);
  }
  downloadBlob('﻿'+rows.map(r=>r.map(csvEsc).join(',')).join('\r\n'),
    'text/csv;charset=utf-8','coetask.csv');
  toast((rows.length-1)+'件をエクスポートしました');
}
function parseCSV(text){
  const rows=[]; let row=[], cur='', q=false;
  text=text.replace(/^﻿/,'');
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else if(c==='"') q=true;
    else if(c===','){ row.push(cur); cur=''; }
    else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i+1]==='\n')i++; row.push(cur); rows.push(row); row=[]; cur=''; }
    else cur+=c;
  }
  if(cur!==''||row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r=>r.some(c=>c.trim()!==''));
}
function importCSVText(text){
  const rows=parseCSV(text);
  if(!rows.length){ toast('CSVが空です'); return; }
  const head=rows[0].map(h=>h.trim().toLowerCase());
  const idx=names=>head.findIndex(h=>names.some(n=>h===n||h.includes(n)));
  const iD=idx(['日付']), iT=idx(['時間','時刻']), iS=idx(['件名','タイトル']), iU=idx(['url']), iM=idx(['メモ欄','メモ']);
  if(iS<0){ toast('ヘッダー行（日付,時間,件名,url,メモ欄）が見つかりません'); return; }
  let n=0;
  for(const r of rows.slice(1)){
    const title=(r[iS]||'').trim(); if(!title) continue;
    let due=null;
    const ds=(iD>=0?r[iD]||'':'').trim(), ts=(iT>=0?r[iT]||'':'').trim();
    const dm=ds.match(/^(?:(\d{4})[\/\-年])?(\d{1,2})[\/\-月](\d{1,2})日?$/);
    if(dm){
      let h=9, mi=0;
      const tm=ts.match(/^(\d{1,2})[:時](\d{1,2})?/);
      if(tm){ h=+tm[1]; mi=tm[2]!=null?+tm[2]:0; }
      due=new Date(dm[1]?+dm[1]:new Date().getFullYear(), +dm[2]-1, +dm[3], h, mi).getTime();
    }
    tasks.push({id:uid(), title, due, dueEnd:null, repeat:null, done:false, doneAt:null,
      createdAt:Date.now(), url:(iU>=0?r[iU]||'':'').trim(), memo:(iM>=0?r[iM]||'':'').trim(), shared:false});
    n++;
  }
  store.save(tasks); render();
  toast(n+'件をインポートしました');
}
$('#csvBtn').addEventListener('click',()=>$('#csvSheet').classList.add('on'));
$('#csvClose').addEventListener('click',()=>$('#csvSheet').classList.remove('on'));
$('#csvSheet').addEventListener('click',e=>{ if(e.target===$('#csvSheet')) $('#csvSheet').classList.remove('on'); });
$('#csvExportBtn').addEventListener('click',()=>{ exportCSV(); $('#csvSheet').classList.remove('on'); });
$('#csvImportBtn').addEventListener('click',()=>$('#csvFile').click());
$('#csvFile').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{                                  // UTF-8→失敗時はShift_JIS（Excel既定）
    let text;
    try{ text=new TextDecoder('utf-8',{fatal:true}).decode(rd.result); }
    catch(_){ try{ text=new TextDecoder('shift_jis').decode(rd.result); }catch(e2){ text=new TextDecoder().decode(rd.result); } }
    importCSVText(text);
    $('#csvSheet').classList.remove('on');
  };
  rd.readAsArrayBuffer(f); e.target.value='';
});
if(IS_WIN) $('#csvBtn').style.display='';

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
  if(!SR){ toast('この端末は音声入力に非対応です。✏️の手入力をご利用ください'); return; }
  if(recording){ stopRec(); return; }
  rec=new SR(); rec.lang='ja-JP'; rec.interimResults=true; rec.maxAlternatives=1; rec.continuous=true;
  let finalText='';
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
    armSilence();
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

/* ---------- 設定シート（チームページ管理・通知） ---------- */
const sheet=$('#sheet'), opts=$('#opts');
function renderOpts(){
  opts.innerHTML=ALARMS.map(a=>{
    const on=settings.data.alarms.includes(a.k);
    return `<div class="opt ${on?'on':''}" data-k="${a.k}"><div class="sw"></div><div>${a.label}</div></div>`;
  }).join('');
}
function renderTeamMgmt(){
  const st=$('#teamStatus');
  if(team.on){ st.textContent='🟢 チーム「'+currentPage().name+'」に接続中（共有予定を同期）'; st.classList.add('live'); }
  else{
    st.textContent = team.configured()? '個人ページ表示中（この端末のみ）'
      : '個人モード（共有にはFirebase設定が必要）';
    st.classList.remove('live');
  }
  const ts=settings.data.teams;
  $('#teamList').innerHTML = ts.map((t,i)=>
    `<div class="teamrow"><b>${esc(t.name)}</b><span>${esc(t.code)}</span><button class="tdel" data-i="${i}">削除</button></div>`).join('');
}
$('#teamAdd').addEventListener('click',()=>{
  const name=$('#teamName').value.trim(), code=$('#teamCode').value.trim();
  if(!name||!code){ toast('チーム名とチームコードを入力してください'); return; }
  if(settings.data.teams.length>=10){ toast('チームページは最大10個までです'); return; }
  if(settings.data.teams.some(t=>t.code===code)){ toast('同じチームコードが登録済みです'); return; }
  settings.data.teams.push({name,code}); settings.save();
  $('#teamName').value=''; $('#teamCode').value='';
  renderTeamMgmt(); renderPages();
  toast('チームページ「'+name+'」を追加しました');
});
$('#teamList').addEventListener('click',e=>{
  const btn=e.target.closest('.tdel'); if(!btn) return;
  const i=+btn.dataset.i, t=settings.data.teams[i]; if(!t) return;
  if(!confirm('チームページ「'+t.name+'」を削除しますか？（チーム上のデータは消えません）')) return;
  settings.data.teams.splice(i,1); settings.save();
  if((settings.data.page||0)===i+1){ setPage(0); }
  else if((settings.data.page||0)>i+1){ settings.data.page--; settings.save(); }
  renderTeamMgmt(); renderPages();
});
$('#gear').addEventListener('click',()=>{ renderOpts(); renderTeamMgmt(); sheet.classList.add('on'); });
$('#sheetClose').addEventListener('click',()=>sheet.classList.remove('on'));
sheet.addEventListener('click',e=>{ if(e.target===sheet) sheet.classList.remove('on'); });
opts.addEventListener('click',e=>{
  const el=e.target.closest('.opt'); if(!el) return;
  const k=el.dataset.k, arr=settings.data.alarms, i=arr.indexOf(k);
  if(i>=0) arr.splice(i,1); else arr.push(k);
  settings.data.alarms=ALARMS.filter(a=>arr.includes(a.k)).map(a=>a.k);
  settings.save(); renderOpts();
});

/* ---------- カレンダー表示（月/週/日・別画面） ---------- */
const calState={mode:'month', cursor:new Date()};
function tasksByDay(){
  const map={};
  for(const t of allTasks()){ if(t.due==null||t.done) continue;
    const s=new Date(t.due); s.setHours(0,0,0,0);
    const e=t.dueEnd!=null?new Date(t.dueEnd):new Date(t.due); e.setHours(0,0,0,0);
    let n=0;
    for(let d=new Date(s); d<=e && n<367; d.setDate(d.getDate()+1), n++){
      const k=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      (map[k]=map[k]||[]).push(t);
    }
  }
  return map;
}
function syncModeBtns(){
  document.querySelectorAll('.calmodebtn').forEach(x=>x.classList.toggle('on',x.dataset.mode===calState.mode));
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
      html+=`<div class="calcell ${inMonth?'':'out'} ${k===todayK?'today':''}" data-date="${d.getTime()}">
        <div class="caldnum">${d.getDate()}</div>
        ${items.slice(0,3).map(t=>`<div class="caltask${t.shared?' sh':''}">${esc(t.title)}</div>`).join('')}
        ${items.length>3?`<div class="calmore">+${items.length-3}</div>`:''}
      </div>`;
    }
    html+='</div>';
    $('#calBody').innerHTML=html;
  }else if(calState.mode==='week'){
    const start=new Date(cur); start.setDate(cur.getDate()-cur.getDay()); start.setHours(0,0,0,0);
    const end=new Date(start); end.setDate(start.getDate()+6);
    $('#calTitle').textContent=`${start.getMonth()+1}/${start.getDate()} 〜 ${end.getMonth()+1}/${end.getDate()}`;
    let html='';
    for(let i=0;i<7;i++){
      const d=new Date(start); d.setDate(start.getDate()+i);
      const k=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const items=(map[k]||[]).sort((a,b)=>a.due-b.due);
      html+=`<div class="calweekday ${k===todayK?'today':''}" data-date="${d.getTime()}">
        <div class="calwdhead">${d.getMonth()+1}/${d.getDate()}（${DOW[d.getDay()]}）</div>
        ${items.length?items.map(t=>`<div class="calwtask${t.shared?' sh':''}" data-id="${t.id}"><span>${hm(t.due)}</span>${esc(t.title)}</div>`).join(''):'<div class="calwempty">予定なし</div>'}
      </div>`;
    }
    $('#calBody').innerHTML=html;
  }else{
    /* 日ビュー：30分区切り・9:00基準表示。タスクタップで編集（音声/手入力） */
    $('#calTitle').textContent=`${cur.getMonth()+1}月${cur.getDate()}日（${DOW[cur.getDay()]}）`;
    const k=`${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`;
    const items=(map[k]||[]).sort((a,b)=>a.due-b.due);
    let html='<div class="dayslots">';
    for(let s=0;s<48;s++){
      const h=Math.floor(s/2), mi=(s%2)*30;
      const slotItems=items.filter(t=>{
        const d=new Date(t.due);
        return d.getHours()===h && d.getMinutes()>=mi && d.getMinutes()<mi+30;
      });
      html+=`<div class="dayrow${h===9&&mi===0?' base':''}" data-slot="${s}">
        <div class="daytime">${pad2(h)}:${pad2(mi)}</div>
        <div class="daytasks">${slotItems.map(t=>`<div class="daytask${t.shared?' sh':''}" data-id="${t.id}">${esc(t.title)}${t.memo?`<small> ${esc(t.memo.split(/\r?\n/)[0])}</small>`:''}</div>`).join('')}</div>
      </div>`;
    }
    html+='</div>';
    $('#calBody').innerHTML=html;
    requestAnimationFrame(()=>{ const el=$('#calBody [data-slot="18"]'); if(el) el.scrollIntoView({block:'start'}); });
  }
}
function openCal(){ calState.mode='month'; calState.cursor=new Date(); syncModeBtns(); renderCal(); $('#calView').classList.add('on'); }
function shiftCal(dir){ const c=calState.cursor;
  if(calState.mode==='month') c.setMonth(c.getMonth()+dir);
  else if(calState.mode==='week') c.setDate(c.getDate()+7*dir);
  else c.setDate(c.getDate()+dir);
  renderCal(); }
$('#openCal').addEventListener('click',openCal);
$('#calClose').addEventListener('click',()=>$('#calView').classList.remove('on'));
$('#calView').addEventListener('click',e=>{ if(e.target===$('#calView')) $('#calView').classList.remove('on'); });
$('#calPrev').addEventListener('click',()=>shiftCal(-1));
$('#calNext').addEventListener('click',()=>shiftCal(1));
document.querySelectorAll('.calmodebtn').forEach(b=>b.addEventListener('click',()=>{
  calState.mode=b.dataset.mode;
  syncModeBtns();
  renderCal();
}));
/* 日付タップ→日ビュー、タスクタップ→編集シート */
$('#calBody').addEventListener('click',e=>{
  const taskEl=e.target.closest('.daytask,.calwtask');
  if(taskEl && taskEl.dataset.id){
    const t=allTasks().find(x=>x.id===taskEl.dataset.id);
    if(t){ openEdit(t); return; }
  }
  const cell=e.target.closest('[data-date]');
  if(cell){
    calState.mode='day'; calState.cursor=new Date(+cell.dataset.date);
    syncModeBtns(); renderCal();
  }
});

/* ---------- 起動 ---------- */
renderPages();
render();
setInterval(render,60000);
/* 前回表示していたチームページへ自動再接続 */
if((settings.data.page||0)>0) setPage(settings.data.page);

/* オフライン対応・インストール要件：Service Worker（http(s)配信時のみ） */
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
