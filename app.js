const CFG = window.CXTRIP_CONFIG || {};
const configured = Boolean(CFG.supabaseUrl && CFG.supabaseKey);
let supabase = null;
if (configured) {
  const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabase = mod.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
}

const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const PLN = new Intl.NumberFormat('pl-PL',{style:'currency',currency:'PLN'});
const DMY = new Intl.DateTimeFormat('pl-PL',{day:'2-digit',month:'2-digit',year:'numeric'});
const MONTH = new Intl.DateTimeFormat('pl-PL',{month:'long',year:'numeric'});
const state = {
  user: null, team: null, members: [], races: [], participants: [], tasks: [], expenses: [], shares: [], vehicles: [], packing: [],
  view: 'dashboard', selectedRaceId: null, detailTab: 'overview', search: '', raceFilter: 'nadchodzace',
  taskFilter: 'open', taskMemberFilter: 'all', calDate: new Date(), loading: true, authMode: 'signin', realtime: null, demo: !configured
};

function uid(){ return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now(); }
function esc(v=''){ return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function attr(v=''){ return esc(v).replace(/`/g,'&#96;'); }
function toast(msg, error=false){ toastEl.textContent=msg; toastEl.className='toast show'+(error?' error':''); clearTimeout(window.__t); window.__t=setTimeout(()=>toastEl.className='toast',2600); }
function dateObj(v){ if(!v)return null; const [y,m,d]=String(v).slice(0,10).split('-').map(Number); return new Date(y,m-1,d); }
function isoDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtDate(v){ const d=dateObj(v); return d?DMY.format(d):'—'; }
function memberName(id){ return state.members.find(m=>m.user_id===id)?.display_name || 'Nieznany'; }
function memberInitials(id){ return memberName(id).split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(); }
function selectedRace(){ return state.races.find(r=>r.id===state.selectedRaceId); }
function raceParts(rid){ return state.participants.filter(p=>p.race_id===rid); }
function raceTasks(rid){ return state.tasks.filter(x=>x.race_id===rid); }
function teamTasks(){ return state.tasks.filter(x=>x.team_id===state.team?.id || (!x.team_id && x.race_id)); }
function taskPriorityLabel(p){ return ({high:'Pilne',normal:'Normalne',low:'Niskie'})[p]||'Normalne'; }
function taskPriorityBadge(p){ const c=p==='high'?'danger':p==='low'?'info':''; return `<span class="badge ${c}">${p==='high'?'! ':''}${taskPriorityLabel(p)}</span>`; }
function taskRaceName(t){ return t.race_id ? (state.races.find(r=>r.id===t.race_id)?.name || 'Wyścig') : 'Ogólne'; }
function isTaskOverdue(t){ return !t.done && t.due_date && dateObj(t.due_date) < nowDay(); }
function raceExpenses(rid){ return state.expenses.filter(x=>x.race_id===rid); }
function raceVehicles(rid){ return state.vehicles.filter(x=>x.race_id===rid); }
function racePacking(rid){ return state.packing.filter(x=>x.race_id===rid); }
function raceShareRows(rid){ const ids=new Set(raceExpenses(rid).map(e=>e.id)); return state.shares.filter(s=>ids.has(s.expense_id)); }
function nowDay(){ const d=new Date(); d.setHours(0,0,0,0); return d; }
function isUpcoming(r){ const e=dateObj(r.end_date||r.race_date); return e && e>=nowDay() && r.status!=='odwolany'; }
function daysUntil(v){ const d=dateObj(v); if(!d)return 0; return Math.ceil((d-nowDay())/86400000); }
function raceStatusBadge(r){
  if(r.status==='odwolany') return '<span class="badge danger">⛔ odwołany</span>';
  if(r.status==='zakonczony') return '<span class="badge">✓ zakończony</span>';
  if(r.status==='potwierdzony') return '<span class="badge ok">✓ potwierdzony</span>';
  return '<span class="badge info">● planowany</span>';
}
function hotelBadge(r){
  const map={brak:['danger','🏨 brak hotelu'],szukamy:['warn','🔎 szukamy hotelu'],zarezerwowany:['ok','🏨 zarezerwowany'],oplacony:['ok','✓ hotel opłacony']};
  const [c,t]=map[r.hotel_status]||map.brak; return `<span class="badge ${c}">${t}</span>`;
}
function partStatusLabel(s){ return ({jedzie:'Jedzie',moze:'Może',nie_jedzie:'Nie jedzie',nieustalone:'Nieustalone'})[s]||s; }
function taskProgress(rid){ const a=raceTasks(rid); if(!a.length)return 0; return Math.round(a.filter(x=>x.done).length/a.length*100); }
function participantCount(rid){ return raceParts(rid).filter(p=>p.status==='jedzie').length; }
function upcomingRaces(){ return [...state.races].filter(isUpcoming).sort((a,b)=>String(a.race_date).localeCompare(String(b.race_date))); }
function totalExpenses(rid=null){ return (rid?raceExpenses(rid):state.expenses).reduce((s,e)=>s+Number(e.amount||0),0); }
function saveDemo(){ if(state.demo){ localStorage.setItem('cxtrip_demo_v2',JSON.stringify({team:state.team,members:state.members,races:state.races,participants:state.participants,tasks:state.tasks,expenses:state.expenses,shares:state.shares,vehicles:state.vehicles,packing:state.packing})); } }
function saveSnapshot(){ try{ localStorage.setItem('cxtrip_snapshot',JSON.stringify({team:state.team,members:state.members,races:state.races,participants:state.participants,tasks:state.tasks,expenses:state.expenses,shares:state.shares,vehicles:state.vehicles,packing:state.packing,ts:Date.now()})); }catch{} }

function seedDemo(){
  const stored=localStorage.getItem('cxtrip_demo_v2'); if(stored){ Object.assign(state,JSON.parse(stored)); const demoMe=state.members.find(m=>m.display_name==='Dawid')||state.members[0]; state.user={id:demoMe.user_id,email:'demo@cxtrip.local',user_metadata:{display_name:demoMe.display_name}}; return; }
  const me='u1',u2='u2',u3='u3',u4='u4',u5='u5',tid='t1';
  const d=new Date(); const d1=new Date(d); d1.setDate(d.getDate()+6); const d2=new Date(d); d2.setDate(d.getDate()+13);
  state.user={id:me,email:'demo@cxtrip.local',user_metadata:{display_name:'Dawid'}};
  state.team={id:tid,name:'Victoria CX',invite_code:'CX2026'};
  state.members=[
    {id:uid(),team_id:tid,user_id:u4,display_name:'Eduard',role:'member'}, {id:uid(),team_id:tid,user_id:u2,display_name:'Kuba',role:'member'},
    {id:uid(),team_id:tid,user_id:me,display_name:'Dawid',role:'admin'}, {id:uid(),team_id:tid,user_id:u3,display_name:'Bartek',role:'member'},
    {id:uid(),team_id:tid,user_id:u5,display_name:'Donata',role:'member'}
  ];
  const r1='r1',r2='r2';
  state.races=[
    {id:r1,team_id:tid,name:'Puchar Polski CX — Szczekociny',race_date:isoDate(d1),end_date:isoDate(d1),start_time:'11:40',city:'Szczekociny',race_address:'Szczekociny',category:'Junior',status:'potwierdzony',hotel_status:'zarezerwowany',hotel_name:'Hotel Demo',hotel_address:'Centrum, Szczekociny',hotel_rooms:'2×2 osoby + 1×1',hotel_price:640,hotel_notes:'Śniadanie od 6:30. Parking z tyłu hotelu.',race_notes:'Biuro zawodów od 8:00. Wziąć drugi komplet kół.',transport_notes:'Wyjazd rano, dokładna godzina do ustalenia.'},
    {id:r2,team_id:tid,name:'Bryksy Cross',race_date:isoDate(d2),end_date:isoDate(d2),start_time:'12:10',city:'Gościęcin',race_address:'Gościęcin',category:'Junior',status:'planowany',hotel_status:'szukamy',hotel_name:'',hotel_address:'',hotel_rooms:'',hotel_price:null,hotel_notes:'',race_notes:'Czekamy na harmonogram.',transport_notes:''}
  ];
  state.participants=state.members.flatMap((m,i)=>[
    {id:uid(),race_id:r1,user_id:m.user_id,status:i<4?'jedzie':'moze'},
    {id:uid(),race_id:r2,user_id:m.user_id,status:i<2?'jedzie':'nieustalone'}
  ]);
  state.tasks=[
    {id:'ta1',team_id:tid,race_id:r1,title:'Potwierdzić hotel',note:'Zadzwonić i potwierdzić późny przyjazd.',assigned_to:me,created_by:u5,due_date:isoDate(d1),priority:'high',done:true},
    {id:'ta2',team_id:tid,race_id:r1,title:'Sprawdzić godziny startów',note:'Jak tylko pojawi się oficjalny harmonogram.',assigned_to:u2,created_by:me,due_date:isoDate(d1),priority:'normal',done:false},
    {id:'ta3',team_id:tid,race_id:r2,title:'Znaleźć nocleg',note:'Najlepiej do 15 km od trasy.',assigned_to:u3,created_by:u4,due_date:isoDate(d2),priority:'high',done:false},
    {id:'ta4',team_id:tid,race_id:null,title:'Sprawdzić zapas opasek zaciskowych',note:'Do skrzynki serwisowej.',assigned_to:u4,created_by:me,due_date:isoDate(d1),priority:'low',done:false},
    {id:'ta5',team_id:tid,race_id:null,title:'Przygotować listę zakupów na wyjazd',note:'Woda, jedzenie, ręczniki papierowe.',assigned_to:u5,created_by:u2,due_date:isoDate(d1),priority:'normal',done:false}
  ];
  state.expenses=[{id:'e1',race_id:r1,payer_id:me,description:'Hotel',category:'hotel',amount:640,paid_at:isoDate(d)}];
  state.shares=state.members.slice(0,4).map(m=>({id:uid(),expense_id:'e1',user_id:m.user_id,share_amount:160}));
  state.vehicles=[{id:'v1',race_id:r1,driver_id:me,name:'Audi A4',seats:5,departure_time:`${isoDate(d1)}T06:30:00`,departure_place:'Jarocin',notes:'Bagażnik na 4 rowery'}];
  state.packing=[{id:uid(),race_id:r1,name:'Myjka',owner_id:u2,qty:1,done:false},{id:uid(),race_id:r1,name:'Zapasowe koła',owner_id:me,qty:2,done:true}];
  saveDemo();
}

async function loadRealData(){
  const {data:memberRows,error:merr}=await supabase.from('team_members').select('*').order('created_at');
  if(merr) throw merr;
  if(!memberRows?.length){ state.team=null; state.members=[]; return; }
  const membership=memberRows[0];
  const {data:team,error:terr}=await supabase.from('teams').select('*').eq('id',membership.team_id).single(); if(terr)throw terr;
  const teamId=team.id;
  const {data:members}=await supabase.from('team_members').select('*').eq('team_id',teamId).order('created_at');
  const {data:races,error:rerr}=await supabase.from('races').select('*').eq('team_id',teamId).order('race_date'); if(rerr)throw rerr;
  const raceIds=(races||[]).map(r=>r.id);
  let participants=[],tasks=[],expenses=[],shares=[],vehicles=[],packing=[];
  const tq=await supabase.from('tasks').select('*').eq('team_id',teamId).order('done').order('due_date',{ascending:true,nullsFirst:false}).order('created_at',{ascending:false});
  tasks=tq.data||[];
  if(raceIds.length){
    const [p,e,v,pk]=await Promise.all([
      supabase.from('race_participants').select('*').in('race_id',raceIds),
      supabase.from('expenses').select('*').in('race_id',raceIds), supabase.from('race_vehicles').select('*').in('race_id',raceIds),
      supabase.from('packing_items').select('*').in('race_id',raceIds)
    ]);
    participants=p.data||[]; expenses=e.data||[]; vehicles=v.data||[]; packing=pk.data||[];
    const expenseIds=expenses.map(x=>x.id); if(expenseIds.length){ const s=await supabase.from('expense_shares').select('*').in('expense_id',expenseIds); shares=s.data||[]; }
  }
  Object.assign(state,{team,members:members||[],races:races||[],participants,tasks,expenses,shares,vehicles,packing});
  saveSnapshot();
}

let reloadTimer;
async function reloadLive(){ clearTimeout(reloadTimer); reloadTimer=setTimeout(async()=>{ try{ await loadRealData(); render(); }catch(e){ console.error(e); } },220); }
function subscribeRealtime(){
  if(!supabase||!state.team)return;
  if(state.realtime) supabase.removeChannel(state.realtime);
  state.realtime=supabase.channel(`cx-trip-${state.team.id}`)
    .on('postgres_changes',{event:'*',schema:'public'},reloadLive).subscribe();
}

async function init(){
  const hashView=location.hash.replace('#',''); if(['dashboard','calendar','races','tasks','costs','team'].includes(hashView)) state.view=hashView;
  if('serviceWorker' in navigator){ navigator.serviceWorker.register('./sw.js').catch(()=>{}); }
  if(state.demo){ seedDemo(); state.loading=false; render(); return; }
  const {data:{session}}=await supabase.auth.getSession(); state.user=session?.user||null;
  supabase.auth.onAuthStateChange((_evt,session)=>{ state.user=session?.user||null; if(!state.user){ Object.assign(state,{team:null,members:[],races:[]}); render(); }});
  if(state.user){ try{ await loadRealData(); subscribeRealtime(); }catch(e){ console.error(e); toast('Nie udało się pobrać danych',true); } }
  state.loading=false; render();
}

function navButton(view,icon,label){ return `<button data-nav="${view}" class="${state.view===view?'active':''}"><span class="icon">${icon}</span>${label}</button>`; }
function mobileNavButton(view,icon,label){ return `<button data-nav="${view}" class="${state.view===view?'active':''}"><span class="micon">${icon}</span>${label}</button>`; }
function appShell(content,title){
  return `<div class="app-shell">
    <aside class="sidebar"><div class="brand"><div class="brand-mark">CX</div><div><b>CX Trip</b><small>Race manager</small></div></div>
      <nav class="nav">${navButton('dashboard','⌂','Pulpit')}${navButton('calendar','▦','Kalendarz')}${navButton('races','🏁','Wyścigi')}${navButton('tasks','✓','Zadania')}${navButton('costs','₿','Koszty')}${navButton('team','♟','Ekipa')}</nav>
      <div class="sidebar-footer"><div class="team-chip"><strong>${esc(state.team?.name||'')}</strong>Kod ekipy: <b>${esc(state.team?.invite_code||'—')}</b></div></div>
    </aside>
    <main class="main"><header class="topbar"><h1>${esc(title)}</h1><div class="top-actions">
      ${state.view==='tasks' ? '<button class="btn btn-primary hide-mobile" data-add-team-task>+ Dodaj zadanie</button>' : (state.view!=='race' ? '<button class="btn btn-primary hide-mobile" data-add-race>+ Dodaj wyścig</button>':'')}
      <div class="user-pill"><div class="avatar">${esc(memberInitials(state.user.id))}</div><span>${esc(memberName(state.user.id))}</span></div>
    </div></header><div class="content">${content}</div></main>
    <nav class="mobile-nav">${mobileNavButton('dashboard','⌂','Pulpit')}${mobileNavButton('calendar','▦','Kalendarz')}${mobileNavButton('races','🏁','Wyścigi')}${mobileNavButton('tasks','✓','Zadania')}${mobileNavButton('costs','₿','Koszty')}${mobileNavButton('team','♟','Ekipa')}</nav>
    ${state.view==='tasks'?'<button class="fab" data-add-team-task aria-label="Dodaj zadanie">+</button>':(state.view!=='race'?'<button class="fab" data-add-race aria-label="Dodaj wyścig">+</button>':'')}
  </div>`;
}

function render(){
  if(state.loading){ app.innerHTML='<div class="auth-wrap"><div class="auth-card"><div class="auth-brand"><div class="brand-mark">CX</div><h1>Ładowanie…</h1></div></div></div>'; return; }
  if(!state.user) return renderAuth();
  if(!state.demo && !state.team) return renderOnboarding();
  let content='',title='CX Trip';
  if(state.view==='dashboard'){title='Pulpit';content=dashboardView();}
  else if(state.view==='calendar'){title='Kalendarz';content=calendarView();}
  else if(state.view==='races'){title='Wyścigi';content=racesView();}
  else if(state.view==='tasks'){title='Zadania zespołu';content=teamTasksView();}
  else if(state.view==='costs'){title='Koszty i rozliczenia';content=costsView();}
  else if(state.view==='team'){title='Ekipa';content=teamView();}
  else if(state.view==='race'){const r=selectedRace(); if(!r){state.view='races';return render();} title='Szczegóły wyścigu'; content=raceDetailView(r);}
  app.innerHTML=appShell(content,title); bindGlobal();
}

function renderAuth(){
  const signup=state.authMode==='signup';
  app.innerHTML=`<div class="auth-wrap"><div class="auth-card"><div class="auth-brand"><div class="brand-mark">CX</div><h1>CX Trip</h1><p>Wspólny planer wyjazdów na wyścigi.</p></div>
    <form id="authForm">${signup?'<label>Imię<input name="name" required autocomplete="name" placeholder="np. Dawid"></label>':''}<label>E-mail<input name="email" type="email" required autocomplete="email"></label><label>Hasło<input name="password" type="password" minlength="6" required autocomplete="current-password"></label><button class="btn btn-primary" type="submit">${signup?'Utwórz konto':'Zaloguj się'}</button></form>
    <div class="auth-switch">${signup?'Masz już konto?':'Pierwszy raz?'} <button class="link-btn" id="authSwitch">${signup?'Zaloguj się':'Załóż konto'}</button></div>
    ${!configured?'<div class="demo-note">Tryb demo — Supabase nie jest jeszcze skonfigurowany.</div>':''}
  </div></div>`;
  document.querySelector('#authSwitch')?.addEventListener('click',()=>{state.authMode=signup?'signin':'signup';render();});
  document.querySelector('#authForm')?.addEventListener('submit',async e=>{
    e.preventDefault(); const f=new FormData(e.currentTarget); const email=f.get('email'),password=f.get('password');
    try{
      if(signup){ const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:f.get('name')}}}); if(error)throw error; if(data.session){ state.user=data.user; } else { state.user=null; state.authMode='signin'; } toast(data.session?'Konto utworzone':'Sprawdź e-mail i potwierdź konto, a potem się zaloguj'); }
      else { const {data,error}=await supabase.auth.signInWithPassword({email,password}); if(error)throw error; state.user=data.user; await loadRealData(); subscribeRealtime(); }
      render();
    }catch(err){ toast(err.message||'Błąd logowania',true); }
  });
}

function renderOnboarding(){
  app.innerHTML=`<div class="auth-wrap"><div class="auth-card" style="width:min(760px,100%)"><div class="auth-brand"><div class="brand-mark">CX</div><h1>Utwórz lub dołącz do ekipy</h1><p>Jedna ekipa = jeden wspólny kalendarz i wszystkie dane.</p></div>
    <div class="onboarding-actions"><div class="onboard-option"><h3>Załóż ekipę</h3><p>Ty tworzysz grupę i wysyłasz pozostałym kod.</p><form id="createTeam"><label>Nazwa ekipy<input name="name" required placeholder="np. Victoria CX"></label><button class="btn btn-primary" style="margin-top:12px;width:100%">Utwórz ekipę</button></form></div>
    <div class="onboard-option"><h3>Dołącz kodem</h3><p>Wpisz 6-znakowy kod otrzymany od kolegi.</p><form id="joinTeam"><label>Kod ekipy<input name="code" required maxlength="6" style="text-transform:uppercase" placeholder="ABC123"></label><button class="btn" style="margin-top:12px;width:100%">Dołącz</button></form></div></div>
    <div style="text-align:center;margin-top:18px"><button class="link-btn" id="logoutOnboard">Wyloguj</button></div>
  </div></div>`;
  document.querySelector('#createTeam').addEventListener('submit',async e=>{e.preventDefault();const name=new FormData(e.currentTarget).get('name');try{const {error}=await supabase.rpc('create_team',{team_name:name});if(error)throw error;await loadRealData();subscribeRealtime();render();}catch(x){toast(x.message,true)}});
  document.querySelector('#joinTeam').addEventListener('submit',async e=>{e.preventDefault();const code=new FormData(e.currentTarget).get('code');try{const {error}=await supabase.rpc('join_team',{code});if(error)throw error;await loadRealData();subscribeRealtime();render();}catch(x){toast(x.message,true)}});
  document.querySelector('#logoutOnboard').addEventListener('click',()=>supabase.auth.signOut());
}

function dashboardView(){
  const up=upcomingRaces(), next=up[0], openTasks=teamTasks().filter(t=>!t.done).length;
  const missingHotel=up.filter(r=>['brak','szukamy'].includes(r.hotel_status)).length;
  const alerts=[];
  up.slice(0,4).forEach(r=>{const du=daysUntil(r.race_date); if(du<=8&&['brak','szukamy'].includes(r.hotel_status))alerts.push(`<div class="alert"><strong>⚠ ${esc(r.name)}</strong>Wyścig za ${du===0?'dzisiaj':du+' dni'}, a hotel nadal nie jest potwierdzony.</div>`); if(du<=5&&participantCount(r.id)===0)alerts.push(`<div class="alert"><strong>👥 Brak składu</strong>${esc(r.name)} — nikt nie ma statusu „Jedzie”.</div>`);});
  teamTasks().filter(isTaskOverdue).slice(0,3).forEach(t=>alerts.push(`<div class="alert danger-alert"><strong>⏰ Zadanie po terminie — ${esc(memberName(t.assigned_to))}</strong>${esc(t.title)}${t.due_date?' • termin '+fmtDate(t.due_date):''}</div>`));
  return `<div class="grid stats"><div class="stat"><div class="label">Najbliższy start</div><div class="value">${next?daysUntil(next.race_date)+' dni':'—'}</div><div class="sub">${next?esc(next.city||next.name):'Brak kolejnych wyścigów'}</div></div>
    <div class="stat"><div class="label">Nadchodzące wyścigi</div><div class="value">${up.length}</div><div class="sub">w kalendarzu</div></div>
    <div class="stat"><div class="label">Otwarte zadania</div><div class="value">${openTasks}</div><div class="sub">do ogarnięcia</div></div>
    <div class="stat"><div class="label">Hotel do ogarnięcia</div><div class="value">${missingHotel}</div><div class="sub">nadchodzących wyjazdów</div></div></div>
    <div class="grid two-col"><section class="card"><div class="card-header"><h2>Najbliższe wyjazdy</h2><button class="btn btn-sm" data-nav="races">Wszystkie</button></div>${raceList(up.slice(0,6))}</section>
      <div class="stack"><section class="card"><div class="card-header"><h3>Do uwagi</h3></div><div class="stack">${alerts.length?alerts.join(''):'<div class="empty" style="padding:20px">✓ Wszystko wygląda dobrze.</div>'}</div></section>
      <section class="card"><div class="card-header"><h3>Sezon w liczbach</h3></div><div class="info-list"><div class="info-item"><div class="ii">💰</div><div><small>Wpisane koszty</small><b>${PLN.format(totalExpenses())}</b></div></div><div class="info-item"><div class="ii">👥</div><div><small>Osoby w ekipie</small><b>${state.members.length}</b></div></div></div></section></div></div>`;
}

function raceList(arr){
  if(!arr.length)return '<div class="empty"><div class="big">🏁</div>Nie ma jeszcze wyścigów.</div>';
  return `<div class="race-list">${arr.map(r=>{const d=dateObj(r.race_date);return `<div class="race-row"><div class="race-date"><b>${d?.getDate()||'—'}</b><span>${d?d.toLocaleString('pl-PL',{month:'short'}):''}</span></div><div class="race-main"><h3>${esc(r.name)}</h3><p>📍 ${esc(r.city||r.race_address||'Lokalizacja nieuzupełniona')} ${r.start_time?' • ⏱ '+esc(String(r.start_time).slice(0,5)):''}</p><div class="race-meta">${raceStatusBadge(r)}${hotelBadge(r)}<span class="badge">👥 ${participantCount(r.id)}/${state.members.length}</span><span class="badge">✓ ${taskProgress(r.id)}%</span></div></div><button class="btn btn-sm" data-open-race="${r.id}">Otwórz</button></div>`}).join('')}</div>`;
}

function racesView(){
  let arr=[...state.races]; const q=state.search.toLowerCase().trim(); if(q)arr=arr.filter(r=>[r.name,r.city,r.race_address].some(v=>String(v||'').toLowerCase().includes(q)));
  if(state.raceFilter==='nadchodzace')arr=arr.filter(isUpcoming); if(state.raceFilter==='zakonczone')arr=arr.filter(r=>!isUpcoming(r)); arr.sort((a,b)=>String(a.race_date).localeCompare(String(b.race_date)));
  return `<div class="toolbar"><div class="search"><input id="raceSearch" value="${attr(state.search)}" placeholder="Szukaj po nazwie lub miejscowości…"></div><select id="raceFilter" style="width:auto"><option value="nadchodzace" ${state.raceFilter==='nadchodzace'?'selected':''}>Nadchodzące</option><option value="wszystkie" ${state.raceFilter==='wszystkie'?'selected':''}>Wszystkie</option><option value="zakonczone" ${state.raceFilter==='zakonczone'?'selected':''}>Zakończone</option></select><button class="btn btn-primary" data-add-race>+ Nowy wyścig</button></div><section class="card">${raceList(arr)}</section>`;
}

function calendarView(){
  const y=state.calDate.getFullYear(),m=state.calDate.getMonth(); const first=new Date(y,m,1); let start=new Date(first); const dow=(first.getDay()+6)%7; start.setDate(first.getDate()-dow); const days=[];
  for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const key=isoDate(d);const ev=state.races.filter(r=>r.race_date===key);days.push(`<div class="day ${d.getMonth()!==m?'out':''}"><div class="num">${d.getDate()}</div>${ev.map(r=>`<button class="cal-event" data-open-race="${r.id}" title="${attr(r.name)}">${esc(r.name)}</button>`).join('')}</div>`)}
  return `<section class="card"><div class="cal-controls"><button class="btn btn-sm" id="calPrev">←</button><h2>${esc(MONTH.format(state.calDate))}</h2><button class="btn btn-sm" id="calNext">→</button></div><div class="calendar">${['Pon','Wt','Śr','Czw','Pt','Sob','Nd'].map(x=>`<div class="cal-head">${x}</div>`).join('')}${days.join('')}</div></section>`;
}

function teamTasksView(){
  let tasks=[...teamTasks()];
  if(state.taskFilter==='open') tasks=tasks.filter(t=>!t.done);
  if(state.taskFilter==='done') tasks=tasks.filter(t=>t.done);
  if(state.taskMemberFilter!=='all') tasks=tasks.filter(t=>t.assigned_to===state.taskMemberFilter);
  tasks.sort((a,b)=>Number(a.done)-Number(b.done) || Number(isTaskOverdue(b))-Number(isTaskOverdue(a)) || String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')) || String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const open=teamTasks().filter(t=>!t.done).length, overdue=teamTasks().filter(isTaskOverdue).length, done=teamTasks().filter(t=>t.done).length, mine=teamTasks().filter(t=>!t.done&&t.assigned_to===state.user.id).length;
  const visibleMembers=state.taskMemberFilter==='all'?state.members:state.members.filter(m=>m.user_id===state.taskMemberFilter);
  const cards=visibleMembers.map(m=>memberTaskCard(m,tasks.filter(t=>t.assigned_to===m.user_id))).join('');
  const unassigned=tasks.filter(t=>!t.assigned_to);
  return `<div class="grid stats task-stats"><div class="stat"><div class="label">Otwarte</div><div class="value">${open}</div><div class="sub">zadań zespołu</div></div><div class="stat"><div class="label">Po terminie</div><div class="value ${overdue?'danger-text':''}">${overdue}</div><div class="sub">wymaga uwagi</div></div><div class="stat"><div class="label">Moje zadania</div><div class="value">${mine}</div><div class="sub">jeszcze niewykonane</div></div><div class="stat"><div class="label">Wykonane</div><div class="value">${done}</div><div class="sub">łącznie</div></div></div>
    <div class="toolbar task-toolbar"><select id="taskStatusFilter" style="width:auto"><option value="open" ${state.taskFilter==='open'?'selected':''}>Otwarte</option><option value="all" ${state.taskFilter==='all'?'selected':''}>Wszystkie</option><option value="done" ${state.taskFilter==='done'?'selected':''}>Wykonane</option></select><select id="taskMemberFilter" style="width:auto"><option value="all">Wszyscy</option>${state.members.map(m=>`<option value="${m.user_id}" ${state.taskMemberFilter===m.user_id?'selected':''}>${esc(m.display_name)}</option>`).join('')}</select><button class="btn btn-primary" data-add-team-task>+ Dodaj zadanie</button></div>
    <div class="task-board">${cards}${unassigned.length?`<section class="card member-task-card"><div class="card-header"><div><h3>Nieprzypisane</h3><div class="muted small">${unassigned.filter(t=>!t.done).length} otwartych</div></div><span class="badge">${unassigned.length}</span></div>${unassigned.map(taskRowHtml).join('')}</section>`:''}</div>`;
}

function memberTaskCard(m,tasks){
  const open=tasks.filter(t=>!t.done).length;
  return `<section class="card member-task-card"><div class="card-header"><div class="task-person-head"><div class="avatar">${esc(memberInitials(m.user_id))}</div><div><h3>${esc(m.display_name)}</h3><div class="muted small">${open} otwartych</div></div></div><button class="btn btn-sm" data-task-member="${m.user_id}">+ Dodaj</button></div><div class="member-task-list">${tasks.length?tasks.map(taskRowHtml).join(''):'<div class="empty compact">Brak zadań.</div>'}</div></section>`;
}

function taskRowHtml(t){
  const race=taskRaceName(t), overdue=isTaskOverdue(t);
  return `<div class="task-row task-row-rich ${t.done?'task-done':''} ${overdue?'task-overdue':''}"><input class="check" type="checkbox" data-task-toggle="${t.id}" ${t.done?'checked':''}><div class="grow"><div class="row-title">${esc(t.title)}</div><div class="task-badges">${taskPriorityBadge(t.priority)}<span class="badge ${t.race_id?'info':''}">${t.race_id?'🏁 ':'📌 '}${esc(race)}</span>${overdue?'<span class="badge danger">Po terminie</span>':''}</div><div class="row-sub">${t.due_date?'📅 do '+fmtDate(t.due_date):'Bez terminu'}${t.created_by?' • dodał(a): '+esc(memberName(t.created_by)):''}</div>${t.note?`<div class="task-note">${esc(t.note)}</div>`:''}</div><div class="task-actions"><button class="btn btn-sm" data-edit-team-task="${t.id}" title="Edytuj">✎</button><button class="btn btn-sm btn-danger" data-delete-task="${t.id}" title="Usuń">×</button></div></div>`;
}

function teamView(){
  return `<div class="grid two-col"><section class="card"><div class="card-header"><h2>Skład ekipy</h2><span class="badge info">${state.members.length} osób</span></div>${state.members.map(m=>`<div class="person-row"><div class="avatar">${esc(memberInitials(m.user_id))}</div><div class="grow"><div class="row-title">${esc(m.display_name)}</div><div class="row-sub">${m.role==='admin'?'Administrator':'Członek ekipy'}</div></div>${m.user_id===state.user.id?'<span class="badge ok">Ty</span>':''}</div>`).join('')}</section>
    <div class="stack"><section class="card"><div class="card-header"><h3>Kod zaproszenia</h3></div><div style="font-size:34px;font-weight:900;letter-spacing:5px;margin:8px 0">${esc(state.team.invite_code)}</div><p class="muted small">Wyślij ten kod pozostałym. Po utworzeniu konta wybierają „Dołącz kodem”.</p><button class="btn" id="copyInvite">Kopiuj kod</button></section>
    <section class="card"><div class="card-header"><h3>Aplikacja</h3></div><p class="muted small">Na telefonie otwórz stronę w przeglądarce i wybierz „Dodaj do ekranu głównego”. Będzie działać jak aplikacja PWA.</p>${state.demo?'<div class="badge warn">Tryb DEMO</div>':'<div class="badge ok">● Supabase połączony</div>'}<div class="separator"></div><button class="btn btn-danger" id="logoutBtn">Wyloguj się</button></section></div></div>`;
}

function costsView(){
  const byCat={}; state.expenses.forEach(e=>byCat[e.category]=(byCat[e.category]||0)+Number(e.amount)); const max=Math.max(1,...Object.values(byCat));
  const raceTotals=[...state.races].map(r=>({r,total:totalExpenses(r.id)})).filter(x=>x.total>0).sort((a,b)=>b.total-a.total);
  return `<div class="grid stats"><div class="stat"><div class="label">Łączne koszty</div><div class="value">${PLN.format(totalExpenses())}</div><div class="sub">wszystkie wpisane wyjazdy</div></div><div class="stat"><div class="label">Koszt / wyścig</div><div class="value">${raceTotals.length?PLN.format(totalExpenses()/raceTotals.length):PLN.format(0)}</div><div class="sub">średnio</div></div><div class="stat"><div class="label">Pozycji kosztowych</div><div class="value">${state.expenses.length}</div><div class="sub">rachunków i płatności</div></div><div class="stat"><div class="label">Najdroższy wyjazd</div><div class="value">${raceTotals[0]?PLN.format(raceTotals[0].total):'—'}</div><div class="sub">${raceTotals[0]?esc(raceTotals[0].r.name):'brak danych'}</div></div></div>
    <div class="grid two-col"><section class="card"><div class="card-header"><h2>Koszty wyjazdów</h2><button class="btn btn-sm" id="exportCsv">Eksport CSV</button></div>${raceTotals.length?raceTotals.map(x=>`<div class="expense-row"><div class="grow"><div class="row-title">${esc(x.r.name)}</div><div class="row-sub">${fmtDate(x.r.race_date)} • ${raceExpenses(x.r.id).length} pozycji</div></div><div class="money">${PLN.format(x.total)}</div><button class="btn btn-sm" data-open-race="${x.r.id}" data-tab="costs">Rozlicz</button></div>`).join(''):'<div class="empty">Brak wpisanych kosztów.</div>'}</section>
    <section class="card"><div class="card-header"><h3>Kategorie</h3></div><div class="cost-bars">${Object.keys(byCat).length?Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="cost-bar"><span>${esc(categoryName(k))}</span><div class="track"><div class="fill" style="width:${Math.round(v/max*100)}%"></div></div><b class="right">${Math.round(v)} zł</b></div>`).join(''):'<div class="empty">Brak danych.</div>'}</div></section></div>`;
}
function categoryName(k){return ({hotel:'Hotel',paliwo:'Paliwo',startowe:'Startowe',jedzenie:'Jedzenie',parking:'Parking',drogi:'Drogi',inne:'Inne'})[k]||k;}

function raceDetailView(r){
  const tabs=[['overview','Podsumowanie'],['squad','Skład'],['hotel','Hotel'],['tasks','Zadania'],['transport','Transport'],['costs','Koszty'],['packing','Sprzęt']];
  let body=''; if(state.detailTab==='overview')body=detailOverview(r); if(state.detailTab==='squad')body=detailSquad(r); if(state.detailTab==='hotel')body=detailHotel(r); if(state.detailTab==='tasks')body=detailTasks(r); if(state.detailTab==='transport')body=detailTransport(r); if(state.detailTab==='costs')body=detailCosts(r); if(state.detailTab==='packing')body=detailPacking(r);
  return `<div class="detail-head"><div><button class="link-btn" data-nav="races">← Wyścigi</button><h2>${esc(r.name)}</h2><div class="kpi-line">${raceStatusBadge(r)}${hotelBadge(r)}<span class="badge">📅 ${fmtDate(r.race_date)}</span><span class="badge">👥 ${participantCount(r.id)} jedzie</span></div></div><div class="detail-actions"><button class="btn" id="icsBtn">+ Kalendarz</button><button class="btn" id="printBtn">Drukuj</button><button class="btn btn-primary" id="editRace">Edytuj</button></div></div>
    <div class="detail-tabs">${tabs.map(([k,l])=>`<button data-detail-tab="${k}" class="${state.detailTab===k?'active':''}">${l}</button>`).join('')}</div>${body}`;
}

function detailOverview(r){
  const done=raceTasks(r.id).filter(t=>t.done).length, all=raceTasks(r.id).length;
  return `<div class="grid two-col"><div class="stack"><section class="card"><div class="card-header"><h2>Informacje</h2></div><div class="info-list"><div class="info-item"><div class="ii">📍</div><div><small>Miejsce wyścigu</small><b>${esc(r.race_address||r.city||'Nieuzupełnione')}</b>${r.race_address?`<div style="margin-top:7px"><button class="link-btn" data-map="${attr(r.race_address)}">Otwórz mapę ↗</button></div>`:''}</div></div><div class="info-item"><div class="ii">⏱</div><div><small>Start</small><b>${fmtDate(r.race_date)} ${r.start_time?'• '+esc(String(r.start_time).slice(0,5)):''}</b></div></div><div class="info-item"><div class="ii">🏷</div><div><small>Kategoria</small><b>${esc(r.category||'—')}</b></div></div>${r.registration_url?`<div class="info-item"><div class="ii">🔗</div><div><small>Zapisy / strona</small><a href="${attr(r.registration_url)}" target="_blank" rel="noopener">Otwórz link ↗</a></div></div>`:''}</div></section>
    <section class="card"><div class="card-header"><h3>Notatka do wyścigu</h3></div><div class="muted" style="white-space:pre-wrap">${esc(r.race_notes||'Brak notatki.')}</div></section></div>
    <div class="stack"><section class="card"><div class="card-header"><h3>Gotowość wyjazdu</h3><b>${taskProgress(r.id)}%</b></div><div class="progress"><span style="width:${taskProgress(r.id)}%"></span></div><div class="separator"></div><div class="info-list"><div class="info-item"><div class="ii">👥</div><div><small>Skład</small><b>${participantCount(r.id)} / ${state.members.length} jedzie</b></div></div><div class="info-item"><div class="ii">✓</div><div><small>Zadania</small><b>${done} / ${all} wykonane</b></div></div><div class="info-item"><div class="ii">💰</div><div><small>Koszty</small><b>${PLN.format(totalExpenses(r.id))}</b></div></div></div></section>
    <section class="card"><div class="card-header"><h3>Hotel</h3>${hotelBadge(r)}</div><b>${esc(r.hotel_name||'Nie wybrano')}</b><p class="muted small">${esc(r.hotel_address||'Brak adresu')}</p><button class="btn btn-sm" data-detail-tab="hotel">Szczegóły hotelu</button></section></div></div>`;
}

function detailSquad(r){
  const parts=raceParts(r.id); return `<section class="card"><div class="card-header"><h2>Skład na wyścig</h2><span class="badge info">${participantCount(r.id)} jedzie</span></div><p class="muted small">Każda osoba może zmienić status. Zmiana pojawi się u całej ekipy.</p>${state.members.map(m=>{const p=parts.find(x=>x.user_id===m.user_id);const s=p?.status||'nieustalone';return `<div class="person-row"><div class="avatar">${esc(memberInitials(m.user_id))}</div><div class="grow"><div class="row-title">${esc(m.display_name)}</div><div class="row-sub">${m.role==='admin'?'Admin':'Ekipa'}</div></div><select class="status-select" data-participant-user="${m.user_id}" data-race="${r.id}"><option value="nieustalone" ${s==='nieustalone'?'selected':''}>Nieustalone</option><option value="jedzie" ${s==='jedzie'?'selected':''}>Jedzie</option><option value="moze" ${s==='moze'?'selected':''}>Może</option><option value="nie_jedzie" ${s==='nie_jedzie'?'selected':''}>Nie jedzie</option></select></div>`}).join('')}</section>`;
}

function detailHotel(r){
  return `<div class="grid two-col"><section class="card"><div class="card-header"><h2>Hotel / nocleg</h2>${hotelBadge(r)}</div><div class="info-list"><div class="info-item"><div class="ii">🏨</div><div><small>Nazwa</small><b>${esc(r.hotel_name||'Nie wybrano')}</b></div></div><div class="info-item"><div class="ii">📍</div><div><small>Adres</small><b>${esc(r.hotel_address||'—')}</b>${r.hotel_address?`<div style="margin-top:7px"><button class="link-btn" data-map="${attr(r.hotel_address)}">Otwórz mapę ↗</button></div>`:''}</div></div><div class="info-item"><div class="ii">🛏</div><div><small>Pokoje</small><b>${esc(r.hotel_rooms||'—')}</b></div></div><div class="info-item"><div class="ii">💳</div><div><small>Cena</small><b>${r.hotel_price?PLN.format(r.hotel_price):'—'}</b></div></div></div></section><section class="card"><div class="card-header"><h3>Informacje o rezerwacji</h3></div><div class="muted" style="white-space:pre-wrap">${esc(r.hotel_notes||'Brak dodatkowych informacji.')}</div>${r.hotel_url?`<div class="separator"></div><a class="btn" href="${attr(r.hotel_url)}" target="_blank" rel="noopener">Otwórz rezerwację ↗</a>`:''}</section></div>`;
}

function detailTasks(r){
  const tasks=raceTasks(r.id).sort((a,b)=>Number(a.done)-Number(b.done) || Number(isTaskOverdue(b))-Number(isTaskOverdue(a)) || String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')));
  return `<div class="grid two-col"><section class="card"><div class="card-header"><h2>Zadania do tego wyścigu</h2><span class="badge">${tasks.filter(t=>t.done).length}/${tasks.length}</span></div>${tasks.length?tasks.map(taskRowHtml).join(''):'<div class="empty">Brak zadań.</div>'}</section><section class="card"><div class="card-header"><h3>Dodaj zadanie</h3></div><form id="taskForm" class="stack"><label>Zadanie<input name="title" required placeholder="np. Zarezerwować hotel"></label><label>Odpowiedzialny<select name="assigned_to" required><option value="">— wybierz osobę —</option>${memberOptions()}</select></label><div class="form-grid"><label>Termin<input type="date" name="due_date" value="${attr(r.race_date)}"></label><label>Priorytet<select name="priority"><option value="normal">Normalne</option><option value="high">Pilne</option><option value="low">Niskie</option></select></label></div><label>Notatka<textarea name="note" placeholder="Dodatkowe informacje…"></textarea></label><button class="btn btn-primary">Dodaj</button></form></section></div>`;
}

function detailTransport(r){
  const cars=raceVehicles(r.id); return `<div class="grid two-col"><section class="card"><div class="card-header"><h2>Samochody</h2><span class="badge">${cars.length}</span></div>${cars.length?cars.map(v=>`<div class="vehicle-row"><div class="ii">🚗</div><div class="grow"><div class="row-title">${esc(v.name)}</div><div class="row-sub">Kierowca: ${esc(memberName(v.driver_id))} • ${v.seats} miejsc${v.departure_place?' • '+esc(v.departure_place):''}${v.departure_time?' • '+new Date(v.departure_time).toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):''}</div>${v.notes?`<div class="row-sub">${esc(v.notes)}</div>`:''}</div><button class="btn btn-sm btn-danger" data-delete-vehicle="${v.id}">×</button></div>`).join(''):'<div class="empty">Nie dodano samochodu.</div>'}<div class="separator"></div><div class="muted small" style="white-space:pre-wrap">${esc(r.transport_notes||'Brak ogólnej notatki transportowej.')}</div></section><section class="card"><div class="card-header"><h3>Dodaj samochód</h3></div><form id="vehicleForm" class="stack"><label>Samochód<input name="name" required placeholder="np. Audi A4"></label><label>Kierowca<select name="driver_id">${memberOptions()}</select></label><div class="form-grid"><label>Miejsca<input type="number" min="1" max="9" name="seats" value="5"></label><label>Wyjazd<input type="datetime-local" name="departure_time"></label></div><label>Miejsce wyjazdu<input name="departure_place" placeholder="np. Jarocin"></label><label>Notatka<textarea name="notes" placeholder="np. bagażnik na 4 rowery"></textarea></label><button class="btn btn-primary">Dodaj</button></form></section></div>`;
}

function balanceData(rid){
  const paid={},owed={}; state.members.forEach(m=>{paid[m.user_id]=0;owed[m.user_id]=0});
  raceExpenses(rid).forEach(e=>paid[e.payer_id]=(paid[e.payer_id]||0)+Number(e.amount)); raceShareRows(rid).forEach(s=>owed[s.user_id]=(owed[s.user_id]||0)+Number(s.share_amount));
  const balances=state.members.map(m=>({id:m.user_id,name:m.display_name,net:(paid[m.user_id]||0)-(owed[m.user_id]||0)}));
  const creditors=balances.filter(x=>x.net>.005).map(x=>({...x})).sort((a,b)=>b.net-a.net), debtors=balances.filter(x=>x.net<-.005).map(x=>({...x,net:-x.net})).sort((a,b)=>b.net-a.net), settlements=[];
  let i=0,j=0; while(i<debtors.length&&j<creditors.length){const a=Math.min(debtors[i].net,creditors[j].net);settlements.push({from:debtors[i].name,to:creditors[j].name,amount:a});debtors[i].net-=a;creditors[j].net-=a;if(debtors[i].net<.01)i++;if(creditors[j].net<.01)j++;}
  return {paid,owed,balances,settlements};
}
function detailCosts(r){
  const ex=raceExpenses(r.id).sort((a,b)=>String(b.paid_at).localeCompare(String(a.paid_at))); const bal=balanceData(r.id);
  return `<div class="grid two-col"><div class="stack"><section class="card"><div class="card-header"><h2>Koszty</h2><b>${PLN.format(totalExpenses(r.id))}</b></div>${ex.length?ex.map(e=>`<div class="expense-row"><div class="grow"><div class="row-title">${esc(e.description)}</div><div class="row-sub">${esc(categoryName(e.category))} • zapłacił(a): ${esc(memberName(e.payer_id))} • ${fmtDate(e.paid_at)}</div></div><div class="money">${PLN.format(Number(e.amount))}</div><button class="btn btn-sm btn-danger" data-delete-expense="${e.id}">×</button></div>`).join(''):'<div class="empty">Brak kosztów.</div>'}</section><section class="card"><div class="card-header"><h3>Rozliczenie</h3></div>${bal.settlements.length?bal.settlements.map(s=>`<div class="settlement"><span>${esc(s.from)} → ${esc(s.to)}</span><b>${PLN.format(s.amount)}</b></div>`).join(''):'<div class="empty" style="padding:20px">Brak kwot do wyrównania.</div>'}</section></div>
    <section class="card"><div class="card-header"><h3>Dodaj koszt</h3></div><form id="expenseForm" class="stack"><label>Za co<input name="description" required placeholder="np. Hotel"></label><div class="form-grid"><label>Kwota<input name="amount" type="number" min="0" step="0.01" required></label><label>Kategoria<select name="category"><option value="hotel">Hotel</option><option value="paliwo">Paliwo</option><option value="startowe">Startowe</option><option value="jedzenie">Jedzenie</option><option value="parking">Parking</option><option value="drogi">Drogi</option><option value="inne">Inne</option></select></label></div><label>Zapłacił(a)<select name="payer_id">${memberOptions(state.user.id)}</select></label><label>Dotyczy kogo?<div class="stack" style="gap:7px;margin-top:4px">${state.members.map(m=>`<span class="checkbox-line"><input type="checkbox" name="share_user" value="${m.user_id}" ${raceParts(r.id).find(p=>p.user_id===m.user_id&&p.status==='jedzie')?'checked':''}> ${esc(m.display_name)}</span>`).join('')}</div></label><button class="btn btn-primary">Dodaj i podziel równo</button></form></section></div>`;
}

function detailPacking(r){
  const items=racePacking(r.id).sort((a,b)=>Number(a.done)-Number(b.done)); return `<div class="grid two-col"><section class="card"><div class="card-header"><h2>Sprzęt / rzeczy</h2><span class="badge">${items.filter(x=>x.done).length}/${items.length}</span></div>${items.length?items.map(x=>`<div class="packing-row"><input class="check" type="checkbox" data-packing-toggle="${x.id}" ${x.done?'checked':''}><div class="grow"><div class="row-title" style="${x.done?'text-decoration:line-through;opacity:.6':''}">${x.qty>1?x.qty+'× ':''}${esc(x.name)}</div><div class="row-sub">Odpowiada: ${x.owner_id?esc(memberName(x.owner_id)):'—'}</div></div><button class="btn btn-sm btn-danger" data-delete-packing="${x.id}">×</button></div>`).join(''):'<div class="empty">Lista jest pusta.</div>'}</section><section class="card"><div class="card-header"><h3>Dodaj rzecz</h3></div><form id="packingForm" class="stack"><label>Nazwa<input name="name" required placeholder="np. Myjka ciśnieniowa"></label><div class="form-grid"><label>Ilość<input type="number" min="1" name="qty" value="1"></label><label>Kto zabiera<select name="owner_id"><option value="">—</option>${memberOptions()}</select></label></div><button class="btn btn-primary">Dodaj</button></form></section></div>`;
}
function memberOptions(selected=''){return state.members.map(m=>`<option value="${m.user_id}" ${m.user_id===selected?'selected':''}>${esc(m.display_name)}</option>`).join('');}

function bindGlobal(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.nav;state.selectedRaceId=null;if(['dashboard','calendar','races','tasks','costs','team'].includes(state.view))history.replaceState(null,'','#'+state.view);render()}));
  document.querySelectorAll('[data-add-race]').forEach(b=>b.addEventListener('click',()=>openRaceModal()));
  document.querySelectorAll('[data-add-team-task]').forEach(b=>b.addEventListener('click',()=>openTaskModal()));
  document.querySelectorAll('[data-task-member]').forEach(b=>b.addEventListener('click',()=>openTaskModal(null,b.dataset.taskMember)));
  document.querySelectorAll('[data-edit-team-task]').forEach(b=>b.addEventListener('click',()=>openTaskModal(state.tasks.find(t=>t.id===b.dataset.editTeamTask))));
  document.querySelectorAll('[data-task-toggle]').forEach(x=>x.addEventListener('change',e=>updateRow('tasks',e.target.dataset.taskToggle,{done:e.target.checked})));
  document.querySelectorAll('[data-delete-task]').forEach(x=>x.addEventListener('click',()=>deleteRow('tasks',x.dataset.deleteTask)));
  document.querySelectorAll('[data-open-race]').forEach(b=>b.addEventListener('click',()=>{state.selectedRaceId=b.dataset.openRace;state.view='race';state.detailTab=b.dataset.tab||'overview';render()}));
  document.querySelectorAll('[data-detail-tab]').forEach(b=>b.addEventListener('click',()=>{state.detailTab=b.dataset.detailTab;render()}));
  document.querySelectorAll('[data-map]').forEach(b=>b.addEventListener('click',()=>window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.dataset.map)}`,'_blank')));
  document.querySelector('#taskStatusFilter')?.addEventListener('change',e=>{state.taskFilter=e.target.value;render()});
  document.querySelector('#taskMemberFilter')?.addEventListener('change',e=>{state.taskMemberFilter=e.target.value;render()});
  const rs=document.querySelector('#raceSearch'); if(rs)rs.addEventListener('input',e=>{const pos=e.target.selectionStart;state.search=e.target.value;render();const n=document.querySelector('#raceSearch');if(n){n.focus();n.setSelectionRange(pos,pos);}});
  const rf=document.querySelector('#raceFilter'); if(rf)rf.addEventListener('change',e=>{state.raceFilter=e.target.value;render()});
  document.querySelector('#calPrev')?.addEventListener('click',()=>{state.calDate=new Date(state.calDate.getFullYear(),state.calDate.getMonth()-1,1);render()});
  document.querySelector('#calNext')?.addEventListener('click',()=>{state.calDate=new Date(state.calDate.getFullYear(),state.calDate.getMonth()+1,1);render()});
  document.querySelector('#copyInvite')?.addEventListener('click',async()=>{await navigator.clipboard.writeText(state.team.invite_code);toast('Kod skopiowany')});
  document.querySelector('#logoutBtn')?.addEventListener('click',async()=>{if(state.demo){toast('W trybie demo wylogowanie jest wyłączone');return;}await supabase.auth.signOut()});
  document.querySelector('#exportCsv')?.addEventListener('click',exportCsv);
  if(state.view==='race')bindRaceDetail();
}

function bindRaceDetail(){
  const r=selectedRace();
  document.querySelector('#editRace')?.addEventListener('click',()=>openRaceModal(r)); document.querySelector('#printBtn')?.addEventListener('click',()=>window.print()); document.querySelector('#icsBtn')?.addEventListener('click',()=>exportIcs(r));
  document.querySelectorAll('[data-participant-user]').forEach(s=>s.addEventListener('change',async e=>{await upsertParticipant(e.target.dataset.race,e.target.dataset.participantUser,e.target.value)}));
  document.querySelectorAll('[data-packing-toggle]').forEach(x=>x.addEventListener('change',e=>updateRow('packing_items',e.target.dataset.packingToggle,{done:e.target.checked},'packing'))); document.querySelectorAll('[data-delete-packing]').forEach(x=>x.addEventListener('click',()=>deleteRow('packing_items',x.dataset.deletePacking,'packing')));
  document.querySelectorAll('[data-delete-vehicle]').forEach(x=>x.addEventListener('click',()=>deleteRow('race_vehicles',x.dataset.deleteVehicle,'vehicles'))); document.querySelectorAll('[data-delete-expense]').forEach(x=>x.addEventListener('click',()=>deleteExpense(x.dataset.deleteExpense)));
  document.querySelector('#taskForm')?.addEventListener('submit',e=>submitTask(e,r)); document.querySelector('#vehicleForm')?.addEventListener('submit',e=>submitVehicle(e,r)); document.querySelector('#packingForm')?.addEventListener('submit',e=>submitPacking(e,r)); document.querySelector('#expenseForm')?.addEventListener('submit',e=>submitExpense(e,r));
}

function modal(html){ const el=document.createElement('div');el.className='modal-backdrop';el.innerHTML=html;document.body.appendChild(el);el.addEventListener('click',e=>{if(e.target===el||e.target.closest('[data-close-modal]'))el.remove()});return el; }
function openTaskModal(task=null,presetAssignee='',presetRaceId=''){
  const editing=Boolean(task); const assignee=task?.assigned_to||presetAssignee||state.user.id; const raceId=task?.race_id||presetRaceId||'';
  const el=modal(`<div class="modal task-modal"><div class="modal-header"><h2>${editing?'Edytuj zadanie':'Dodaj zadanie'}</h2><button class="btn icon-btn" data-close-modal>×</button></div><form id="teamTaskForm"><div class="modal-body"><div class="form-grid">
    <label class="full">Co trzeba zrobić?<input name="title" required value="${attr(task?.title||'')}" placeholder="np. Zadzwonić do hotelu i potwierdzić pokoje"></label>
    <label>Przypisz do<select name="assigned_to" required><option value="">— wybierz —</option>${memberOptions(assignee)}</select></label>
    <label>Priorytet<select name="priority"><option value="normal" ${(task?.priority||'normal')==='normal'?'selected':''}>Normalne</option><option value="high" ${task?.priority==='high'?'selected':''}>Pilne</option><option value="low" ${task?.priority==='low'?'selected':''}>Niskie</option></select></label>
    <label>Termin<input type="date" name="due_date" value="${attr(task?.due_date||'')}"></label>
    <label>Powiąż z wyścigiem<select name="race_id"><option value="">— zadanie ogólne —</option>${[...state.races].sort((a,b)=>String(a.race_date).localeCompare(String(b.race_date))).map(r=>`<option value="${r.id}" ${raceId===r.id?'selected':''}>${esc(r.name)} — ${fmtDate(r.race_date)}</option>`).join('')}</select></label>
    <label class="full">Notatka<textarea name="note" placeholder="Szczegóły, numer telefonu, co dokładnie sprawdzić…">${esc(task?.note||'')}</textarea></label>
    </div></div><div class="modal-footer">${editing?'<button type="button" class="btn btn-danger" id="deleteTaskModal">Usuń</button>':''}<button type="button" class="btn" data-close-modal>Anuluj</button><button class="btn btn-primary">${editing?'Zapisz':'Dodaj zadanie'}</button></div></form></div>`);
  el.querySelector('#teamTaskForm').addEventListener('submit',async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));const row={team_id:state.team.id,race_id:f.race_id||null,title:f.title.trim(),note:f.note?.trim()||null,assigned_to:f.assigned_to||null,due_date:f.due_date||null,priority:f.priority||'normal',done:task?.done||false};try{await saveTeamTask(task?.id,row);el.remove();render();toast(editing?'Zadanie zaktualizowane':'Zadanie dodane');}catch(x){toast(x.message,true)}});
  el.querySelector('#deleteTaskModal')?.addEventListener('click',async()=>{if(!confirm('Usunąć to zadanie?'))return;await deleteRow('tasks',task.id);el.remove();render();});
}

async function saveTeamTask(id,row){
  if(state.demo){if(id){const i=state.tasks.findIndex(t=>t.id===id);if(i>=0)state.tasks[i]={...state.tasks[i],...row};}else state.tasks.push({id:uid(),...row,created_by:state.user.id,created_at:new Date().toISOString()});saveDemo();return;}
  if(id){const {error}=await supabase.from('tasks').update(row).eq('id',id);if(error)throw error;}else{const {error}=await supabase.from('tasks').insert({...row,created_by:state.user.id});if(error)throw error;}await loadRealData();
}

function openRaceModal(r=null){
  const editing=Boolean(r); const el=modal(`<div class="modal"><div class="modal-header"><h2>${editing?'Edytuj wyścig':'Dodaj nowy wyścig'}</h2><button class="btn icon-btn" data-close-modal>×</button></div><form id="raceForm"><div class="modal-body"><div class="form-grid">
    <label class="full">Nazwa wyścigu<input name="name" required value="${attr(r?.name||'')}" placeholder="np. Puchar Polski CX — Szczekociny"></label><label>Data<input type="date" name="race_date" required value="${attr(r?.race_date||isoDate(new Date()))}"></label><label>Godzina startu<input type="time" name="start_time" value="${attr(String(r?.start_time||'').slice(0,5))}"></label><label>Miejscowość<input name="city" value="${attr(r?.city||'')}"></label><label>Kategoria<input name="category" value="${attr(r?.category||'')}"></label><label class="full">Dokładna lokalizacja wyścigu<input name="race_address" value="${attr(r?.race_address||'')}"></label><label>Link do zapisów / strony<input type="url" name="registration_url" value="${attr(r?.registration_url||'')}"></label><label>Status<select name="status"><option value="planowany" ${r?.status==='planowany'?'selected':''}>Planowany</option><option value="potwierdzony" ${r?.status==='potwierdzony'?'selected':''}>Potwierdzony</option><option value="zakonczony" ${r?.status==='zakonczony'?'selected':''}>Zakończony</option><option value="odwolany" ${r?.status==='odwolany'?'selected':''}>Odwołany</option></select></label>
    <label>Hotel — status<select name="hotel_status"><option value="brak" ${(!r||r.hotel_status==='brak')?'selected':''}>Brak</option><option value="szukamy" ${r?.hotel_status==='szukamy'?'selected':''}>Szukamy</option><option value="zarezerwowany" ${r?.hotel_status==='zarezerwowany'?'selected':''}>Zarezerwowany</option><option value="oplacony" ${r?.hotel_status==='oplacony'?'selected':''}>Opłacony</option></select></label><label>Hotel — nazwa<input name="hotel_name" value="${attr(r?.hotel_name||'')}"></label><label class="full">Hotel — adres<input name="hotel_address" value="${attr(r?.hotel_address||'')}"></label><label>Pokoje<input name="hotel_rooms" value="${attr(r?.hotel_rooms||'')}" placeholder="np. 2×2 + 1×1"></label><label>Cena hotelu<input type="number" min="0" step="0.01" name="hotel_price" value="${attr(r?.hotel_price||'')}"></label><label class="full">Link do hotelu / rezerwacji<input type="url" name="hotel_url" value="${attr(r?.hotel_url||'')}"></label><label class="full">Notatka hotelowa<textarea name="hotel_notes">${esc(r?.hotel_notes||'')}</textarea></label><label class="full">Notatki o wyścigu<textarea name="race_notes">${esc(r?.race_notes||'')}</textarea></label><label class="full">Notatki transportowe<textarea name="transport_notes">${esc(r?.transport_notes||'')}</textarea></label>
    </div></div><div class="modal-footer">${editing?'<button type="button" class="btn btn-danger" id="deleteRace">Usuń wyścig</button>':''}<button type="button" class="btn" data-close-modal>Anuluj</button><button class="btn btn-primary">${editing?'Zapisz zmiany':'Dodaj wyścig'}</button></div></form></div>`);
  el.querySelector('#raceForm').addEventListener('submit',async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));const row={team_id:state.team.id,name:f.name,race_date:f.race_date,start_time:f.start_time||null,city:f.city||null,category:f.category||null,race_address:f.race_address||null,registration_url:f.registration_url||null,status:f.status,hotel_status:f.hotel_status,hotel_name:f.hotel_name||null,hotel_address:f.hotel_address||null,hotel_rooms:f.hotel_rooms||null,hotel_price:f.hotel_price?Number(f.hotel_price):null,hotel_url:f.hotel_url||null,hotel_notes:f.hotel_notes||null,race_notes:f.race_notes||null,transport_notes:f.transport_notes||null};try{if(editing)await saveRaceEdit(r.id,row);else await createRace(row);el.remove();render();toast(editing?'Zapisano zmiany':'Dodano wyścig');}catch(x){toast(x.message,true)}});
  el.querySelector('#deleteRace')?.addEventListener('click',async()=>{if(!confirm('Usunąć cały wyścig razem z kosztami, zadaniami i składem?'))return;try{await deleteRace(r.id);el.remove();state.view='races';state.selectedRaceId=null;render();toast('Wyścig usunięty')}catch(x){toast(x.message,true)}});
}

async function createRace(row){
  if(state.demo){const r={id:uid(),...row,end_date:row.race_date,created_at:new Date().toISOString()};state.races.push(r);state.members.forEach(m=>state.participants.push({id:uid(),race_id:r.id,user_id:m.user_id,status:'nieustalone'}));saveDemo();return;}
  const {data,error}=await supabase.from('races').insert({...row,created_by:state.user.id}).select().single();if(error)throw error;await Promise.all(state.members.map(m=>supabase.from('race_participants').insert({race_id:data.id,user_id:m.user_id,status:'nieustalone'})));await loadRealData();
}
async function saveRaceEdit(id,row){if(state.demo){const i=state.races.findIndex(x=>x.id===id);state.races[i]={...state.races[i],...row};saveDemo();return;}const {error}=await supabase.from('races').update(row).eq('id',id);if(error)throw error;await loadRealData();}
async function deleteRace(id){if(state.demo){state.races=state.races.filter(x=>x.id!==id);state.participants=state.participants.filter(x=>x.race_id!==id);state.tasks=state.tasks.filter(x=>x.race_id!==id);const exIds=new Set(state.expenses.filter(x=>x.race_id===id).map(x=>x.id));state.expenses=state.expenses.filter(x=>x.race_id!==id);state.shares=state.shares.filter(x=>!exIds.has(x.expense_id));state.vehicles=state.vehicles.filter(x=>x.race_id!==id);state.packing=state.packing.filter(x=>x.race_id!==id);saveDemo();return;}const {error}=await supabase.from('races').delete().eq('id',id);if(error)throw error;await loadRealData();}
async function upsertParticipant(rid,userId,status){
  if(state.demo){let p=state.participants.find(x=>x.race_id===rid&&x.user_id===userId);if(p)p.status=status;else state.participants.push({id:uid(),race_id:rid,user_id:userId,status});saveDemo();render();return;}
  const {error}=await supabase.from('race_participants').upsert({race_id:rid,user_id:userId,status},{onConflict:'race_id,user_id'});if(error)toast(error.message,true);else await loadRealData();render();
}
async function updateRow(table,id,patch,demoKey=table){
  if(state.demo){const arr=state[demoKey];const i=arr.findIndex(x=>x.id===id);if(i>=0)arr[i]={...arr[i],...patch};saveDemo();render();return;}
  const {error}=await supabase.from(table).update(patch).eq('id',id);if(error)toast(error.message,true);else{await loadRealData();render();}
}
async function deleteRow(table,id,demoKey=table){
  if(state.demo){state[demoKey]=state[demoKey].filter(x=>x.id!==id);saveDemo();render();return;}
  const {error}=await supabase.from(table).delete().eq('id',id);if(error)toast(error.message,true);else{await loadRealData();render();}
}
async function submitTask(e,r){e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));const row={team_id:state.team.id,race_id:r.id,title:f.title.trim(),note:f.note?.trim()||null,assigned_to:f.assigned_to||null,due_date:f.due_date||null,priority:f.priority||'normal',done:false};if(state.demo){state.tasks.push({id:uid(),...row,created_by:state.user.id,created_at:new Date().toISOString()});saveDemo();render();return;}const {error}=await supabase.from('tasks').insert({...row,created_by:state.user.id});if(error)toast(error.message,true);else{await loadRealData();render();}}
async function submitVehicle(e,r){e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));const row={id:uid(),race_id:r.id,name:f.name,driver_id:f.driver_id||null,seats:Number(f.seats||5),departure_time:f.departure_time?new Date(f.departure_time).toISOString():null,departure_place:f.departure_place||null,notes:f.notes||null};if(state.demo){state.vehicles.push(row);saveDemo();render();return;}const {id,...db}=row;const {error}=await supabase.from('race_vehicles').insert(db);if(error)toast(error.message,true);else{await loadRealData();render();}}
async function submitPacking(e,r){e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));const row={id:uid(),race_id:r.id,name:f.name,owner_id:f.owner_id||null,qty:Number(f.qty||1),done:false};if(state.demo){state.packing.push(row);saveDemo();render();return;}const {id,...db}=row;const {error}=await supabase.from('packing_items').insert(db);if(error)toast(error.message,true);else{await loadRealData();render();}}
async function submitExpense(e,r){
  e.preventDefault();const fd=new FormData(e.currentTarget);const users=fd.getAll('share_user');if(!users.length){toast('Zaznacz co najmniej jedną osobę',true);return;}const amount=Number(fd.get('amount'));const per=Math.round((amount/users.length)*100)/100;const row={race_id:r.id,payer_id:fd.get('payer_id'),description:fd.get('description'),category:fd.get('category'),amount,paid_at:isoDate(new Date())};
  if(state.demo){const id=uid();state.expenses.push({id,...row});let remaining=amount;users.forEach((u,i)=>{const share=i===users.length-1?Math.round(remaining*100)/100:per;remaining-=share;state.shares.push({id:uid(),expense_id:id,user_id:u,share_amount:share})});saveDemo();render();return;}
  const {data,error}=await supabase.from('expenses').insert(row).select().single();if(error){toast(error.message,true);return;}let remaining=amount;const shares=users.map((u,i)=>{const share=i===users.length-1?Math.round(remaining*100)/100:per;remaining-=share;return{expense_id:data.id,user_id:u,share_amount:share}});const {error:se}=await supabase.from('expense_shares').insert(shares);if(se)toast(se.message,true);await loadRealData();render();
}
async function deleteExpense(id){if(state.demo){state.expenses=state.expenses.filter(x=>x.id!==id);state.shares=state.shares.filter(x=>x.expense_id!==id);saveDemo();render();return;}const {error}=await supabase.from('expenses').delete().eq('id',id);if(error)toast(error.message,true);else{await loadRealData();render();}}

function exportIcs(r){
  const d=String(r.race_date).replaceAll('-',''); const end=new Date(dateObj(r.race_date));end.setDate(end.getDate()+1); const de=isoDate(end).replaceAll('-',''); const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CX Trip//PL','BEGIN:VEVENT',`UID:${r.id}@cxtrip`,`DTSTART;VALUE=DATE:${d}`,`DTEND;VALUE=DATE:${de}`,`SUMMARY:${icsEsc(r.name)}`,`LOCATION:${icsEsc(r.race_address||r.city||'')}`,`DESCRIPTION:${icsEsc(r.race_notes||'')}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');downloadBlob(`${safeFile(r.name)}.ics`,text,'text/calendar;charset=utf-8');
}
function exportCsv(){ const rows=[['Wyścig','Data','Opis','Kategoria','Płacił','Kwota']];state.expenses.forEach(e=>{const r=state.races.find(x=>x.id===e.race_id);rows.push([r?.name||'',r?.race_date||'',e.description,categoryName(e.category),memberName(e.payer_id),Number(e.amount).toFixed(2)])});const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\n');downloadBlob('cx-trip-koszty.csv',csv,'text/csv;charset=utf-8');}
function icsEsc(s=''){return String(s).replace(/\\/g,'\\\\').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\n/g,'\\n')}
function safeFile(s='wyjazd'){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'wyjazd'}
function downloadBlob(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

init();
