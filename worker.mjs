import {ASSETS} from './assets.mjs';
import {bytes,b64,unb64,validEndpoint,sendPush} from './push.mjs';
export const PEOPLE=['Ms. Tay','TJ','Felicia'];
const COMPANIES={akir:'Akir Enterprises',xpress:'Xpress One Labs – Alabama'};
const DAY=86400000;
const json=(data,status=200,headers={})=>Response.json(data,{status,headers});
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
export function centralDate(time=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(time);}
export function morning(date){
 const utc=Date.parse(date+'T09:00:00Z');
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'2-digit',hourCycle:'h23'}).format(utc));
 return utc+(9-hour)*3600000;
}
export function validateTask(b){
 if(!Object.hasOwn(COMPANIES,b.company)||!PEOPLE.includes(b.assignee)) fail('Choose a company and team member.');
 if(typeof b.description!=='string'||!b.description.trim()||b.description.trim().length>2000) fail('Enter a task description of 1–2,000 characters.');
 if(typeof b.due_date!=='string'||!/^20\d\d-\d{2}-\d{2}$/.test(b.due_date)||!Number.isFinite(Date.parse(b.due_date+'T12:00:00Z'))||new Date(b.due_date+'T12:00:00Z').toISOString().slice(0,10)!==b.due_date) fail('Choose a valid due date.');
 return {company:b.company,assignee:b.assignee,due_date:b.due_date,description:b.description.trim()};
}
async function hash(s){return b64(await crypto.subtle.digest('SHA-256',bytes(s)));}
async function hmac(s,secret){const k=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(await crypto.subtle.sign('HMAC',k,bytes(s)));}
async function passwordMatches(s,secret){const k=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);const sig=await crypto.subtle.sign('HMAC',k,bytes(secret));return crypto.subtle.verify('HMAC',k,sig,bytes(s));}
async function body(req){
 if(!req.headers.get('content-type')?.startsWith('application/json')) fail('JSON required.',415);
 const reader=req.body?.getReader();if(!reader)fail('Request body required.');let n=0,chunks=[];
 while(true){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>12000){await reader.cancel();fail('Request is too large.',413);}chunks.push(value);}
 const all=new Uint8Array(n);let i=0;for(const x of chunks){all.set(x,i);i+=x.length;}
 try{const value=JSON.parse(new TextDecoder().decode(all));if(!value||typeof value!=='object'||Array.isArray(value))fail('JSON object required.');return value;}catch{fail('Invalid JSON object.');}
}
function cookie(req){return req.headers.get('cookie')?.match(/(?:^|;\s*)team_session=([A-Za-z0-9_-]+)/)?.[1];}
async function session(req,env){const token=cookie(req);if(!token)return false;const row=await env.DB.prepare('SELECT person FROM sessions WHERE id=? AND expires_at>?').bind(await hash(token),Date.now()).first();return row&&PEOPLE.includes(row.person)?{name:row.person,role:row.person==='TJ'?'admin':'member'}:null;}
function jobStatements(env,t,kind,now,expectedVersion=t.version){
 const before=new Date(Date.parse(t.due_date+'T12:00:00Z')-DAY).toISOString().slice(0,10);
 const specs=[[kind,now,now+DAY],['before',morning(before),morning(before)+DAY],['due',morning(t.due_date),morning(t.due_date)+DAY]];
 return specs.filter(([k,at])=>k===kind||at>now).map(([k,at,expiry])=>env.DB.prepare("INSERT OR IGNORE INTO jobs(id,task_id,version,kind,run_at,expires_at) SELECT ?,id,version,?,?,? FROM tasks WHERE id=? AND version=? AND status='open'").bind(`${t.id}:${expectedVersion}:${k}`,k,at,expiry,t.id,expectedVersion));
}
export async function processJobs(env,now=Date.now()){
 await env.DB.batch([
 env.DB.prepare("UPDATE jobs SET state='expired',last_error=COALESCE(last_error,'No enabled phone before reminder expired') WHERE state='pending' AND expires_at<=?").bind(now),
 env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now),env.DB.prepare('DELETE FROM login_limits WHERE expires_at<?').bind(now)]);
 const {results:jobs}=await env.DB.prepare("SELECT * FROM jobs WHERE state='pending' AND run_at<=? AND expires_at>? AND lease_until<? ORDER BY run_at LIMIT 12").bind(now,now,now).all();
 for(const job of jobs){
 const claim=await env.DB.prepare("UPDATE jobs SET lease_until=?,attempts=attempts+1 WHERE id=? AND state='pending' AND lease_until<?").bind(now+120000,job.id,now).run();if(!claim.meta.changes)continue;
 const t=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(job.task_id).first();
 if(!t||t.status!=='open'||t.version!==job.version){await env.DB.prepare("UPDATE jobs SET state='cancelled' WHERE id=?").bind(job.id).run();continue;}
 const {results:subs}=await env.DB.prepare('SELECT * FROM subscriptions WHERE person=? AND verified=1 LIMIT 10').bind(t.assignee).all();
 let pending=subs.length===0, error=pending?'Waiting for an enabled phone':null;
 for(const sub of subs){
 if(await env.DB.prepare('SELECT job_id FROM deliveries WHERE job_id=? AND subscription_id=?').bind(job.id,sub.id).first())continue;
 const current=await env.DB.prepare("SELECT id FROM tasks WHERE id=? AND version=? AND status='open'").bind(t.id,t.version).first();if(!current)break;
 try{
 const heading={assigned:'New task for you',updated:'Your task was updated',before:'Due tomorrow',due:'Due today'}[job.kind];
 const res=await sendPush(sub,{title:heading,body:`${COMPANIES[t.company]} · ${t.description.slice(0,180)} · Due ${t.due_date}`,tag:job.id,url:`/?task=${t.id}`},env);
 if(res.ok){await env.DB.prepare('INSERT OR IGNORE INTO deliveries(job_id,subscription_id,accepted_at) VALUES(?,?,?)').bind(job.id,sub.id,Date.now()).run();}
 else if(res.status===404||res.status===410){await env.DB.prepare('DELETE FROM subscriptions WHERE id=?').bind(sub.id).run();pending=true;error='Phone subscription expired';}
 else{pending=true;error=`Push service HTTP ${res.status}`;}
 }catch{pending=true;error='Push service temporarily unavailable';}
 }
 await env.DB.prepare("UPDATE jobs SET state=?,lease_until=?,last_error=? WHERE id=? AND state='pending'").bind(pending?'pending':'accepted',pending?now+Math.min(3600000,300000*2**Math.min(job.attempts,4)):0,error,job.id).run();
 }
}
async function route(req,env,ctx){
 const url=new URL(req.url),path=url.pathname,now=Date.now();
 if(req.method==='GET'&&ASSETS[path]){const a=ASSETS[path];return new Response(a.base64?unb64(a.body):a.body,{headers:{'Content-Type':a.type,'Cache-Control':path==='/sw.js'||path==='/'?'no-cache':'public, max-age=300'}});}
 if(!path.startsWith('/api/'))return json({error:'Not found'},404);
 if(req.method!=='GET'&&req.headers.get('origin')!==url.origin)fail('Request origin not allowed.',403);
 if(path==='/api/login'&&req.method==='POST'){
 const b=await body(req);if(typeof b.password!=='string'||b.password.length>256)fail('Enter your password.');
 const bucket=Math.floor(now/900000),ip=req.headers.get('cf-connecting-ip')||'unknown';const id=await hmac(`${ip}:${bucket}`,env.LOGIN_PEPPER);
 const lim=await env.DB.prepare('INSERT INTO login_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(id,(bucket+1)*900000).first();
 if(lim.count>10)return json({error:'Too many attempts. Please try again in 15 minutes.'},429,{'Retry-After':'900'});
 const accounts=[['TJ',env.TJ_PASSWORD],['Ms. Tay',env.MSTAY_PASSWORD],['Felicia',env.FELICIA_PASSWORD]];
 const matches=await Promise.all(accounts.map(([,password])=>passwordMatches(b.password,password)));
 const account=accounts.find((_,i)=>matches[i]);if(!account)fail('That password does not match. Try again.',401);
 const person=account[0];
 const token=b64(crypto.getRandomValues(new Uint8Array(32)));await env.DB.prepare('INSERT INTO sessions(id,expires_at,person) VALUES(?,?,?)').bind(await hash(token),now+30*DAY,person).run();
 return json({ok:true},200,{'Set-Cookie':`team_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`});
 }
 const user=await session(req,env);if(!user)fail('Sign in with your password.',401);
 if(path==='/api/logout'&&req.method==='POST'){const b=await body(req);await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(await hash(cookie(req))),env.DB.prepare('DELETE FROM subscriptions WHERE id=? AND person=?').bind(await hash(typeof b.endpoint==='string'?b.endpoint:''),user.name)]);return json({ok:true},200,{'Set-Cookie':'team_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});}
 if(path==='/api/state'&&req.method==='GET'){
 const [tasks,devices]=await env.DB.batch([env.DB.prepare(`SELECT t.*,(SELECT state FROM jobs WHERE task_id=t.id AND version=t.version ORDER BY CASE kind WHEN 'assigned' THEN 0 WHEN 'updated' THEN 0 ELSE 1 END,run_at DESC LIMIT 1) AS notification_state FROM tasks t WHERE (?='TJ' OR t.assignee=?) ORDER BY status, due_date,created_at DESC LIMIT 2000`).bind(user.name,user.name),env.DB.prepare('SELECT person,COUNT(*) AS count FROM subscriptions WHERE verified=1 GROUP BY person')]);
 return json({user,tasks:tasks.results,devices:devices.results,today:centralDate(now),vapid:env.VAPID_PUBLIC});
 }
 if(path==='/api/tasks'&&req.method==='POST'){
 const t={...validateTask(await body(req)),id:crypto.randomUUID(),version:1};
 if((await env.DB.prepare('SELECT COUNT(*) AS n FROM tasks').first()).n>=2000)fail('This first build supports 2,000 tasks. Contact TJ to expand it.',409);
 await env.DB.batch([env.DB.prepare('INSERT INTO tasks(id,company,assignee,due_date,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(t.id,t.company,t.assignee,t.due_date,t.description,now,now),...jobStatements(env,t,'assigned',now)]);
 ctx.waitUntil(processJobs(env).catch(()=>console.error(JSON.stringify({event:'push_processing_failed'}))));return json({id:t.id},201);
 }
 if(/^\/api\/tasks\/[\w-]+$/.test(path)&&req.method==='PATCH'){
 const id=path.split('/').pop(),b=await body(req);if(!Number.isInteger(b.version))fail('Reload the task before editing.',409);
 const old=await env.DB.prepare("SELECT * FROM tasks WHERE id=? AND (?='TJ' OR assignee=?)").bind(id,user.name,user.name).first();if(!old)fail('Task not found.',404);if(old.version!==b.version)fail('Someone changed this task. Refresh and try again.',409);
 const t={...validateTask({...old,...b}),id,version:old.version+1,status:b.status??old.status};if(!['open','done'].includes(t.status))fail('Invalid task status.');
 const results=await env.DB.batch([
 env.DB.prepare('UPDATE tasks SET company=?,assignee=?,due_date=?,description=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(t.company,t.assignee,t.due_date,t.description,t.status,now,id,old.version),
 env.DB.prepare("UPDATE jobs SET state='cancelled' WHERE task_id=? AND version=? AND state='pending' AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND version=?)").bind(id,old.version,id,t.version),
 ...(t.status==='open'?jobStatements(env,t,old.assignee===t.assignee?'updated':'assigned',now):[])]);
 if(!results[0].meta.changes)fail('Someone changed this task. Refresh and try again.',409);
 ctx.waitUntil(processJobs(env).catch(()=>console.error(JSON.stringify({event:'push_processing_failed'}))));return json({ok:true});
 }
 if(path==='/api/subscriptions'&&req.method==='POST'){
 const b=await body(req),s=b.subscription;if(b.person&&b.person!==user.name)fail('You can only enable notifications for yourself.',403);b.person=user.name;if(!s||typeof s.endpoint!=='string'||s.endpoint.length>2048||!validEndpoint(s.endpoint))fail('This phone’s push service is not supported.');
 try{if(unb64(s.keys.p256dh).length!==65||unb64(s.keys.auth).length!==16)throw Error();await crypto.subtle.importKey('raw',unb64(s.keys.p256dh),{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{fail('Invalid phone subscription. Please enable notifications again.');}
 const id=await hash(s.endpoint),existing=await env.DB.prepare('SELECT id,person,verified FROM subscriptions WHERE id=?').bind(id).first();
 if(existing&&existing.verified&&existing.person!==user.name)fail('This browser is connected to another person. Disconnect it before enabling your notifications.',409);
 if(!existing&&(await env.DB.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE person=?').bind(b.person).first()).n>=10)fail('This person already has 10 enabled devices.');
 const savedSubscription=await env.DB.prepare('INSERT INTO subscriptions(id,person,endpoint,p256dh,auth,created_at,verified) VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET person=excluded.person,p256dh=excluded.p256dh,auth=excluded.auth,verified=1 WHERE subscriptions.person=excluded.person OR subscriptions.verified=0').bind(id,b.person,s.endpoint,s.keys.p256dh,s.keys.auth,now).run();
 if(!savedSubscription.meta.changes)fail('This browser is connected to another person.',409);
 await env.DB.prepare("UPDATE jobs SET lease_until=0 WHERE state='pending' AND last_error='Waiting for an enabled phone' AND task_id IN(SELECT id FROM tasks WHERE assignee=?)").bind(b.person).run();
 ctx.waitUntil(processJobs(env).catch(()=>console.error(JSON.stringify({event:'push_processing_failed'}))));return json({ok:true});
 }
 if(path==='/api/subscriptions/remove'&&req.method==='POST'){const b=await body(req);if(typeof b.endpoint!=='string')fail('Invalid subscription.');await env.DB.prepare('DELETE FROM subscriptions WHERE id=? AND person=?').bind(await hash(b.endpoint),user.name).run();return json({ok:true});}
 if(path==='/api/push-test'&&req.method==='POST'){
 const b=await body(req);if(typeof b.endpoint!=='string')fail('Enable notifications first.');const s=await env.DB.prepare('SELECT * FROM subscriptions WHERE id=? AND person=? AND verified=1').bind(await hash(b.endpoint),user.name).first();if(!s)fail('Enable notifications first.');
 const res=await sendPush(s,{title:'You’re connected',body:`${s.person}, this phone is ready for team task reminders.`,tag:'setup-test',url:'/'},env);
 if(!res.ok)fail('The push service did not accept this test. Try enabling notifications again.',502);return json({ok:true});
 }
 return json({error:'Not found'},404);
}
export default {
 async fetch(req,env,ctx){
 let response;try{response=await route(req,env,ctx);}catch(e){if(!e.status)console.error(JSON.stringify({event:'request_error',path:new URL(req.url).pathname,message:e.message}));response=json({error:e.status?e.message:'Something went wrong. Please try again.'},e.status||500);}
 const h=new Headers(response.headers);h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');h.set('X-Frame-Options','DENY');h.set('Strict-Transport-Security','max-age=31536000');
 h.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 if(new URL(req.url).pathname.startsWith('/api/'))h.set('Cache-Control','no-store');
 return new Response(response.body,{status:response.status,headers:h});
 },
 async scheduled(event,env){await processJobs(env,event.scheduledTime);}
};
