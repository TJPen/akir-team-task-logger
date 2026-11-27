import {dailyVerse} from './daily-verse.js';
import {celebrateCompletion,clearCelebration} from './celebration.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const companies={akir:'Akir Enterprises',xpress:'Xpress One Labs – Alabama'},people=['Ms. Tay','TJ','Felicia'];
let state={tasks:[],devices:[]},company='all',status='open',special='',editing=null,registration=null,toastTimer,openedDeepLink=false,viewGeneration=0;
const initials=p=>p==='Ms. Tay'?'MT':p==='TJ'?'TJ':'F';
const cls=p=>p==='Ms. Tay'?'':p==='TJ'?'tj':'felicia';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,method='GET',data){const r=await fetch('/api'+path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,credentials:'same-origin'});const b=await r.json();if(!r.ok){if(r.status===401&&path!='/login')showLogin();throw Error(b.error||'Unable to save. Try again.');}return b;}
function toast(text,completed=false){$('#toast').classList.toggle('completion-toast',completed);$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function showLogin(){clearCelebration();viewGeneration++;state={tasks:[],devices:[]};editing=null;openedDeepLink=false;company='all';status='open';special='';$('#task-list').replaceChildren();$('#task-form').reset();$('#search').value='';$('#person-filter').value='all';document.body.dataset.company='all';$('#login-view').hidden=false;$('#app-view').hidden=true;$$('dialog[open]').forEach(d=>d.close());}
async function load(){const generation=viewGeneration;const next=await api('/state');if(generation!==viewGeneration)return;state=next;$('#login-view').hidden=true;$('#app-view').hidden=false;$('#today-label').textContent=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric'}).format(new Date());render();if(!openedDeepLink){openedDeepLink=true;const task=state.tasks.find(t=>t.id===new URLSearchParams(location.search).get('task'));if(task)openTask(task);}}
function render(){
 document.body.dataset.company=company;
 const admin=state.user.role==='admin';$('#rail-avatar').textContent=initials(state.user.name);$('#rail-name').textContent=state.user.name;$('.rail-team').title=state.user.name;$('.rail-item[data-company=all]').title=admin?'All tasks':'My tasks';$('#account-label').textContent=state.user.name+(admin?' · Admin':'');$('#nav-task-label').textContent=admin?'All tasks':'My tasks';$('#person-filter').hidden=!admin;$('#person-filter').value=admin?$('#person-filter').value:'all';$('#phone-person').value=state.user.name;
 const base=state.tasks.filter(t=>company==='all'||t.company===company),open=base.filter(t=>t.status==='open'),done=base.filter(t=>t.status==='done');
 $('#stat-open').textContent=open.length;$('#stat-today').textContent=open.filter(t=>t.due_date===state.today).length;$('#stat-overdue').textContent=open.filter(t=>t.due_date<state.today).length;$('#stat-done').textContent=done.length;$('#open-count').textContent=open.length;$('#done-count').textContent=done.length;$('#all-count').textContent=state.tasks.filter(t=>t.status==='open').length;
 $('#board-title').textContent='Good morning, '+state.user.name+'.';
 const verse=dailyVerse(state.today);
 $('#daily-verse-text').textContent='“'+verse.text+'”';
 $('#daily-verse-reference').textContent=verse.reference+' · KJV';
 $('#breadcrumb').textContent=company==='all'?(admin?'All tasks':'My tasks'):companies[company];
 const percent=base.length?Math.round(done.length/base.length*100):0;
 $('#completion-label').textContent=percent+'% of '+base.length+' '+(base.length===1?'task':'tasks');
 $('#completion-segments').innerHTML=Array.from({length:10},(_,i)=>'<i class="'+(i<Math.round(percent/10)?'filled':'')+'"></i>').join('');
 const days=Array.from({length:7},(_,i)=>{const date=new Date(Date.parse(state.today+'T12:00:00Z')+i*86400000);const iso=date.toISOString().slice(0,10);return {count:open.filter(t=>t.due_date===iso).length,label:i===0?'Today':new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'UTC'}).format(date),date:iso.slice(5).replace('-','/')};});
 const max=Math.max(1,...days.map(d=>d.count));
 $('#week-chart').innerHTML=days.map(d=>'<div class="day-column" aria-label="'+d.label+' '+d.date+': '+d.count+' open tasks due"><span class="day-count">'+d.count+'</span><div class="day-track"><i style="height:'+Math.max(6,d.count/max*100)+'%" class="'+(d.count?'has-tasks':'')+'"></i></div><strong>'+d.label+'</strong><small>'+d.date+'</small></div>').join('');
 const person=$('#person-filter').value,q=$('#search').value.trim().toLowerCase();
 const tasks=base.filter(t=>t.status===status&&(person==='all'||t.assignee===person)&&(!q||(t.description+' '+companies[t.company]+' '+t.assignee).toLowerCase().includes(q))&&(!special||(special==='today'?t.due_date===state.today:t.due_date<state.today)));
 $('#task-list').innerHTML=tasks.map(t=>{
 const due=t.due_date===state.today?'Today':t.due_date===tomorrow()?'Tomorrow':new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(t.due_date+'T12:00:00Z'));
 const overdue=t.status==='open'&&t.due_date<state.today;
 const notify=t.status==='done'?'':!state.devices.some(d=>d.person===t.assignee)?'Phone setup needed':t.notification_state==='accepted'?'Push service accepted':t.notification_state==='expired'?'Reminder expired':'Reminder queued';
 return `<article class="task-row ${t.status==='done'?'done-row':overdue?'overdue-row':''}"><div class="task-main"><button class="task-check ${t.status==='done'?'done':''}" data-toggle="${t.id}" aria-label="${t.status==='done'?'Reopen':'Complete'} task: ${escape(t.description.slice(0,80))}">${t.status==='done'?'✓':''}</button><div><p class="task-title">${escape(t.description)}</p><div class="task-meta"><span class="badge ${t.company}">${escape(companies[t.company])}</span><span class="push-status">${notify}</span></div></div></div><div class="assignee"><span class="avatar ${cls(t.assignee)}">${initials(t.assignee)}</span>${escape(t.assignee)}</div><div class="due ${overdue?'overdue':t.due_date===state.today?'today':''}">${overdue?'<span class="overdue-label">Overdue</span>':''}${due}</div><button class="edit-task" data-edit="${t.id}" aria-label="Edit task: ${escape(t.description.slice(0,80))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/></svg></button></article>`;
 }).join('');
 $('#empty').hidden=tasks.length>0;$('#empty h2').textContent=state.tasks.length===0?'A clear desk. A fresh start.':status==='done'?'Good work starts here.':'All clear in this view.';$('#empty p').innerHTML=state.tasks.length===0?'Add your first task, pick a teammate,<br>and we’ll help keep it on track.':status==='done'?'Completed tasks will appear here.':'No tasks match these filters.<br>Choose another view or add a task.';
 $('#result-count').textContent=tasks.length+' '+(tasks.length===1?'task':'tasks')+(special==='today'?' · Due today':special==='overdue'?' · Overdue':'');
 $$('[data-status]').forEach(b=>b.classList.toggle('active',b.dataset.status===status));$$('button[data-company]').forEach(b=>{b.classList.toggle('selected',b.dataset.company===company);b.setAttribute('aria-pressed',String(b.dataset.company===company));});$$('[data-stat]').forEach(b=>{const active=b.dataset.stat===special||(b.dataset.stat==='done'&&status==='done')||(b.dataset.stat==='open'&&status==='open'&&!special);b.setAttribute('aria-pressed',String(active));});
 $('#team-devices').innerHTML=people.map(p=>{const count=state.devices.find(d=>d.person===p)?.count||0;return `<div class="device-row"><span class="assignee"><span class="avatar ${cls(p)}">${initials(p)}</span>${p}</span><span>${count?count+' enabled '+(count===1?'device':'devices'):'Not set up yet'}</span></div>`;}).join('');
}
function tomorrow(){return new Date(Date.parse(state.today+'T12:00:00Z')+86400000).toISOString().slice(0,10);}
function notice(){const p=$('#assignee').value,count=state.devices.find(d=>d.person===p)?.count||0;$('#assignee-notice').textContent=!p?'Choose a teammate to check their phone setup.':count?`${p} has ${count} enabled ${count===1?'device':'devices'}. We’ll queue a phone notification when you save.`:`${p} hasn’t enabled phone notifications yet. You can save the task now; ask them to open Phone setup.`;}
function openTask(t=null){editing=t;$('#task-form').reset();$('#task-dialog-title').textContent=t?'Edit task':'Add a task';$('#save-task').textContent=t?'Save changes':'Create task';$('#company').value=t?.company||(company==='all'?'akir':company);$('#assignee').value=t?.assignee||'';$('#due-date').value=t?.due_date||state.today;$('#description').value=t?.description||'';$('#char-count').textContent=$('#description').value.length+' / 2,000';$('#task-error').textContent='';notice();$('#task-dialog').showModal();}
$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;$('#login-error').textContent='';try{await api('/login','POST',{password:$('#password').value});$('#password').value='';await load();}catch(e){$('#login-error').textContent=e.message;}finally{b.disabled=false;}});
$('#logout').onclick=async()=>{try{const sub=registration?await registration.pushManager.getSubscription().catch(()=>null):null;await api('/logout','POST',{endpoint:sub?.endpoint});showLogin();if(sub)await sub.unsubscribe().catch(()=>{});localStorage.removeItem('team-phone-person');toast('Signed out. Notifications on this device are disconnected.');}catch(e){toast(e.message);}};
$$('button[data-company]').forEach(b=>b.onclick=()=>{company=b.dataset.company;special='';render();});
$$('[data-status]').forEach(b=>b.onclick=()=>{status=b.dataset.status;special='';render();});
$$('[data-stat]').forEach(b=>b.onclick=()=>{status=b.dataset.stat==='done'?'done':'open';special=['today','overdue'].includes(b.dataset.stat)?b.dataset.stat:'';render();});
$('#person-filter').onchange=render;$('#search').oninput=render;$('#new-task').onclick=()=>openTask();$('#empty-add').onclick=()=>openTask();$('#refresh').onclick=()=>load().then(()=>toast('Workspace refreshed.')).catch(e=>toast(e.message));
$$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());$('#assignee').onchange=notice;$('#description').oninput=()=>$('#char-count').textContent=$('#description').value.length+' / 2,000';
$('#task-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;$('#task-error').textContent='';try{const data={company:$('#company').value,assignee:$('#assignee').value,due_date:$('#due-date').value,description:$('#description').value};if(editing)data.version=editing.version;await api(editing?'/tasks/'+editing.id:'/tasks',editing?'PATCH':'POST',data);$('#task-dialog').close();await load();toast(state.user.role!=='admin'&&data.assignee!==state.user.name?`Assigned to ${data.assignee}. It will appear in their task list.`:editing?'Task updated.':'Task created. Your team’s on it.');}catch(e){$('#task-error').textContent=e.message;}finally{b.disabled=false;}});
$('#task-list').onclick=async e=>{const edit=e.target.closest('[data-edit]'),toggle=e.target.closest('[data-toggle]');if(edit){openTask(state.tasks.find(t=>t.id===edit.dataset.edit));return;}if(toggle){const t=state.tasks.find(t=>t.id===toggle.dataset.toggle),completing=t.status==='open',generation=viewGeneration;
toggle.disabled=true;
try{
  await api('/tasks/'+t.id,'PATCH',{version:t.version,status:completing?'done':'open'});
  if(generation!==viewGeneration)return;
  toast(completing?'Task complete. Nice work!':'Task reopened.',completing);
  if(completing){try{celebrateCompletion(toggle.getBoundingClientRect());}catch{clearCelebration();}}
  try{await load();}catch{toast('Saved. Refresh the board to see the latest task list.');}
}catch(e){toast(e.message);await load().catch(()=>{});}finally{toggle.disabled=false;}}};
async function setupWorker(){if('serviceWorker' in navigator){registration=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;}}
const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
async function deviceStatus(){
 $('#phone-error').textContent='';$('#test-push').disabled=true;$('#disable-push').hidden=true;
 if(ios()&&!matchMedia('(display-mode: standalone)').matches&&!navigator.standalone){$('#device-status').textContent='On this iPhone or iPad, add the app to your Home Screen first, then open that icon to enable notifications.';$('#enable-push').disabled=true;return;}
 if(!('PushManager' in window)||!('Notification' in window)||!registration){$('#device-status').textContent='This browser cannot enable push notifications. Open the app in Safari on iPhone (from your Home Screen), or Chrome on Android.';$('#enable-push').disabled=true;return;}
 $('#enable-push').disabled=false;
 const sub=await registration.pushManager.getSubscription();
 if(sub){const saved=localStorage.getItem('team-phone-person');$('#phone-person').value=state.user.name;$('#device-status').textContent=saved===state.user.name?`This device is set up for ${saved}. Save phone setup if you have not done so since the account update.`:`Enable notifications to connect this device to ${state.user.name}.`;$('#test-push').disabled=saved!==state.user.name;$('#disable-push').hidden=false;$('#enable-push').textContent='Save phone setup';}
 else{$('#device-status').textContent=Notification.permission==='denied'?'Notifications are blocked. Allow them in your browser or phone settings, then return here.':`Signed in as ${state.user.name}. Tap Enable notifications.`;$('#enable-push').textContent='Enable notifications';}
}
async function openPhone(){$('#phone-dialog').showModal();try{if(!registration)await setupWorker();await deviceStatus();}catch{$('#device-status').textContent='Unable to prepare notifications. Refresh this page and try again.';}}
$('#phone-open').onclick=openPhone;$('#phone-note').onclick=openPhone;
$('#enable-push').onclick=async()=>{const person=state.user.name;if(!person){$('#phone-error').textContent='Choose whose phone this is first.';return;}const btn=$('#enable-push');btn.disabled=true;$('#phone-error').textContent='';try{
 const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications were not allowed. You can enable them in your phone settings.');
 let sub=await registration.pushManager.getSubscription();if(sub&&localStorage.getItem('team-phone-person')!==person){await sub.unsubscribe();sub=null;}if(!sub){const key=Uint8Array.from(atob(state.vapid.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});}
 await api('/subscriptions','POST',{person,subscription:sub.toJSON()});localStorage.setItem('team-phone-person',person);await load();await deviceStatus();toast('Phone connected. Tap Send a test to check it.');
 }catch(e){$('#phone-error').textContent=e.message;}finally{btn.disabled=false;}};
$('#test-push').onclick=async()=>{const btn=$('#test-push');btn.disabled=true;try{const sub=await registration.pushManager.getSubscription();await api('/push-test','POST',{endpoint:sub?.endpoint});toast('Test accepted by your push service. Look for a notification.');}catch(e){$('#phone-error').textContent=e.message;}finally{btn.disabled=false;}};
$('#disable-push').onclick=async()=>{try{const sub=await registration.pushManager.getSubscription();if(sub){await api('/subscriptions/remove','POST',{endpoint:sub.endpoint});await sub.unsubscribe();}localStorage.removeItem('team-phone-person');await load();await deviceStatus();toast('This phone has been disconnected.');}catch(e){$('#phone-error').textContent=e.message;}};
$('#phone-logout').onclick=()=>$('#logout').click();
load().catch(()=>showLogin());setupWorker().catch(()=>{});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearCelebration();if(document.visibilityState==='visible'&&!$('#app-view').hidden)load().catch(()=>{});});
setInterval(()=>{if(!$('#app-view').hidden&&!document.hidden&&!$$('dialog[open]').length)load().catch(()=>{});},60000);
