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
  user: null, team: null, members: [], races: [], participants: [], tasks: [], expenses: [], shares: [], vehicles: [], packing: [], results: [], privateNotes: [], prizes: [], activity: [], activityReadAt: null,
  view: 'dashboard', selectedRaceId: null, detailTab: 'overview', search: '', raceFilter: 'nadchodzace',
  taskFilter: 'open', taskMemberFilter: 'all', calDate: new Date(), loading: true, authMode: 'signin', realtime: null, demo: !configured,
  pushSupported: ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window), pushPermission: ('Notification' in window ? Notification.permission : 'unsupported'), pushSubscribed: false, pushBusy: false
};

function uid(){ return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now(); }
function esc(v=''){ return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function attr(v=''){ return esc(v).replace(/`/g,'&#96;'); }
function toast(msg, error=false){ toastEl.textContent=msg; toastEl.className='toast show'+(error?' error':''); clearTimeout(window.__t); window.__t=setTimeout(()=>toastEl.className='toast',2600); }
function dateObj(v){ if(!v)return null; const [y,m,d]=String(v).slice(0,10).split('-').map(Number); return new Date(y,m-1,d); }
function isoDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtDate(v){ const d=dateObj(v); return d?DMY.format(d):'—'; }
function memberName(id){ return state.members.find(m=>m.user_id===id)?.display_name || 'Nieznany'; }
function activityActorName(a){ return a.actor_name || memberName(a.actor_id) || 'Ktoś'; }
function activityUnreadCount(){ if(!state.activityReadAt)return 0; const seen=new Date(state.activityReadAt).getTime(); return state.activity.filter(a=>a.actor_id!==state.user?.id && new Date(a.created_at).getTime()>seen).length; }
function fmtActivityTime(v){ if(!v)return ''; const d=new Date(v), now=new Date(), diff=Math.round((d-now)/60000); if(Math.abs(diff)<1)return 'przed chwilą'; if(Math.abs(diff)<60)return `${Math.abs(diff)} min temu`; const h=Math.round(Math.abs(diff)/60); if(h<24)return `${h} godz. temu`; if(h<48)return 'wczoraj'; return d.toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }

function withTimeout(promise, ms, label='Operacja'){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' przekroczyła limit czasu')),ms)});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

function isIos(){ return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isStandalone(){ return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true; }
function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4); const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const rawData=atob(base64); return Uint8Array.from([...rawData].map(c=>c.charCodeAt(0)));
}
async function refreshPushState(sync=false){
  state.pushSupported=('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && Boolean(CFG.vapidPublicKey));
  state.pushPermission=('Notification' in window ? Notification.permission : 'unsupported');
  if(!state.pushSupported){ state.pushSubscribed=false; return; }
  try{
    const reg=await withTimeout(navigator.serviceWorker.ready,5000,'Service Worker'); const sub=await reg.pushManager.getSubscription(); state.pushSubscribed=Boolean(sub);
    if(sync && sub && state.user && state.team && !state.demo) await savePushSubscription(sub);
  }catch(e){ console.warn('Push state',e); state.pushSubscribed=false; }
}
async function savePushSubscription(sub){
  const j=sub.toJSON(); const row={team_id:state.team.id,user_id:state.user.id,endpoint:j.endpoint,p256dh:j.keys?.p256dh,auth:j.keys?.auth,user_agent:navigator.userAgent,updated_at:new Date().toISOString()};
  const {error}=await supabase.from('push_subscriptions').upsert(row,{onConflict:'endpoint'}); if(error)throw error;
}
async function enablePush(){
  if(state.demo){ toast('Powiadomienia push działają po podłączeniu Supabase',true); return; }
  if(isIos()&&!isStandalone()){ toast('Na iPhonie najpierw: Udostępnij → Dodaj do ekranu początkowego',true); return; }
  if(!state.pushSupported){ toast('Ta przeglądarka nie obsługuje powiadomień push albo brakuje klucza VAPID',true); return; }
  if(state.pushBusy)return; state.pushBusy=true;
  try{
    const permission=await Notification.requestPermission(); state.pushPermission=permission;
    if(permission!=='granted'){ toast('Powiadomienia nie zostały włączone',true); return; }
    const reg=await withTimeout(navigator.serviceWorker.ready,8000,'Service Worker');
    let sub=await reg.pushManager.getSubscription();
    if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(CFG.vapidPublicKey)});
    await savePushSubscription(sub); state.pushSubscribed=true; toast('Powiadomienia push są włączone ✓'); render();
  }catch(e){ console.error(e); toast('Nie udało się włączyć powiadomień: '+(e.message||e),true); }
  finally{state.pushBusy=false;}
}
async function disablePush(){
  if(!state.pushSupported)return;
  try{
    const reg=await withTimeout(navigator.serviceWorker.ready,8000,'Service Worker'); const sub=await reg.pushManager.getSubscription();
    if(sub){ const endpoint=sub.endpoint; if(!state.demo&&state.user) await supabase.from('push_subscriptions').delete().eq('endpoint',endpoint).eq('user_id',state.user.id); await sub.unsubscribe(); }
    state.pushSubscribed=false; toast('Powiadomienia wyłączone'); render();
  }catch(e){console.error(e);toast('Nie udało się wyłączyć powiadomień',true)}
}
function pushStatusUi(){
  if(isIos()&&!isStandalone()) return `<div class="push-box warn-box"><div class="push-symbol">📲</div><div class="grow"><b>Powiadomienia na iPhonie</b><div class="row-sub">Otwórz stronę w Safari → Udostępnij → Dodaj do ekranu początkowego. Potem uruchom CX Trip z ikony i kliknij „Włącz”.</div></div><span class="badge warn">wymaga instalacji</span></div>`;
  if(!state.pushSupported) return `<div class="push-box"><div class="push-symbol">🔕</div><div class="grow"><b>Powiadomienia systemowe niedostępne</b><div class="row-sub">Sprawdź obsługę Web Push i konfigurację klucza VAPID.</div></div></div>`;
  if(state.pushPermission==='denied') return `<div class="push-box danger-box"><div class="push-symbol">🔕</div><div class="grow"><b>Powiadomienia zablokowane</b><div class="row-sub">Włącz je ręcznie w ustawieniach powiadomień przeglądarki / CX Trip.</div></div><span class="badge danger">zablokowane</span></div>`;
  return `<div class="push-box ${state.pushSubscribed?'enabled':''}"><div class="push-symbol">${state.pushSubscribed?'🔔':'🔕'}</div><div class="grow"><b>Banery systemowe</b><div class="row-sub">${state.pushSubscribed?'Włączone na tym urządzeniu. Zmiany innych osób mogą pojawić się na ekranie blokady i w centrum powiadomień.':'Włącz, aby dostawać banery, gdy ktoś zmieni hotel, skład, zadania, koszty, wyniki lub inne wspólne dane.'}</div></div><button class="btn ${state.pushSubscribed?'btn-ghost':'btn-primary'}" data-push-toggle>${state.pushSubscribed?'Wyłącz':'Włącz powiadomienia'}</button></div>`;
}

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
function raceResults(rid){ return state.results.filter(x=>x.race_id===rid); }
function myPrivateNotes(){ return state.privateNotes.filter(x=>x.user_id===state.user?.id); }
function myPrizeEntries(){ return state.prizes.filter(x=>x.user_id===state.user?.id); }
function settlementLabel(s){ return ({nierozliczone:'Nierozliczone',rozliczone:'Rozliczone',na_miejscu:'Na miejscu'})[s]||'Nierozliczone'; }
function settlementClass(s){ return s==='rozliczone'?'ok':s==='na_miejscu'?'warn':'danger'; }
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
function hotelArrivalDays(r){ return Math.max(0,Number(r.hotel_arrival_days_before ?? 1)); }
function hotelArrivalDate(r){ const d=dateObj(r.race_date); if(!d)return null; d.setDate(d.getDate()-hotelArrivalDays(r)); return isoDate(d); }
function hotelArrivalLabel(r){ const n=hotelArrivalDays(r); return n===0?'w dniu wyścigu':n===1?'1 dzień wcześniej':`${n} dni wcześniej`; }
function hotelTimingBadge(r){ return r.hotel_status&&r.hotel_status!=='brak'?`<span class="badge info">🌙 ${hotelArrivalLabel(r)}</span>`:''; }
function partStatusLabel(s){ return ({jedzie:'Jedzie',moze:'Może',nie_jedzie:'Nie jedzie',nieustalone:'Nieustalone'})[s]||s; }
function taskProgress(rid){ const a=raceTasks(rid); if(!a.length)return 0; return Math.round(a.filter(x=>x.done).length/a.length*100); }
function participantCount(rid){ return raceParts(rid).filter(p=>p.status==='jedzie').length; }
function upcomingRaces(){ return [...state.races].filter(isUpcoming).sort((a,b)=>String(a.race_date).localeCompare(String(b.race_date))); }
function totalExpenses(rid=null){ return (rid?raceExpenses(rid):state.expenses).reduce((s,e)=>s+Number(e.amount||0),0); }
function saveDemo(){ if(state.demo){ localStorage.setItem('cxtrip_demo_v3',JSON.stringify({team:state.team,members:state.members,races:state.races,participants:state.participants,tasks:state.tasks,expenses:state.expenses,shares:state.shares,vehicles:state.vehicles,packing:state.packing,results:state.results,privateNotes:state.privateNotes,prizes:state.prizes,activity:state.activity,activityReadAt:state.activityReadAt})); } }
function saveSnapshot(){ try{ localStorage.setItem('cxtrip_snapshot',JSON.stringify({team:state.team,members:state.members,races:state.races,participants:state.participants,tasks:state.tasks,expenses:state.expenses,shares:state.shares,vehicles:state.vehicles,packing:state.packing,results:state.results,privateNotes:state.privateNotes,prizes:state.prizes,activity:state.activity,activityReadAt:state.activityReadAt,ts:Date.now()})); }catch{} }

function seedDemo(){
  const stored=localStorage.getItem('cxtrip_demo_v3')||localStorage.getItem('cxtrip_demo_v2'); if(stored){ Object.assign(state,JSON.parse(stored)); const demoMe=state.members.find(m=>m.display_name==='Dawid')||state.members[0]; state.user={id:demoMe.user_id,email:'demo@cxtrip.local',user_metadata:{display_name:demoMe.display_name}}; return; }
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
    {id:r1,team_id:tid,name:'Puchar Polski CX — Szczekociny',race_date:isoDate(d1),end_date:isoDate(d1),start_time:'11:40',city:'Szczekociny',race_address:'Szczekociny',category:'Junior',status:'potwierdzony',hotel_status:'zarezerwowany',hotel_payment_status:'nierozliczone',hotel_stay_days:2,hotel_arrival_days_before:1,hotel_name:'Hotel Demo',hotel_address:'Centrum, Szczekociny',hotel_rooms:'2×2 osoby + 1×1',hotel_price:640,hotel_notes:'Śniadanie od 6:30. Parking z tyłu hotelu.',race_notes:'Biuro zawodów od 8:00. Wziąć drugi komplet kół.',transport_notes:'Wyjazd rano, dokładna godzina do ustalenia.'},
    {id:r2,team_id:tid,name:'Bryksy Cross',race_date:isoDate(d2),end_date:isoDate(d2),start_time:'12:10',city:'Gościęcin',race_address:'Gościęcin',category:'Junior',status:'planowany',hotel_status:'szukamy',hotel_payment_status:'na_miejscu',hotel_stay_days:1,hotel_arrival_days_before:2,hotel_name:'',hotel_address:'',hotel_rooms:'',hotel_price:null,hotel_notes:'',race_notes:'Czekamy na harmonogram.',transport_notes:''}
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
  state.shares=state.members.slice(0,4).map(m=>({id:uid(),expense_id:'e1',user_id:m.user_id,share_amount:160,settlement_status:m.user_id===me?'rozliczone':'nierozliczone'}));
  state.vehicles=[{id:'v1',race_id:r1,driver_id:me,name:'Audi A4',seats:5,departure_time:`${isoDate(d1)}T06:30:00`,departure_place:'Jarocin',notes:'Bagażnik na 4 rowery'}];
  state.packing=[{id:uid(),race_id:r1,name:'Myjka',owner_id:u2,qty:1,done:false},{id:uid(),race_id:r1,name:'Zapasowe koła',owner_id:me,qty:2,done:true}];
  state.results=[{id:'res1',race_id:r1,user_id:me,result_text:'3. miejsce',category:'Junior',note:'Dobry start, ciężka końcówka.',created_at:new Date().toISOString()}];
  state.privateNotes=[{id:'pn1',user_id:me,title:'Moje ustawienia roweru',body:'Ciśnienie na błoto: sprawdzić przed startem.',created_at:new Date().toISOString()}];
  state.prizes=[{id:'pr1',user_id:me,race_id:r1,race_name:'Puchar Polski CX — Szczekociny',amount:200,awarded_at:isoDate(d1),note:'Nagroda za podium'}];
  state.activity=[
    {id:'ac1',team_id:tid,actor_id:u2,actor_name:'Kuba',entity_type:'races',entity_id:r2,race_id:r2,action:'UPDATE',entity_label:'Bryksy Cross',changed_fields:['hotel_status'],created_at:new Date(Date.now()-12*60000).toISOString(),old_data:{hotel_status:'brak'},new_data:{hotel_status:'szukamy'}},
    {id:'ac2',team_id:tid,actor_id:u5,actor_name:'Donata',entity_type:'tasks',entity_id:'ta1',race_id:r1,action:'INSERT',entity_label:'Potwierdzić hotel',changed_fields:null,created_at:new Date(Date.now()-38*60000).toISOString(),old_data:null,new_data:{title:'Potwierdzić hotel',assigned_to:me}},
    {id:'ac3',team_id:tid,actor_id:me,actor_name:'Dawid',entity_type:'race_results',entity_id:'res1',race_id:r1,action:'INSERT',entity_label:'Puchar Polski CX — Szczekociny',changed_fields:null,created_at:new Date(Date.now()-2*3600000).toISOString(),old_data:null,new_data:{user_id:me,result_text:'3. miejsce'}}
  ];
  state.activityReadAt=new Date(Date.now()-30*60000).toISOString();
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
  let participants=[],tasks=[],expenses=[],shares=[],vehicles=[],packing=[],results=[];
  const tq=await supabase.from('tasks').select('*').eq('team_id',teamId).order('done').order('due_date',{ascending:true,nullsFirst:false}).order('created_at',{ascending:false});
  tasks=tq.data||[];
  if(raceIds.length){
    const [p,e,v,pk,res]=await Promise.all([
      supabase.from('race_participants').select('*').in('race_id',raceIds),
      supabase.from('expenses').select('*').in('race_id',raceIds), supabase.from('race_vehicles').select('*').in('race_id',raceIds),
      supabase.from('packing_items').select('*').in('race_id',raceIds), supabase.from('race_results').select('*').in('race_id',raceIds)
    ]);
    participants=p.data||[]; expenses=e.data||[]; vehicles=v.data||[]; packing=pk.data||[]; results=res.data||[];
    const expenseIds=expenses.map(x=>x.id); if(expenseIds.length){ const s=await supabase.from('expense_shares').select('*').in('expense_id',expenseIds); shares=s.data||[]; }
  }
  const [pn,pr]=await Promise.all([supabase.from('private_notes').select('*').order('updated_at',{ascending:false}),supabase.from('prize_entries').select('*').order('awarded_at',{ascending:false})]);
  let activity=[], activityReadAt=state.activityReadAt;
  const aq=await supabase.from('activity_log').select('*').eq('team_id',teamId).order('created_at',{ascending:false}).limit(250);
  if(!aq.error) activity=aq.data||[];
  const ar=await supabase.from('activity_reads').select('last_seen_at').eq('team_id',teamId).eq('user_id',state.user.id).maybeSingle();
  if(!ar.error && ar.data?.last_seen_at) activityReadAt=ar.data.last_seen_at;
  else if(!ar.error && !ar.data){ activityReadAt=new Date().toISOString(); await supabase.from('activity_reads').upsert({team_id:teamId,user_id:state.user.id,last_seen_at:activityReadAt},{onConflict:'team_id,user_id'}); }
  Object.assign(state,{team,members:members||[],races:races||[],participants,tasks,expenses,shares,vehicles,packing,results,privateNotes:pn.data||[],prizes:pr.data||[],activity,activityReadAt});
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
  const hashView=location.hash.replace('#',''); if(['dashboard','calendar','races','tasks','results','costs','activity','notes','team'].includes(hashView)) state.view=hashView;
  render();

  // PWA/push nie może nigdy blokować wejścia do aplikacji — szczególnie na iOS.
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js?v=10',{updateViaCache:'none'}).catch(e=>console.warn('SW register',e));
  }
  if(state.demo){ seedDemo(); state.loading=false; window.__cxBootOk=true; render(); return; }

  try{
    const {data:{session}}=await withTimeout(supabase.auth.getSession(),10000,'Logowanie');
    state.user=session?.user||null;
    supabase.auth.onAuthStateChange((_evt,session)=>{ state.user=session?.user||null; if(!state.user){ Object.assign(state,{team:null,members:[],races:[]}); render(); }});
    if(state.user){
      try{ await withTimeout(loadRealData(),15000,'Pobieranie danych'); subscribeRealtime(); }
      catch(e){ console.error(e); toast('Nie udało się pobrać danych. Sprawdź internet i spróbuj ponownie.',true); }
    }
  }catch(e){
    console.error('Startup',e);
    state.user=null;
    toast('Problem z uruchomieniem. Sprawdź połączenie i uruchom aplikację ponownie.',true);
  }finally{
    state.loading=false;
    window.__cxBootOk=true;
    render();
    // Stan push sprawdzamy dopiero po pokazaniu aplikacji i bez oczekiwania na wynik.
    refreshPushState(Boolean(state.user)).then(()=>render()).catch(e=>console.warn('Push init',e));
  }
}

function navButton(view,icon,label,badge=0){ return `<button data-nav="${view}" class="${state.view===view?'active':''}"><span class="icon">${icon}</span><span class="nav-label">${label}</span>${badge?`<span class="nav-count">${badge>99?'99+':badge}</span>`:''}</button>`; }
function mobileNavButton(view,icon,label,badge=0){ return `<button data-nav="${view}" class="${state.view===view?'active':''}"><span class="mobile-icon-wrap"><span class="micon">${icon}</span>${badge?`<span class="mobile-count">${badge>99?'99+':badge}</span>`:''}</span>${label}</button>`; }
function appShell(content,title){
  const unread=activityUnreadCount();
  return `<div class="app-shell">
    <aside class="sidebar"><div class="brand"><div class="brand-mark">CX</div><div><b>CX Trip</b><small>Race manager</small></div></div>
      <nav class="nav">${navButton('dashboard','⌂','Pulpit')}${navButton('calendar','▦','Kalendarz')}${navButton('races','🏁','Wyścigi')}${navButton('tasks','✓','Zadania')}${navButton('results','★','Wyniki')}${navButton('costs','₿','Koszty')}${navButton('notes','✎','Notatki')}${navButton('team','♟','Ekipa')}</nav>
      <div class="sidebar-footer"><div class="team-chip"><strong>${esc(state.team?.name||'')}</strong>Kod ekipy: <b>${esc(state.team?.invite_code||'—')}</b></div></div>
    </aside>
    <main class="main"><header class="topbar"><h1>${esc(title)}</h1><div class="top-actions">
      ${state.view==='tasks' ? '<button class="btn btn-primary hide-mobile" data-add-team-task>+ Dodaj zadanie</button>' : state.view==='results' ? '<button class="btn btn-primary hide-mobile" data-add-result>+ Dodaj wynik</button>' : state.view==='notes' ? '<button class="btn btn-primary hide-mobile" data-add-note>+ Notatka</button>' : (state.view!=='race' ? '<button class="btn btn-primary hide-mobile" data-add-race>+ Dodaj wyścig</button>':'')}
      <button class="notification-bell ${state.view==='activity'?'active':''}" data-nav="activity" aria-label="Aktywność i powiadomienia${unread?`, ${unread} nieprzeczytanych`:''}" title="Aktywność i ustawienia powiadomień"><span class="bell-icon">🔔</span>${unread?`<span class="bell-count">${unread>99?'99+':unread}</span>`:''}</button>
      <div class="user-pill"><div class="avatar">${esc(memberInitials(state.user.id))}</div><span>${esc(memberName(state.user.id))}</span></div>
    </div></header><div class="content">${content}</div></main>
    <div class="mobile-nav-shell">
      <div class="mobile-nav-progress" aria-hidden="true"><span id="mobileNavProgress"></span></div>
      <nav class="mobile-nav" id="mobileNav">${mobileNavButton('dashboard','⌂','Pulpit')}${mobileNavButton('calendar','▦','Kalendarz')}${mobileNavButton('races','🏁','Wyścigi')}${mobileNavButton('tasks','✓','Zadania')}${mobileNavButton('results','★','Wyniki')}${mobileNavButton('costs','₿','Koszty')}${mobileNavButton('notes','✎','Notatki')}${mobileNavButton('team','♟','Ekipa')}</nav>
      <div class="mobile-nav-more" id="mobileNavMore" aria-hidden="true"><span>›</span></div>
    </div>
    ${state.view==='tasks'?'<button class="fab" data-add-team-task aria-label="Dodaj zadanie">+</button>':state.view==='results'?'<button class="fab" data-add-result aria-label="Dodaj wynik">+</button>':state.view==='notes'?'<button class="fab" data-add-note aria-label="Dodaj notatkę">+</button>':(state.view!=='race'?'<button class="fab" data-add-race aria-label="Dodaj wyścig">+</button>':'')}
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
  else if(state.view==='results'){title='Wyniki sezonu';content=resultsView();}
  else if(state.view==='costs'){title='Koszty i rozliczenia';content=costsView();}
  else if(state.view==='activity'){title='Aktywność ekipy';content=activityView();}
  else if(state.view==='notes'){title='Moje prywatne';content=notesView();}
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
    e.preventDefault(); const f=new FormData(e.currentTarget); const email=String(f.get('email')||'').trim().toLowerCase(),password=String(f.get('password')||'');
    try{
      if(signup){ const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:f.get('name')}}}); if(error)throw error; if(data.session){ state.user=data.user; } else { state.user=null; state.authMode='signin'; } toast(data.session?'Konto utworzone':'Sprawdź e-mail i potwierdź konto, a potem się zaloguj'); }
      else {
        // Logowanie jest niezależne od PWA i powiadomień. Push NIGDY nie może zablokować sesji.
        const {data,error}=await supabase.auth.signInWithPassword({email,password});
        if(error) throw error;
        state.user=data.user;
        try { await loadRealData(); subscribeRealtime(); }
        catch(loadErr){ console.error('Dane po logowaniu',loadErr); toast('Zalogowano, ale nie udało się pobrać danych. Spróbuj odświeżyć.',true); }
        refreshPushState(true).then(()=>render()).catch(pushErr=>console.warn('Push po logowaniu',pushErr));
      }
      render();
    }catch(err){
      const raw=String(err?.message||err||'');
      const low=raw.toLowerCase();
      if(low.includes('invalid login credentials') || low.includes('invalid password')) toast('Nieprawidłowy e-mail lub hasło. Push nie zmienia haseł w Supabase.',true);
      else toast(raw||'Nie udało się zalogować',true);
    }
  });
}

function renderOnboarding(){
  app.innerHTML=`<div class="auth-wrap"><div class="auth-card" style="width:min(760px,100%)"><div class="auth-brand"><div class="brand-mark">CX</div><h1>Utwórz lub dołącz do ekipy</h1><p>Jedna ekipa = jeden wspólny kalendarz i wszystkie dane.</p></div>
    <div class="onboarding-actions"><div class="onboard-option"><h3>Załóż ekipę</h3><p>Ty tworzysz grupę i wysyłasz pozostałym kod.</p><form id="createTeam"><label>Nazwa ekipy<input name="name" required placeholder="np. Victoria CX"></label><button class="btn btn-primary" style="margin-top:12px;width:100%">Utwórz ekipę</button></form></div>
    <div class="onboard-option"><h3>Dołącz kodem</h3><p>Wpisz 6-znakowy kod otrzymany od kolegi.</p><form id="joinTeam"><label>Kod ekipy<input name="code" required maxlength="6" style="text-transform:uppercase" placeholder="ABC123"></label><button class="btn" style="margin-top:12px;width:100%">Dołącz</button></form></div></div>
    <div style="text-align:center;margin-top:18px"><button class="link-btn" id="logoutOnboard">Wyloguj</button></div>
  </div></div>`;
  document.querySelector('#createTeam').addEventListener('submit',async e=>{e.preventDefault();const name=new FormData(e.currentTarget).get('name');try{const {error}=await supabase.rpc('create_team',{team_name:name});if(error)throw error;await loadRealData();subscribeRealtime();refreshPushState(true).then(()=>render()).catch(e=>console.warn('Push onboarding',e));render();}catch(x){toast(x.message,true)}});
  document.querySelector('#joinTeam').addEventListener('submit',async e=>{e.preventDefault();const code=new FormData(e.currentTarget).get('code');try{const {error}=await supabase.rpc('join_team',{code});if(error)throw error;await loadRealData();subscribeRealtime();refreshPushState(true).then(()=>render()).catch(e=>console.warn('Push onboarding',e));render();}catch(x){toast(x.message,true)}});
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
  return `<div class="race-list">${arr.map(r=>{const d=dateObj(r.race_date);return `<div class="race-row"><div class="race-date"><b>${d?.getDate()||'—'}</b><span>${d?d.toLocaleString('pl-PL',{month:'short'}):''}</span></div><div class="race-main"><h3>${esc(r.name)}</h3><p>📍 ${esc(r.city||r.race_address||'Lokalizacja nieuzupełniona')} ${r.start_time?' • ⏱ '+esc(String(r.start_time).slice(0,5)):''}</p><div class="race-meta">${raceStatusBadge(r)}${hotelBadge(r)}${hotelTimingBadge(r)}<span class="badge">👥 ${participantCount(r.id)}/${state.members.length}</span><span class="badge">✓ ${taskProgress(r.id)}%</span></div></div><button class="btn btn-sm" data-open-race="${r.id}">Otwórz</button></div>`}).join('')}</div>`;
}

function racesView(){
  let arr=[...state.races]; const q=state.search.toLowerCase().trim(); if(q)arr=arr.filter(r=>[r.name,r.city,r.race_address].some(v=>String(v||'').toLowerCase().includes(q)));
  if(state.raceFilter==='nadchodzace')arr=arr.filter(isUpcoming); if(state.raceFilter==='zakonczone')arr=arr.filter(r=>!isUpcoming(r)); arr.sort((a,b)=>String(a.race_date).localeCompare(String(b.race_date)));
  return `<div class="toolbar"><div class="search"><input id="raceSearch" value="${attr(state.search)}" placeholder="Szukaj po nazwie lub miejscowości…"></div><select id="raceFilter" style="width:auto"><option value="nadchodzace" ${state.raceFilter==='nadchodzace'?'selected':''}>Nadchodzące</option><option value="wszystkie" ${state.raceFilter==='wszystkie'?'selected':''}>Wszystkie</option><option value="zakonczone" ${state.raceFilter==='zakonczone'?'selected':''}>Zakończone</option></select><button class="btn btn-primary" data-add-race>+ Nowy wyścig</button></div><section class="card">${raceList(arr)}</section>`;
}

function calendarView(){
  const y=state.calDate.getFullYear(),m=state.calDate.getMonth(); const first=new Date(y,m,1); let start=new Date(first); const dow=(first.getDay()+6)%7; start.setDate(first.getDate()-dow); const days=[];
  for(let i=0;i<42;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const key=isoDate(d);
    const ev=state.races.filter(r=>r.race_date===key);
    const hotelEv=state.races.filter(r=>r.hotel_status&&r.hotel_status!=='brak'&&hotelArrivalDate(r)===key);
    days.push(`<div class="day ${d.getMonth()!==m?'out':''}"><div class="num">${d.getDate()}</div>${hotelEv.map(r=>`<button class="cal-hotel-event ${r.hotel_status==='szukamy'?'searching':''}" data-open-race="${r.id}" data-tab="hotel" title="Hotel • ${attr(r.name)}">${r.hotel_status==='szukamy'?'🔎':'🏨'} Hotel • ${esc(r.name)}</button>`).join('')}${ev.map(r=>`<div class="cal-event-group"><button class="cal-event" data-open-race="${r.id}" title="${attr(r.name)}">${esc(r.name)}</button>${r.hotel_status&&r.hotel_status!=='brak'?`<div class="cal-hotel-note">🌙 ${hotelArrivalLabel(r)}</div>`:''}<button class="cal-results-link" data-open-race="${r.id}" data-tab="results">★ Wyniki${raceResults(r.id).length?' ('+raceResults(r.id).length+')':''}</button></div>`).join('')}</div>`)
  }
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
  const raceTotals=[...state.races].map(r=>({r,total:totalExpenses(r.id)})).filter(x=>x.total>0).sort((a,b)=>String(a.r.race_date).localeCompare(String(b.r.race_date)));
  const categoryTotal=(rid,cat)=>raceExpenses(rid).filter(e=>e.category===cat).reduce((a,e)=>a+Number(e.amount||0),0);
  const otherTotal=rid=>raceExpenses(rid).filter(e=>!['hotel','paliwo','startowe'].includes(e.category)).reduce((a,e)=>a+Number(e.amount||0),0);
  const sheetRows=raceTotals.map(x=>`<tr><td>${fmtDate(x.r.race_date)}</td><td>${esc(x.r.name)}</td><td>${PLN.format(categoryTotal(x.r.id,'hotel'))}</td><td>${PLN.format(categoryTotal(x.r.id,'paliwo'))}</td><td>${PLN.format(categoryTotal(x.r.id,'startowe'))}</td><td>${PLN.format(otherTotal(x.r.id))}</td><td><b>${PLN.format(x.total)}</b></td></tr>`).join('');
  return `<div class="grid stats"><div class="stat"><div class="label">Łączne koszty</div><div class="value">${PLN.format(totalExpenses())}</div><div class="sub">od początku danych sezonu</div></div><div class="stat"><div class="label">Koszt / wyścig</div><div class="value">${raceTotals.length?PLN.format(totalExpenses()/raceTotals.length):PLN.format(0)}</div><div class="sub">średnio</div></div><div class="stat"><div class="label">Pozycji kosztowych</div><div class="value">${state.expenses.length}</div><div class="sub">rachunków i płatności</div></div><div class="stat"><div class="label">Najdroższy wyjazd</div><div class="value">${raceTotals.length?PLN.format(Math.max(...raceTotals.map(x=>x.total))):'—'}</div><div class="sub">sezon</div></div></div>
    <div class="grid two-col"><section class="card"><div class="card-header"><h2>Koszty wyjazdów</h2><button class="btn btn-sm" id="exportCsv">Eksport CSV</button></div>${raceTotals.length?raceTotals.map(x=>`<div class="expense-row"><div class="grow"><div class="row-title">${esc(x.r.name)}</div><div class="row-sub">${fmtDate(x.r.race_date)} • ${raceExpenses(x.r.id).length} pozycji</div></div><div class="money">${PLN.format(x.total)}</div><button class="btn btn-sm" data-open-race="${x.r.id}" data-tab="costs">Rozlicz</button></div>`).join(''):'<div class="empty">Brak wpisanych kosztów.</div>'}</section>
    <section class="card"><div class="card-header"><h3>Kategorie</h3></div><div class="cost-bars">${Object.keys(byCat).length?Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="cost-bar"><span>${esc(categoryName(k))}</span><div class="track"><div class="fill" style="width:${Math.round(v/max*100)}%"></div></div><b class="right">${Math.round(v)} zł</b></div>`).join(''):'<div class="empty">Brak danych.</div>'}</div></section></div>
    <details class="toy-sheet"><summary>🧮 Mini Excel sezonu <span class="badge info">zabawka</span></summary><div class="toy-sheet-body"><div class="privacy-hint">Automatycznie zlicza wszystkie wpisane koszty. Nie musisz tu nic wpisywać ręcznie.</div><div class="sheet-scroll"><table class="mini-sheet"><thead><tr><th>Data</th><th>Wyścig</th><th>Hotel</th><th>Paliwo</th><th>Startowe</th><th>Inne</th><th>SUMA</th></tr></thead><tbody>${sheetRows||'<tr><td colspan="7">Brak danych</td></tr>'}<tr class="sheet-total"><td></td><td>ŁĄCZNIE</td><td>${PLN.format(byCat.hotel||0)}</td><td>${PLN.format(byCat.paliwo||0)}</td><td>${PLN.format(byCat.startowe||0)}</td><td>${PLN.format(Object.entries(byCat).filter(([k])=>!['hotel','paliwo','startowe'].includes(k)).reduce((a,[,v])=>a+v,0))}</td><td>${PLN.format(totalExpenses())}</td></tr></tbody></table></div></div></details>`;
}
function categoryName(k){return ({hotel:'Hotel',paliwo:'Paliwo',startowe:'Startowe',jedzenie:'Jedzenie',parking:'Parking',drogi:'Drogi',inne:'Inne'})[k]||k;}


function resultRace(rid){ return state.races.find(r=>r.id===rid); }
function resultRowHtml(x){
  const r=resultRace(x.race_id); const own=x.user_id===state.user.id;
  return `<div class="result-row"><div class="result-place">${esc(x.result_text)}</div><div class="grow"><div class="row-title">${esc(r?.name||'Usunięty wyścig')}</div><div class="row-sub">${r?fmtDate(r.race_date):'—'}${x.category?' • '+esc(x.category):''}</div>${x.note?`<div class="task-note">${esc(x.note)}</div>`:''}</div>${own?`<div class="task-actions"><button class="btn btn-sm" data-edit-result="${x.id}">✎</button><button class="btn btn-sm btn-danger" data-delete-result="${x.id}">×</button></div>`:''}</div>`;
}
function resultsView(){
  const sorted=[...state.results].sort((a,b)=>String(resultRace(b.race_id)?.race_date||'').localeCompare(String(resultRace(a.race_id)?.race_date||'')));
  const mine=sorted.filter(x=>x.user_id===state.user.id);
  const cards=state.members.map(m=>{const rows=sorted.filter(x=>x.user_id===m.user_id);return `<details class="result-member-card" ${m.user_id===state.user.id?'open':''}><summary><div class="task-person-head"><div class="avatar">${esc(memberInitials(m.user_id))}</div><div><b>${esc(m.display_name)}</b><small>${rows.length} wyników w sezonie</small></div></div><span class="badge info">${rows.length}</span></summary><div class="result-list">${rows.length?rows.map(resultRowHtml).join(''):'<div class="empty compact">Brak wpisanych wyników.</div>'}</div></details>`}).join('');
  return `<div class="grid stats"><div class="stat"><div class="label">Wyniki ekipy</div><div class="value">${state.results.length}</div><div class="sub">wpisów w sezonie</div></div><div class="stat"><div class="label">Moje wyniki</div><div class="value">${mine.length}</div><div class="sub">${esc(memberName(state.user.id))}</div></div><div class="stat"><div class="label">Wyścigi z wynikami</div><div class="value">${new Set(state.results.map(x=>x.race_id)).size}</div><div class="sub">z kalendarza</div></div><div class="stat"><div class="label">Ostatni wpis</div><div class="value small-value">${mine[0]?esc(mine[0].result_text):'—'}</div><div class="sub">${mine[0]?esc(resultRace(mine[0].race_id)?.name||''):'brak'}</div></div></div><div class="toolbar"><div class="privacy-hint grow">Nazwa wyścigu jest pobierana automatycznie z kalendarza. Każdy zapisuje i edytuje własny wynik, a cała ekipa może go zobaczyć.</div><button class="btn btn-primary" data-add-result>+ Dodaj mój wynik</button></div><div class="result-board">${cards}</div>`;
}
function detailResults(r){
  const rows=raceResults(r.id).sort((a,b)=>memberName(a.user_id).localeCompare(memberName(b.user_id),'pl'));
  const mine=rows.find(x=>x.user_id===state.user.id);
  return `<section class="card"><div class="card-header"><div><h2>Wyniki — ${esc(r.name)}</h2><div class="muted small">Każdy członek wpisuje swój wynik.</div></div><button class="btn btn-primary" data-add-result data-race-id="${r.id}">${mine?'Edytuj mój wynik':'+ Dodaj mój wynik'}</button></div>${rows.length?rows.map(x=>`<div class="person-result"><div class="avatar">${esc(memberInitials(x.user_id))}</div><div class="grow"><div class="row-title">${esc(memberName(x.user_id))}</div><div class="row-sub">${x.category?esc(x.category):'Bez kategorii'}${x.note?' • '+esc(x.note):''}</div></div><div class="result-place">${esc(x.result_text)}</div>${x.user_id===state.user.id?`<button class="btn btn-sm" data-edit-result="${x.id}">Edytuj</button>`:''}</div>`).join(''):'<div class="empty">Nikt jeszcze nie wpisał wyniku.</div>'}</section>`;
}
function activityRaceName(a){ return state.races.find(r=>r.id===a.race_id)?.name || a.entity_label || 'wyścig'; }
function activityChanged(a,key){ return Array.isArray(a.changed_fields) && a.changed_fields.includes(key); }
function activityMessage(a){
  const who=esc(activityActorName(a)); const n=a.new_data||{}, o=a.old_data||{}, label=esc(a.entity_label||'');
  if(a.entity_type==='races'){
    if(a.action==='INSERT')return `<b>${who}</b> dodał(a) wyścig <strong>${label}</strong>`;
    if(a.action==='DELETE')return `<b>${who}</b> usunął/usunęła wyścig <strong>${label}</strong>`;
    const hotelFields=['hotel_status','hotel_name','hotel_address','hotel_rooms','hotel_price','hotel_notes','hotel_stay_days','hotel_payment_status','hotel_arrival_days_before'];
    if(hotelFields.some(k=>activityChanged(a,k)))return `<b>${who}</b> zmienił(a) informacje o hotelu przy <strong>${label}</strong>`;
    if(activityChanged(a,'status'))return `<b>${who}</b> zmienił(a) status wyścigu <strong>${label}</strong>`;
    if(activityChanged(a,'race_date')||activityChanged(a,'start_time'))return `<b>${who}</b> zmienił(a) termin wyścigu <strong>${label}</strong>`;
    return `<b>${who}</b> zaktualizował(a) wyścig <strong>${label}</strong>`;
  }
  if(a.entity_type==='race_participants'){
    const target=n.user_id||o.user_id; const status=n.status||o.status;
    return `<b>${who}</b> zmienił(a) skład: <strong>${esc(memberName(target))}</strong>${status?` → ${esc(partStatusLabel(status))}`:''}`;
  }
  if(a.entity_type==='tasks'){
    if(a.action==='INSERT')return `<b>${who}</b> dodał(a) zadanie <strong>${label}</strong>${n.assigned_to?` dla ${esc(memberName(n.assigned_to))}`:''}`;
    if(a.action==='DELETE')return `<b>${who}</b> usunął/usunęła zadanie <strong>${label}</strong>`;
    if(activityChanged(a,'done'))return `<b>${who}</b> oznaczył(a) zadanie <strong>${label}</strong> jako ${n.done?'wykonane':'niewykonane'}`;
    return `<b>${who}</b> zmienił(a) zadanie <strong>${label}</strong>`;
  }
  if(a.entity_type==='expenses'){
    if(a.action==='INSERT')return `<b>${who}</b> dodał(a) koszt <strong>${label}</strong>${n.amount!=null?` — ${PLN.format(Number(n.amount))}`:''}`;
    if(a.action==='DELETE')return `<b>${who}</b> usunął/usunęła koszt <strong>${label}</strong>`;
    return `<b>${who}</b> zmienił(a) koszt <strong>${label}</strong>`;
  }
  if(a.entity_type==='expense_shares'){
    const target=n.user_id||o.user_id; const status=n.settlement_status||o.settlement_status;
    return `<b>${who}</b> zmienił(a) rozliczenie <strong>${esc(memberName(target))}</strong>${status?` → ${esc(settlementLabel(status))}`:''}`;
  }
  if(a.entity_type==='race_vehicles'){
    if(a.action==='INSERT')return `<b>${who}</b> dodał(a) transport <strong>${label}</strong>`;
    if(a.action==='DELETE')return `<b>${who}</b> usunął/usunęła transport <strong>${label}</strong>`;
    return `<b>${who}</b> zmienił(a) transport <strong>${label}</strong>`;
  }
  if(a.entity_type==='packing_items'){
    if(a.action==='INSERT')return `<b>${who}</b> dodał(a) rzecz do zabrania: <strong>${label}</strong>`;
    if(a.action==='DELETE')return `<b>${who}</b> usunął/usunęła z listy: <strong>${label}</strong>`;
    if(activityChanged(a,'done'))return `<b>${who}</b> ${n.done?'oznaczył(a) jako spakowane':'cofnął/cofnęła spakowanie'}: <strong>${label}</strong>`;
    return `<b>${who}</b> zmienił(a) pozycję sprzętu <strong>${label}</strong>`;
  }
  if(a.entity_type==='race_results'){
    const target=n.user_id||o.user_id||a.actor_id;
    if(a.action==='DELETE')return `<b>${who}</b> usunął/usunęła swój wynik z <strong>${esc(activityRaceName(a))}</strong>`;
    return `<b>${who}</b> ${a.action==='INSERT'?'dodał(a)':'zmienił(a)'} wynik <strong>${esc(memberName(target))}</strong>${n.result_text?`: ${esc(n.result_text)}`:''}`;
  }
  if(a.entity_type==='team_members'){
    const target=n.display_name||o.display_name||label;
    return a.action==='INSERT'?`<b>${who}</b> dołączył(a) do ekipy jako <strong>${esc(target)}</strong>`:`<b>${who}</b> zmienił(a) dane członka <strong>${esc(target)}</strong>`;
  }
  return `<b>${who}</b> wprowadził(a) zmianę w aplikacji`;
}
function activityIcon(a){ return ({races:'🏁',race_participants:'👥',tasks:'✓',expenses:'💰',expense_shares:'🤝',race_vehicles:'🚗',packing_items:'📦',race_results:'★',team_members:'👤'})[a.entity_type]||'•'; }
function activityView(){
  const rows=[...state.activity].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const unseenAt=state.activityReadAt?new Date(state.activityReadAt).getTime():0;
  return `<section class="card notification-settings-card"><div class="card-header"><div><h2>🔔 Powiadomienia</h2><div class="muted small">Tutaj ustawiasz banery push na tym urządzeniu. Ustawienie dotyczy tylko telefonu lub komputera, na którym je zmieniasz.</div></div><span class="badge ${state.pushSubscribed?'ok':'neutral'}">${state.pushSubscribed?'włączone':'wyłączone'}</span></div><div class="push-settings">${pushStatusUi()}</div></section><section class="card activity-card"><div class="card-header"><div><h2>Historia aktywności</h2><div class="muted small">Kto, co i kiedy zmienił we wspólnych danych. Prywatne notatki i prywatne nagrody nie są tutaj rejestrowane.</div></div><span class="badge info">${rows.length} wpisów</span></div><div class="activity-list">${rows.length?rows.map(a=>{const unread=a.actor_id!==state.user.id&&new Date(a.created_at).getTime()>unseenAt;return `<div class="activity-row ${unread?'unread':''}"><div class="activity-icon">${activityIcon(a)}</div><div class="grow"><div class="activity-message">${activityMessage(a)}</div><div class="activity-meta">${fmtActivityTime(a.created_at)}${a.race_id&&state.races.some(r=>r.id===a.race_id)?` • <button class="link-btn" data-activity-race="${a.race_id}">Otwórz wyścig</button>`:''}</div></div>${unread?'<span class="activity-dot" title="Nowe"></span>':''}</div>`}).join(''):'<div class="empty"><div class="big">🔔</div>Nie ma jeszcze zapisanych zmian. Nowe wpisy pojawią się tutaj automatycznie.</div>'}</div></section>`;
}
async function markActivityRead(){
  if(state.view!=='activity'||!state.team||!state.user)return;
  const ts=new Date().toISOString();
  if(state.demo){state.activityReadAt=ts;saveDemo();return;}
  const {error}=await supabase.from('activity_reads').upsert({team_id:state.team.id,user_id:state.user.id,last_seen_at:ts},{onConflict:'team_id,user_id'});
  if(!error)state.activityReadAt=ts;
}

function notesView(){
  const notes=[...myPrivateNotes()].sort((a,b)=>String(b.updated_at||b.created_at||'').localeCompare(String(a.updated_at||a.created_at||'')));
  const prizes=[...myPrizeEntries()].sort((a,b)=>String(b.awarded_at||'').localeCompare(String(a.awarded_at||'')));
  const prizeTotal=prizes.reduce((a,x)=>a+Number(x.amount||0),0);
  return `<div class="privacy-banner"><div class="privacy-lock">🔒</div><div><b>Prywatna strefa ${esc(memberName(state.user.id))}</b><p>Te dane widzisz tylko Ty. Inni członkowie ekipy — także administrator — nie mają do nich dostępu.</p></div></div>
    <div class="toolbar"><div class="grow"><h2 style="margin:0">Moje notatki</h2><div class="muted small">Luźne informacje, ustawienia, przypomnienia — tylko dla Ciebie.</div></div><button class="btn btn-primary" data-add-note>+ Nowa notatka</button></div>
    <div class="private-note-grid">${notes.length?notes.map(n=>`<article class="card private-note"><div class="card-header"><h3>${esc(n.title)}</h3><div class="task-actions"><button class="btn btn-sm" data-edit-note="${n.id}">✎</button><button class="btn btn-sm btn-danger" data-delete-note="${n.id}">×</button></div></div><div class="private-note-body">${esc(n.body||'')}</div><div class="row-sub">🔒 Tylko Ty • ${n.updated_at?new Date(n.updated_at).toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):''}</div></article>`).join(''):'<section class="card"><div class="empty">Nie masz jeszcze prywatnych notatek.</div></section>'}</div>
    <details class="toy-sheet private-prize-sheet"><summary>💸 Mój prywatny Excel — nagrody z wyścigów <span class="badge ok">${PLN.format(prizeTotal)}</span></summary><div class="toy-sheet-body"><div class="privacy-hint">🔒 Tylko Ty widzisz te kwoty. To jest Twój prywatny licznik nagród pieniężnych.</div><div class="sheet-actions"><div><div class="sheet-big-total">${PLN.format(prizeTotal)}</div><div class="muted small">wygrane łącznie</div></div><button class="btn btn-primary" data-add-prize>+ Dodaj nagrodę</button></div><div class="sheet-scroll"><table class="mini-sheet"><thead><tr><th>Data</th><th>Wyścig</th><th>Kwota</th><th>Notatka</th><th></th></tr></thead><tbody>${prizes.length?prizes.map(x=>`<tr><td>${fmtDate(x.awarded_at)}</td><td>${esc(x.race_name||resultRace(x.race_id)?.name||'—')}</td><td><b>${PLN.format(Number(x.amount))}</b></td><td>${esc(x.note||'')}</td><td><button class="btn btn-sm" data-edit-prize="${x.id}">✎</button> <button class="btn btn-sm btn-danger" data-delete-prize="${x.id}">×</button></td></tr>`).join(''):'<tr><td colspan="5">Brak nagród.</td></tr>'}<tr class="sheet-total"><td></td><td>SUMA</td><td>${PLN.format(prizeTotal)}</td><td></td><td></td></tr></tbody></table></div></div></details>`;
}

function raceDetailView(r){
  const tabs=[['overview','Podsumowanie'],['squad','Skład'],['hotel','Hotel'],['results','Wyniki'],['tasks','Zadania'],['transport','Transport'],['costs','Koszty'],['packing','Sprzęt']];
  let body=''; if(state.detailTab==='overview')body=detailOverview(r); if(state.detailTab==='squad')body=detailSquad(r); if(state.detailTab==='hotel')body=detailHotel(r); if(state.detailTab==='results')body=detailResults(r); if(state.detailTab==='tasks')body=detailTasks(r); if(state.detailTab==='transport')body=detailTransport(r); if(state.detailTab==='costs')body=detailCosts(r); if(state.detailTab==='packing')body=detailPacking(r);
  return `<div class="detail-head"><div><button class="link-btn" data-nav="races">← Wyścigi</button><h2>${esc(r.name)}</h2><div class="kpi-line">${raceStatusBadge(r)}${hotelBadge(r)}${hotelTimingBadge(r)}<span class="badge">📅 ${fmtDate(r.race_date)}</span><span class="badge">👥 ${participantCount(r.id)} jedzie</span></div></div><div class="detail-actions"><button class="btn" id="icsBtn">+ Kalendarz</button><button class="btn" id="printBtn">Drukuj</button><button class="btn btn-primary" id="editRace">Edytuj</button></div></div>
    <div class="detail-tabs">${tabs.map(([k,l])=>`<button data-detail-tab="${k}" class="${state.detailTab===k?'active':''}">${l}</button>`).join('')}</div>${body}`;
}

function detailOverview(r){
  const done=raceTasks(r.id).filter(t=>t.done).length, all=raceTasks(r.id).length;
  return `<div class="grid two-col"><div class="stack"><section class="card"><div class="card-header"><h2>Informacje</h2></div><div class="info-list"><div class="info-item"><div class="ii">📍</div><div><small>Miejsce wyścigu</small><b>${esc(r.race_address||r.city||'Nieuzupełnione')}</b>${r.race_address?`<div style="margin-top:7px"><button class="link-btn" data-map="${attr(r.race_address)}">Otwórz mapę ↗</button></div>`:''}</div></div><div class="info-item"><div class="ii">⏱</div><div><small>Start</small><b>${fmtDate(r.race_date)} ${r.start_time?'• '+esc(String(r.start_time).slice(0,5)):''}</b></div></div><div class="info-item"><div class="ii">🏷</div><div><small>Kategoria</small><b>${esc(r.category||'—')}</b></div></div>${r.registration_url?`<div class="info-item"><div class="ii">🔗</div><div><small>Zapisy / strona</small><a href="${attr(r.registration_url)}" target="_blank" rel="noopener">Otwórz link ↗</a></div></div>`:''}</div></section>
    <section class="card"><div class="card-header"><h3>Notatka do wyścigu</h3></div><div class="muted" style="white-space:pre-wrap">${esc(r.race_notes||'Brak notatki.')}</div></section></div>
    <div class="stack"><section class="card"><div class="card-header"><h3>Gotowość wyjazdu</h3><b>${taskProgress(r.id)}%</b></div><div class="progress"><span style="width:${taskProgress(r.id)}%"></span></div><div class="separator"></div><div class="info-list"><div class="info-item"><div class="ii">👥</div><div><small>Skład</small><b>${participantCount(r.id)} / ${state.members.length} jedzie</b></div></div><div class="info-item"><div class="ii">✓</div><div><small>Zadania</small><b>${done} / ${all} wykonane</b></div></div><div class="info-item"><div class="ii">💰</div><div><small>Koszty</small><b>${PLN.format(totalExpenses(r.id))}</b></div></div></div></section>
    <section class="card"><div class="card-header"><h3>Hotel</h3>${hotelBadge(r)}</div><b>${esc(r.hotel_name||'Nie wybrano')}</b><p class="muted small">${esc(r.hotel_address||'Brak adresu')}</p>${r.hotel_status&&r.hotel_status!=='brak'?`<p class="hotel-arrival-summary">🌙 Przyjazd: <b>${hotelArrivalLabel(r)}</b> • ${fmtDate(hotelArrivalDate(r))}</p>`:''}<button class="btn btn-sm" data-detail-tab="hotel">Szczegóły hotelu</button></section></div></div>`;
}

function detailSquad(r){
  const parts=raceParts(r.id); return `<section class="card"><div class="card-header"><h2>Skład na wyścig</h2><span class="badge info">${participantCount(r.id)} jedzie</span></div><p class="muted small">Każda osoba może zmienić status. Zmiana pojawi się u całej ekipy.</p>${state.members.map(m=>{const p=parts.find(x=>x.user_id===m.user_id);const s=p?.status||'nieustalone';return `<div class="person-row"><div class="avatar">${esc(memberInitials(m.user_id))}</div><div class="grow"><div class="row-title">${esc(m.display_name)}</div><div class="row-sub">${m.role==='admin'?'Admin':'Ekipa'}</div></div><select class="status-select" data-participant-user="${m.user_id}" data-race="${r.id}"><option value="nieustalone" ${s==='nieustalone'?'selected':''}>Nieustalone</option><option value="jedzie" ${s==='jedzie'?'selected':''}>Jedzie</option><option value="moze" ${s==='moze'?'selected':''}>Może</option><option value="nie_jedzie" ${s==='nie_jedzie'?'selected':''}>Nie jedzie</option></select></div>`}).join('')}</section>`;
}

function detailHotel(r){
  const hotelExpenses=raceExpenses(r.id).filter(e=>e.category==='hotel').sort((a,b)=>String(b.paid_at).localeCompare(String(a.paid_at)));
  return `<div class="grid two-col"><section class="card"><div class="card-header"><h2>Hotel / nocleg</h2>${hotelBadge(r)}</div><div class="info-list"><div class="info-item"><div class="ii">🏨</div><div><small>Nazwa</small><b>${esc(r.hotel_name||'Nie wybrano')}</b></div></div><div class="info-item"><div class="ii">📍</div><div><small>Adres</small><b>${esc(r.hotel_address||'—')}</b>${r.hotel_address?`<div style="margin-top:7px"><button class="link-btn" data-map="${attr(r.hotel_address)}">Otwórz mapę ↗</button></div>`:''}</div></div><div class="info-item"><div class="ii">🛏</div><div><small>Pobyt</small><b>${Number(r.hotel_stay_days||1)===2?'2 dni':'1 dzień'} • ${esc(r.hotel_rooms||'pokoje nieuzupełnione')}</b></div></div><div class="info-item"><div class="ii">🌙</div><div><small>Przyjazd do hotelu</small><b>${hotelArrivalLabel(r)} • ${fmtDate(hotelArrivalDate(r))}</b></div></div><div class="info-item"><div class="ii">💳</div><div><small>Cena</small><b>${r.hotel_price?PLN.format(r.hotel_price):'—'}</b></div></div><div class="info-item"><div class="ii">✓</div><div><small>Ogólny status rozliczenia hotelu</small><select class="inline-select" data-hotel-payment="${r.id}"><option value="nierozliczone" ${(r.hotel_payment_status||'nierozliczone')==='nierozliczone'?'selected':''}>Nierozliczone</option><option value="rozliczone" ${r.hotel_payment_status==='rozliczone'?'selected':''}>Rozliczone</option><option value="na_miejscu" ${r.hotel_payment_status==='na_miejscu'?'selected':''}>Na miejscu</option></select></div></div></div></section><section class="card"><div class="card-header"><h3>Informacje o rezerwacji</h3></div><div class="muted" style="white-space:pre-wrap">${esc(r.hotel_notes||'Brak dodatkowych informacji.')}</div>${r.hotel_url?`<div class="separator"></div><a class="btn" href="${attr(r.hotel_url)}" target="_blank" rel="noopener">Otwórz rezerwację ↗</a>`:''}</section></div>
    <section class="card" style="margin-top:16px"><div class="card-header"><div><h3>Rozliczenie hotelu — osoby</h3><div class="muted small">Status każdej osoby możesz zmienić na: nierozliczone, rozliczone albo na miejscu.</div></div><button class="btn btn-sm" data-detail-tab="costs">Koszty</button></div>${hotelExpenses.length?hotelExpenses.map(expenseCardHtml).join(''):'<div class="empty">Nie ma jeszcze kosztu w kategorii „Hotel”. Dodaj go w zakładce Koszty, a tutaj pojawi się rozliczenie wszystkich zaznaczonych osób.</div>'}</section>`;
}

function detailTasks(r){
  const tasks=raceTasks(r.id).sort((a,b)=>Number(a.done)-Number(b.done) || Number(isTaskOverdue(b))-Number(isTaskOverdue(a)) || String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')));
  return `<div class="grid two-col"><section class="card"><div class="card-header"><h2>Zadania do tego wyścigu</h2><span class="badge">${tasks.filter(t=>t.done).length}/${tasks.length}</span></div>${tasks.length?tasks.map(taskRowHtml).join(''):'<div class="empty">Brak zadań.</div>'}</section><section class="card"><div class="card-header"><h3>Dodaj zadanie</h3></div><form id="taskForm" class="stack"><label>Zadanie<input name="title" required placeholder="np. Zarezerwować hotel"></label><label>Odpowiedzialny<select name="assigned_to" required><option value="">— wybierz osobę —</option>${memberOptions()}</select></label><div class="form-grid"><label>Termin<input type="date" name="due_date" value="${attr(r.race_date)}"></label><label>Priorytet<select name="priority"><option value="normal">Normalne</option><option value="high">Pilne</option><option value="low">Niskie</option></select></label></div><label>Notatka<textarea name="note" placeholder="Dodatkowe informacje…"></textarea></label><button class="btn btn-primary">Dodaj</button></form></section></div>`;
}

function detailTransport(r){
  const cars=raceVehicles(r.id); return `<div class="grid two-col"><section class="card"><div class="card-header"><h2>Samochody</h2><span class="badge">${cars.length}</span></div>${cars.length?cars.map(v=>`<div class="vehicle-row"><div class="ii">🚗</div><div class="grow"><div class="row-title">${esc(v.name)}</div><div class="row-sub">Kierowca: ${esc(memberName(v.driver_id))} • ${v.seats} miejsc${v.departure_place?' • '+esc(v.departure_place):''}${v.departure_time?' • '+new Date(v.departure_time).toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):''}</div>${v.notes?`<div class="row-sub">${esc(v.notes)}</div>`:''}</div><button class="btn btn-sm btn-danger" data-delete-vehicle="${v.id}">×</button></div>`).join(''):'<div class="empty">Nie dodano samochodu.</div>'}<div class="separator"></div><div class="muted small" style="white-space:pre-wrap">${esc(r.transport_notes||'Brak ogólnej notatki transportowej.')}</div></section><section class="card"><div class="card-header"><h3>Dodaj samochód</h3></div><form id="vehicleForm" class="stack"><label>Samochód<input name="name" required placeholder="np. Audi A4"></label><label>Kierowca<select name="driver_id">${memberOptions()}</select></label><div class="form-grid"><label>Miejsca<input type="number" min="1" max="9" name="seats" value="5"></label><label>Wyjazd<input type="datetime-local" name="departure_time"></label></div><label>Miejsce wyjazdu<input name="departure_place" placeholder="np. Jarocin"></label><label>Notatka<textarea name="notes" placeholder="np. bagażnik na 4 rowery"></textarea></label><button class="btn btn-primary">Dodaj</button></form></section></div>`;
}

function balanceData(rid){
  const net={}; state.members.forEach(m=>net[m.user_id]=0);
  raceExpenses(rid).forEach(e=>{
    const shares=state.shares.filter(s=>s.expense_id===e.id && (s.settlement_status||'nierozliczone')==='nierozliczone');
    shares.forEach(s=>{
      if(s.user_id===e.payer_id)return;
      const amount=Number(s.share_amount||0);
      net[s.user_id]=(net[s.user_id]||0)-amount;
      net[e.payer_id]=(net[e.payer_id]||0)+amount;
    });
  });
  const balances=state.members.map(m=>({id:m.user_id,name:m.display_name,net:net[m.user_id]||0}));
  const creditors=balances.filter(x=>x.net>.005).map(x=>({...x})).sort((a,b)=>b.net-a.net), debtors=balances.filter(x=>x.net<-.005).map(x=>({...x,net:-x.net})).sort((a,b)=>b.net-a.net), settlements=[];
  let i=0,j=0; while(i<debtors.length&&j<creditors.length){const a=Math.min(debtors[i].net,creditors[j].net);settlements.push({from:debtors[i].name,to:creditors[j].name,amount:a});debtors[i].net-=a;creditors[j].net-=a;if(debtors[i].net<.01)i++;if(creditors[j].net<.01)j++;}
  return {balances,settlements};
}
function expenseCardHtml(e){
  const shares=state.shares.filter(s=>s.expense_id===e.id).sort((a,b)=>memberName(a.user_id).localeCompare(memberName(b.user_id),'pl'));
  return `<div class="expense-card"><div class="expense-card-head"><div><div class="row-title">${esc(e.description)}</div><div class="row-sub">${esc(categoryName(e.category))} • zapłacił(a): ${esc(memberName(e.payer_id))} • ${fmtDate(e.paid_at)}</div></div><div class="money">${PLN.format(Number(e.amount))}</div><button class="btn btn-sm btn-danger" data-delete-expense="${e.id}">×</button></div><div class="share-grid">${shares.map(s=>`<div class="share-person"><div><b>${esc(memberName(s.user_id))}</b><small>${PLN.format(Number(s.share_amount))}${s.user_id===e.payer_id?' • płatnik':''}</small></div><select data-share-status="${s.id}" class="settlement-select ${settlementClass(s.settlement_status||'nierozliczone')}"><option value="nierozliczone" ${(s.settlement_status||'nierozliczone')==='nierozliczone'?'selected':''}>Nierozliczone</option><option value="rozliczone" ${s.settlement_status==='rozliczone'?'selected':''}>Rozliczone</option><option value="na_miejscu" ${s.settlement_status==='na_miejscu'?'selected':''}>Na miejscu</option></select></div>`).join('')}</div></div>`;
}
function detailCosts(r){
  const ex=raceExpenses(r.id).sort((a,b)=>String(b.paid_at).localeCompare(String(a.paid_at))); const bal=balanceData(r.id);
  const unsettled=state.shares.filter(s=>ex.some(e=>e.id===s.expense_id)&&(s.settlement_status||'nierozliczone')==='nierozliczone').length;
  return `<div class="grid two-col"><div class="stack"><section class="card"><div class="card-header"><div><h2>Koszty</h2><div class="muted small">${unsettled} udziałów nierozliczonych</div></div><b>${PLN.format(totalExpenses(r.id))}</b></div>${ex.length?ex.map(expenseCardHtml).join(''):'<div class="empty">Brak kosztów.</div>'}</section><section class="card"><div class="card-header"><h3>Kto komu — tylko nierozliczone</h3></div>${bal.settlements.length?bal.settlements.map(s=>`<div class="settlement"><span>${esc(s.from)} → ${esc(s.to)}</span><b>${PLN.format(s.amount)}</b></div>`).join(''):'<div class="empty" style="padding:20px">✓ Wszystko rozliczone lub oznaczone „na miejscu”.</div>'}</section></div>
    <section class="card"><div class="card-header"><h3>Dodaj koszt</h3></div><form id="expenseForm" class="stack"><label>Za co<input name="description" required placeholder="np. Hotel"></label><div class="form-grid"><label>Kwota<input name="amount" type="number" min="0" step="0.01" required></label><label>Kategoria<select name="category"><option value="hotel">Hotel</option><option value="paliwo">Paliwo</option><option value="startowe">Startowe</option><option value="jedzenie">Jedzenie</option><option value="parking">Parking</option><option value="drogi">Drogi</option><option value="inne">Inne</option></select></label></div><label>Zapłacił(a)<select name="payer_id">${memberOptions(state.user.id)}</select></label><label>Dotyczy kogo?<div class="stack" style="gap:7px;margin-top:4px">${state.members.map(m=>`<span class="checkbox-line"><input type="checkbox" name="share_user" value="${m.user_id}" ${raceParts(r.id).find(p=>p.user_id===m.user_id&&p.status==='jedzie')?'checked':''}> ${esc(m.display_name)}</span>`).join('')}</div></label><div class="privacy-hint">Po dodaniu kosztu każda zaznaczona osoba dostanie osobny status: nierozliczone / rozliczone / na miejscu.</div><button class="btn btn-primary">Dodaj i podziel równo</button></form></section></div>`;
}

function detailPacking(r){
  const items=racePacking(r.id).sort((a,b)=>Number(a.done)-Number(b.done)); return `<div class="grid two-col"><section class="card"><div class="card-header"><h2>Sprzęt / rzeczy</h2><span class="badge">${items.filter(x=>x.done).length}/${items.length}</span></div>${items.length?items.map(x=>`<div class="packing-row"><input class="check" type="checkbox" data-packing-toggle="${x.id}" ${x.done?'checked':''}><div class="grow"><div class="row-title" style="${x.done?'text-decoration:line-through;opacity:.6':''}">${x.qty>1?x.qty+'× ':''}${esc(x.name)}</div><div class="row-sub">Odpowiada: ${x.owner_id?esc(memberName(x.owner_id)):'—'}</div></div><button class="btn btn-sm btn-danger" data-delete-packing="${x.id}">×</button></div>`).join(''):'<div class="empty">Lista jest pusta.</div>'}</section><section class="card"><div class="card-header"><h3>Dodaj rzecz</h3></div><form id="packingForm" class="stack"><label>Nazwa<input name="name" required placeholder="np. Myjka ciśnieniowa"></label><div class="form-grid"><label>Ilość<input type="number" min="1" name="qty" value="1"></label><label>Kto zabiera<select name="owner_id"><option value="">—</option>${memberOptions()}</select></label></div><button class="btn btn-primary">Dodaj</button></form></section></div>`;
}
function memberOptions(selected=''){return state.members.map(m=>`<option value="${m.user_id}" ${m.user_id===selected?'selected':''}>${esc(m.display_name)}</option>`).join('');}

function bindGlobal(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.nav;state.selectedRaceId=null;if(['dashboard','calendar','races','tasks','results','costs','activity','notes','team'].includes(state.view))history.replaceState(null,'','#'+state.view);render()}));
  document.querySelectorAll('[data-add-race]').forEach(b=>b.addEventListener('click',()=>openRaceModal()));
  document.querySelectorAll('[data-add-team-task]').forEach(b=>b.addEventListener('click',()=>openTaskModal()));
  document.querySelectorAll('[data-task-member]').forEach(b=>b.addEventListener('click',()=>openTaskModal(null,b.dataset.taskMember)));
  document.querySelectorAll('[data-edit-team-task]').forEach(b=>b.addEventListener('click',()=>openTaskModal(state.tasks.find(t=>t.id===b.dataset.editTeamTask))));
  document.querySelectorAll('[data-task-toggle]').forEach(x=>x.addEventListener('change',e=>updateRow('tasks',e.target.dataset.taskToggle,{done:e.target.checked})));
  document.querySelectorAll('[data-delete-task]').forEach(x=>x.addEventListener('click',()=>deleteRow('tasks',x.dataset.deleteTask)));
  document.querySelectorAll('[data-add-result]').forEach(b=>b.addEventListener('click',()=>{const rid=b.dataset.raceId||'';const existing=rid?state.results.find(x=>x.race_id===rid&&x.user_id===state.user.id):null;openResultModal(existing||null,rid)}));
  document.querySelectorAll('[data-edit-result]').forEach(b=>b.addEventListener('click',()=>openResultModal(state.results.find(x=>x.id===b.dataset.editResult))));
  document.querySelectorAll('[data-delete-result]').forEach(b=>b.addEventListener('click',async()=>{if(confirm('Usunąć ten wynik?'))await deleteRow('race_results',b.dataset.deleteResult,'results')}));
  document.querySelectorAll('[data-add-note]').forEach(b=>b.addEventListener('click',()=>openNoteModal()));
  document.querySelectorAll('[data-edit-note]').forEach(b=>b.addEventListener('click',()=>openNoteModal(state.privateNotes.find(x=>x.id===b.dataset.editNote))));
  document.querySelectorAll('[data-delete-note]').forEach(b=>b.addEventListener('click',async()=>{if(confirm('Usunąć prywatną notatkę?'))await deleteRow('private_notes',b.dataset.deleteNote,'privateNotes')}));
  document.querySelectorAll('[data-add-prize]').forEach(b=>b.addEventListener('click',()=>openPrizeModal()));
  document.querySelectorAll('[data-edit-prize]').forEach(b=>b.addEventListener('click',()=>openPrizeModal(state.prizes.find(x=>x.id===b.dataset.editPrize))));
  document.querySelectorAll('[data-delete-prize]').forEach(b=>b.addEventListener('click',async()=>{if(confirm('Usunąć tę nagrodę?'))await deleteRow('prize_entries',b.dataset.deletePrize,'prizes')}));
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
  document.querySelector('#logoutBtn')?.addEventListener('click',async()=>{if(state.demo){toast('W trybie demo wylogowanie jest wyłączone');return;}try{if(state.pushSubscribed)await disablePush();}catch(e){console.warn('Push logout',e);}finally{await supabase.auth.signOut();}});
  document.querySelector('#exportCsv')?.addEventListener('click',exportCsv);
  document.querySelectorAll('[data-push-toggle]').forEach(b=>b.addEventListener('click',()=>state.pushSubscribed?disablePush():enablePush()));
  document.querySelectorAll('[data-activity-race]').forEach(b=>b.addEventListener('click',()=>{state.selectedRaceId=b.dataset.activityRace;state.view='race';state.detailTab='overview';render()}));
  if(state.view==='activity')markActivityRead();
  initMobileNavScroll();
  if(state.view==='race')bindRaceDetail();
}

function initMobileNavScroll(){
  const nav=document.querySelector('#mobileNav');
  const thumb=document.querySelector('#mobileNavProgress');
  const more=document.querySelector('#mobileNavMore');
  if(!nav||!thumb||!more)return;
  const sync=()=>{
    const max=Math.max(0,nav.scrollWidth-nav.clientWidth);
    const track=thumb.parentElement?.clientWidth||0;
    const ratio=nav.scrollWidth?Math.min(1,nav.clientWidth/nav.scrollWidth):1;
    const width=Math.max(34,track*ratio);
    const x=max>0?(track-width)*(nav.scrollLeft/max):0;
    thumb.style.width=`${Math.min(track,width)}px`;
    thumb.style.transform=`translateX(${x}px)`;
    more.classList.toggle('at-end',max<=2||nav.scrollLeft>=max-4);
  };
  nav.addEventListener('scroll',sync,{passive:true});
  window.addEventListener('resize',sync,{passive:true,once:true});
  requestAnimationFrame(()=>{
    sync();
    const active=nav.querySelector('button.active');
    if(active)active.scrollIntoView({block:'nearest',inline:'center'});
    requestAnimationFrame(sync);
  });
}

function bindRaceDetail(){
  const r=selectedRace();
  document.querySelector('#editRace')?.addEventListener('click',()=>openRaceModal(r)); document.querySelector('#printBtn')?.addEventListener('click',()=>window.print()); document.querySelector('#icsBtn')?.addEventListener('click',()=>exportIcs(r));
  document.querySelectorAll('[data-participant-user]').forEach(s=>s.addEventListener('change',async e=>{await upsertParticipant(e.target.dataset.race,e.target.dataset.participantUser,e.target.value)}));
  document.querySelectorAll('[data-packing-toggle]').forEach(x=>x.addEventListener('change',e=>updateRow('packing_items',e.target.dataset.packingToggle,{done:e.target.checked},'packing'))); document.querySelectorAll('[data-delete-packing]').forEach(x=>x.addEventListener('click',()=>deleteRow('packing_items',x.dataset.deletePacking,'packing')));
  document.querySelectorAll('[data-delete-vehicle]').forEach(x=>x.addEventListener('click',()=>deleteRow('race_vehicles',x.dataset.deleteVehicle,'vehicles'))); document.querySelectorAll('[data-delete-expense]').forEach(x=>x.addEventListener('click',()=>deleteExpense(x.dataset.deleteExpense)));
  document.querySelectorAll('[data-share-status]').forEach(x=>x.addEventListener('change',e=>updateRow('expense_shares',e.target.dataset.shareStatus,{settlement_status:e.target.value},'shares')));
  document.querySelectorAll('[data-hotel-payment]').forEach(x=>x.addEventListener('change',e=>updateRow('races',e.target.dataset.hotelPayment,{hotel_payment_status:e.target.value},'races')));
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


function openResultModal(result=null,presetRaceId=''){
  const editing=Boolean(result); const raceId=result?.race_id||presetRaceId||'';
  const sorted=[...state.races].sort((a,b)=>String(b.race_date).localeCompare(String(a.race_date)));
  const el=modal(`<div class="modal"><div class="modal-header"><h2>${editing?'Edytuj mój wynik':'Dodaj mój wynik'}</h2><button class="btn icon-btn" data-close-modal>×</button></div><form id="resultForm"><div class="modal-body"><div class="privacy-hint">Wynik będzie widoczny dla całej ekipy. Edytować może go tylko ${esc(memberName(state.user.id))}.</div><div class="form-grid" style="margin-top:14px"><label class="full">Wyścig z kalendarza<select name="race_id" required><option value="">— wybierz wyścig —</option>${sorted.map(r=>`<option value="${r.id}" ${r.id===raceId?'selected':''}>${esc(r.name)} — ${fmtDate(r.race_date)}</option>`).join('')}</select></label><label>Wynik<input name="result_text" required value="${attr(result?.result_text||'')}" placeholder="np. 3. miejsce / DNF / 12."></label><label>Kategoria<input name="category" value="${attr(result?.category||'')}" placeholder="np. Junior"></label><label class="full">Notatka<textarea name="note" placeholder="Opcjonalnie: przebieg wyścigu, strata, uwagi…">${esc(result?.note||'')}</textarea></label></div></div><div class="modal-footer"><button type="button" class="btn" data-close-modal>Anuluj</button><button class="btn btn-primary">${editing?'Zapisz wynik':'Dodaj wynik'}</button></div></form></div>`);
  el.querySelector('#resultForm').addEventListener('submit',async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));try{await saveResult(result?.id,{race_id:f.race_id,user_id:state.user.id,result_text:f.result_text.trim(),category:f.category?.trim()||null,note:f.note?.trim()||null});el.remove();render();toast('Wynik zapisany');}catch(x){toast(x.message||'Nie udało się zapisać wyniku',true)}});
}
async function saveResult(id,row){
  if(state.demo){const existing=id?state.results.find(x=>x.id===id):state.results.find(x=>x.race_id===row.race_id&&x.user_id===state.user.id);if(existing)Object.assign(existing,row,{updated_at:new Date().toISOString()});else state.results.push({id:uid(),...row,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});saveDemo();return;}
  if(id){const {error}=await supabase.from('race_results').update(row).eq('id',id);if(error)throw error;}else{const {error}=await supabase.from('race_results').upsert(row,{onConflict:'race_id,user_id'});if(error)throw error;}await loadRealData();
}
function openNoteModal(note=null){
  const editing=Boolean(note); const el=modal(`<div class="modal"><div class="modal-header"><h2>${editing?'Edytuj prywatną notatkę':'Nowa prywatna notatka'}</h2><button class="btn icon-btn" data-close-modal>×</button></div><form id="noteForm"><div class="modal-body"><div class="privacy-hint">🔒 Tylko Ty masz dostęp do tej notatki.</div><div class="stack" style="margin-top:14px"><label>Tytuł<input name="title" required value="${attr(note?.title||'')}" placeholder="np. Ustawienia opon"></label><label>Treść<textarea name="body" style="min-height:220px" placeholder="Zapisz cokolwiek dla siebie…">${esc(note?.body||'')}</textarea></label></div></div><div class="modal-footer"><button type="button" class="btn" data-close-modal>Anuluj</button><button class="btn btn-primary">Zapisz</button></div></form></div>`);
  el.querySelector('#noteForm').addEventListener('submit',async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));try{await savePrivateNote(note?.id,{user_id:state.user.id,title:f.title.trim(),body:f.body?.trim()||null});el.remove();render();toast('Prywatna notatka zapisana');}catch(x){toast(x.message,true)}});
}
async function savePrivateNote(id,row){
  if(state.demo){if(id){const n=state.privateNotes.find(x=>x.id===id);if(n)Object.assign(n,row,{updated_at:new Date().toISOString()});}else state.privateNotes.push({id:uid(),...row,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});saveDemo();return;}
  if(id){const {error}=await supabase.from('private_notes').update(row).eq('id',id);if(error)throw error;}else{const {error}=await supabase.from('private_notes').insert(row);if(error)throw error;}await loadRealData();
}
function openPrizeModal(entry=null){
  const editing=Boolean(entry); const raceId=entry?.race_id||''; const sorted=[...state.races].sort((a,b)=>String(b.race_date).localeCompare(String(a.race_date)));
  const el=modal(`<div class="modal"><div class="modal-header"><h2>${editing?'Edytuj nagrodę':'Dodaj nagrodę pieniężną'}</h2><button class="btn icon-btn" data-close-modal>×</button></div><form id="prizeForm"><div class="modal-body"><div class="privacy-hint">🔒 Ten arkusz i wszystkie kwoty są widoczne wyłącznie dla Ciebie.</div><div class="form-grid" style="margin-top:14px"><label class="full">Wyścig<select name="race_id"><option value="">— inny / bez wyścigu z kalendarza —</option>${sorted.map(r=>`<option value="${r.id}" ${r.id===raceId?'selected':''}>${esc(r.name)} — ${fmtDate(r.race_date)}</option>`).join('')}</select></label><label class="full">Nazwa ręczna (opcjonalnie)<input name="race_name" value="${attr(entry?.race_name||'')}" placeholder="Używana, jeśli nie wybierzesz wyścigu"></label><label>Kwota nagrody<input name="amount" type="number" min="0" step="0.01" required value="${attr(entry?.amount||'')}"></label><label>Data<input name="awarded_at" type="date" required value="${attr(entry?.awarded_at||isoDate(new Date()))}"></label><label class="full">Notatka<input name="note" value="${attr(entry?.note||'')}" placeholder="np. premia za podium"></label></div></div><div class="modal-footer"><button type="button" class="btn" data-close-modal>Anuluj</button><button class="btn btn-primary">Zapisz</button></div></form></div>`);
  el.querySelector('#prizeForm').addEventListener('submit',async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));const rr=state.races.find(r=>r.id===f.race_id);const row={user_id:state.user.id,race_id:f.race_id||null,race_name:rr?.name||f.race_name?.trim()||null,amount:Number(f.amount),awarded_at:f.awarded_at,note:f.note?.trim()||null};try{await savePrize(entry?.id,row);el.remove();render();toast('Nagroda zapisana');}catch(x){toast(x.message,true)}});
}
async function savePrize(id,row){
  if(state.demo){if(id){const x=state.prizes.find(v=>v.id===id);if(x)Object.assign(x,row);}else state.prizes.push({id:uid(),...row,created_at:new Date().toISOString()});saveDemo();return;}
  if(id){const {error}=await supabase.from('prize_entries').update(row).eq('id',id);if(error)throw error;}else{const {error}=await supabase.from('prize_entries').insert(row);if(error)throw error;}await loadRealData();
}

function openRaceModal(r=null){
  const editing=Boolean(r); const el=modal(`<div class="modal"><div class="modal-header"><h2>${editing?'Edytuj wyścig':'Dodaj nowy wyścig'}</h2><button class="btn icon-btn" data-close-modal>×</button></div><form id="raceForm"><div class="modal-body"><div class="form-grid">
    <label class="full">Nazwa wyścigu<input name="name" required value="${attr(r?.name||'')}" placeholder="np. Puchar Polski CX — Szczekociny"></label><label>Data<input type="date" name="race_date" required value="${attr(r?.race_date||isoDate(new Date()))}"></label><label>Godzina startu<input type="time" name="start_time" value="${attr(String(r?.start_time||'').slice(0,5))}"></label><label>Miejscowość<input name="city" value="${attr(r?.city||'')}"></label><label>Kategoria<input name="category" value="${attr(r?.category||'')}"></label><label class="full">Dokładna lokalizacja wyścigu<input name="race_address" value="${attr(r?.race_address||'')}"></label><label>Link do zapisów / strony<input type="url" name="registration_url" value="${attr(r?.registration_url||'')}"></label><label>Status<select name="status"><option value="planowany" ${r?.status==='planowany'?'selected':''}>Planowany</option><option value="potwierdzony" ${r?.status==='potwierdzony'?'selected':''}>Potwierdzony</option><option value="zakonczony" ${r?.status==='zakonczony'?'selected':''}>Zakończony</option><option value="odwolany" ${r?.status==='odwolany'?'selected':''}>Odwołany</option></select></label>
    <label>Hotel — status<select name="hotel_status"><option value="brak" ${(!r||r.hotel_status==='brak')?'selected':''}>Brak</option><option value="szukamy" ${r?.hotel_status==='szukamy'?'selected':''}>Szukamy</option><option value="zarezerwowany" ${r?.hotel_status==='zarezerwowany'?'selected':''}>Zarezerwowany</option><option value="oplacony" ${r?.hotel_status==='oplacony'?'selected':''}>Opłacony</option></select></label><label>Pobyt hotelowy<select name="hotel_stay_days"><option value="1" ${Number(r?.hotel_stay_days||1)===1?'selected':''}>1 dzień</option><option value="2" ${Number(r?.hotel_stay_days||1)===2?'selected':''}>2 dni</option></select></label><label>Przyjazd do hotelu<select name="hotel_arrival_days_before"><option value="0" ${Number(r?.hotel_arrival_days_before??1)===0?'selected':''}>W dniu wyścigu</option><option value="1" ${Number(r?.hotel_arrival_days_before??1)===1?'selected':''}>Dzień przed wyścigiem</option><option value="2" ${Number(r?.hotel_arrival_days_before??1)===2?'selected':''}>2 dni przed</option><option value="3" ${Number(r?.hotel_arrival_days_before??1)===3?'selected':''}>3 dni przed</option><option value="4" ${Number(r?.hotel_arrival_days_before??1)===4?'selected':''}>4 dni przed</option><option value="5" ${Number(r?.hotel_arrival_days_before??1)===5?'selected':''}>5 dni przed</option><option value="6" ${Number(r?.hotel_arrival_days_before??1)===6?'selected':''}>6 dni przed</option><option value="7" ${Number(r?.hotel_arrival_days_before??1)===7?'selected':''}>7 dni przed</option></select></label><label>Rozliczenie hotelu<select name="hotel_payment_status"><option value="nierozliczone" ${(r?.hotel_payment_status||'nierozliczone')==='nierozliczone'?'selected':''}>Nierozliczone</option><option value="rozliczone" ${r?.hotel_payment_status==='rozliczone'?'selected':''}>Rozliczone</option><option value="na_miejscu" ${r?.hotel_payment_status==='na_miejscu'?'selected':''}>Na miejscu</option></select></label><label>Hotel — nazwa<input name="hotel_name" value="${attr(r?.hotel_name||'')}"></label><label class="full">Hotel — adres<input name="hotel_address" value="${attr(r?.hotel_address||'')}"></label><label>Pokoje<input name="hotel_rooms" value="${attr(r?.hotel_rooms||'')}" placeholder="np. 2×2 + 1×1"></label><label>Cena hotelu<input type="number" min="0" step="0.01" name="hotel_price" value="${attr(r?.hotel_price||'')}"></label><label class="full">Link do hotelu / rezerwacji<input type="url" name="hotel_url" value="${attr(r?.hotel_url||'')}"></label><label class="full">Notatka hotelowa<textarea name="hotel_notes">${esc(r?.hotel_notes||'')}</textarea></label><label class="full">Notatki o wyścigu<textarea name="race_notes">${esc(r?.race_notes||'')}</textarea></label><label class="full">Notatki transportowe<textarea name="transport_notes">${esc(r?.transport_notes||'')}</textarea></label>
    </div></div><div class="modal-footer">${editing?'<button type="button" class="btn btn-danger" id="deleteRace">Usuń wyścig</button>':''}<button type="button" class="btn" data-close-modal>Anuluj</button><button class="btn btn-primary">${editing?'Zapisz zmiany':'Dodaj wyścig'}</button></div></form></div>`);
  el.querySelector('#raceForm').addEventListener('submit',async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.currentTarget));const row={team_id:state.team.id,name:f.name,race_date:f.race_date,start_time:f.start_time||null,city:f.city||null,category:f.category||null,race_address:f.race_address||null,registration_url:f.registration_url||null,status:f.status,hotel_status:f.hotel_status,hotel_stay_days:Number(f.hotel_stay_days||1),hotel_arrival_days_before:Number(f.hotel_arrival_days_before??1),hotel_payment_status:f.hotel_payment_status||'nierozliczone',hotel_name:f.hotel_name||null,hotel_address:f.hotel_address||null,hotel_rooms:f.hotel_rooms||null,hotel_price:f.hotel_price?Number(f.hotel_price):null,hotel_url:f.hotel_url||null,hotel_notes:f.hotel_notes||null,race_notes:f.race_notes||null,transport_notes:f.transport_notes||null};try{if(editing)await saveRaceEdit(r.id,row);else await createRace(row);el.remove();render();toast(editing?'Zapisano zmiany':'Dodano wyścig');}catch(x){toast(x.message,true)}});
  el.querySelector('#deleteRace')?.addEventListener('click',async()=>{if(!confirm('Usunąć cały wyścig razem z kosztami, zadaniami i składem?'))return;try{await deleteRace(r.id);el.remove();state.view='races';state.selectedRaceId=null;render();toast('Wyścig usunięty')}catch(x){toast(x.message,true)}});
}

async function createRace(row){
  if(state.demo){const r={id:uid(),...row,end_date:row.race_date,created_at:new Date().toISOString()};state.races.push(r);state.members.forEach(m=>state.participants.push({id:uid(),race_id:r.id,user_id:m.user_id,status:'nieustalone'}));saveDemo();return;}
  const {data,error}=await supabase.from('races').insert({...row,created_by:state.user.id}).select().single();if(error)throw error;await Promise.all(state.members.map(m=>supabase.from('race_participants').insert({race_id:data.id,user_id:m.user_id,status:'nieustalone'})));await loadRealData();
}
async function saveRaceEdit(id,row){if(state.demo){const i=state.races.findIndex(x=>x.id===id);state.races[i]={...state.races[i],...row};saveDemo();return;}const {error}=await supabase.from('races').update(row).eq('id',id);if(error)throw error;await loadRealData();}
async function deleteRace(id){if(state.demo){state.races=state.races.filter(x=>x.id!==id);state.participants=state.participants.filter(x=>x.race_id!==id);state.tasks=state.tasks.filter(x=>x.race_id!==id);const exIds=new Set(state.expenses.filter(x=>x.race_id===id).map(x=>x.id));state.expenses=state.expenses.filter(x=>x.race_id!==id);state.shares=state.shares.filter(x=>!exIds.has(x.expense_id));state.vehicles=state.vehicles.filter(x=>x.race_id!==id);state.packing=state.packing.filter(x=>x.race_id!==id);state.results=state.results.filter(x=>x.race_id!==id);state.prizes=state.prizes.map(x=>x.race_id===id?{...x,race_id:null}:x);saveDemo();return;}const {error}=await supabase.from('races').delete().eq('id',id);if(error)throw error;await loadRealData();}
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
  if(state.demo){const id=uid();state.expenses.push({id,...row});let remaining=amount;users.forEach((u,i)=>{const share=i===users.length-1?Math.round(remaining*100)/100:per;remaining-=share;state.shares.push({id:uid(),expense_id:id,user_id:u,share_amount:share,settlement_status:u===row.payer_id?'rozliczone':'nierozliczone'})});saveDemo();render();return;}
  const {data,error}=await supabase.from('expenses').insert(row).select().single();if(error){toast(error.message,true);return;}let remaining=amount;const shares=users.map((u,i)=>{const share=i===users.length-1?Math.round(remaining*100)/100:per;remaining-=share;return{expense_id:data.id,user_id:u,share_amount:share,settlement_status:u===row.payer_id?'rozliczone':'nierozliczone'}});const {error:se}=await supabase.from('expense_shares').insert(shares);if(se)toast(se.message,true);await loadRealData();render();
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
