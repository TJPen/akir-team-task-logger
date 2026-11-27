import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createPublicKey,diffieHellman,hkdfSync,createDecipheriv,verify} from 'node:crypto';
import worker,{morning,centralDate,validateTask,processJobs,jobStatements} from './worker.mjs';
import {encryptPayload,pushRequest,validEndpoint,b64,unb64} from './push.mjs';
import {processRecurrences,processDigests,summaryFor} from './workflows.mjs';
import {nextDate} from './domain.mjs';
const origin='https://example.test';
async function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 let queryCount=0;
 function prepare(sql){let args=[];const result={bind(...a){args=a.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);return result;},async first(){queryCount++;return db.prepare(sql).get(...args)||null;},async all(){queryCount++;return {results:db.prepare(sql).all(...args)};},async run(){queryCount++;const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};},sql,args:()=>args};return result;}
 const DB={prepare,async batch(stmts){db.exec('BEGIN');try{const out=[];for(const s of stmts){if(/^\s*SELECT/i.test(s.sql))out.push(await s.all());else out.push(await s.run());}db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const vapid=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=vapid.privateKey.export({format:'jwk'}),pub=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 const env={DB,TJ_PASSWORD:'test-admin-password',MSTAY_PASSWORD:'test-tay-password',FELICIA_PASSWORD:'test-felicia-password',LOGIN_PEPPER:'test-pepper',APP_ORIGIN:origin,VAPID_PRIVATE:JSON.stringify(jwk),VAPID_PUBLIC:pub.toString('base64url')};let cookie='',pending=[];
 const ctx={waitUntil(p){pending.push(p);}};
 async function request(path,method='GET',data,options={}){const headers={...(!options.noOrigin?{origin}:{}),...(cookie?{cookie}:{}),...(data?{'Content-Type':'application/json'}:{}),...(options.headers||{})};return worker.fetch(new Request(origin+path,{method,headers,body:options.raw??(data?JSON.stringify(data):undefined)}),env,ctx);}
 async function login(person='TJ'){const key={'TJ':'TJ_PASSWORD','Ms. Tay':'MSTAY_PASSWORD','Felicia':'FELICIA_PASSWORD'}[person];const r=await request('/api/login','POST',{password:env[key]});cookie=r.headers.get('set-cookie').split(';')[0];return r;}
 async function drain(){await Promise.all(pending);pending=[];}
 return {db,env,request,login,drain,queryCount:()=>queryCount,resetCount:()=>queryCount=0};
}
const sample=()=>({company:'akir',assignee:'TJ',due_date:centralDate(Date.now()+3*86400000),description:'Confirm next week’s supply order'});
test('Central reminders use 9 AM in winter, summer, and DST transition days',()=>{
 assert.equal(new Date(morning('2026-01-15')).toISOString(),'2026-01-15T15:00:00.000Z');
 assert.equal(new Date(morning('2026-07-15')).toISOString(),'2026-07-15T14:00:00.000Z');
 assert.equal(new Date(morning('2026-03-08')).toISOString(),'2026-03-08T14:00:00.000Z');
 assert.equal(new Date(morning('2026-11-01')).toISOString(),'2026-11-01T15:00:00.000Z');
 assert.equal(centralDate(Date.parse('2026-07-15T02:00:00Z')),'2026-07-14');
});
test('rejects invalid fields and impossible dates',()=>{for(const field of [{company:'other'},{assignee:'Someone'},{description:' '},{description:'x'.repeat(2001)},{due_date:'2026-02-30'},{due_date:'2026-99-01'}])assert.throws(()=>validateTask({...sample(),...field}),e=>e.status===400);});
test('push destinations reject arbitrary URLs, ports and credentials',()=>{assert(validEndpoint('https://fcm.googleapis.com/fcm/send/test'));assert(validEndpoint('https://web.push.apple.com/Q/test'));for(const url of ['https://example.com','http://fcm.googleapis.com','https://fcm.googleapis.com.evil.test','https://user@fcm.googleapis.com','https://fcm.googleapis.com:444','http://127.0.0.1'])assert(!validEndpoint(url));});
test('Web Push payload decrypts using independent Node crypto; VAPID verifies',async()=>{
 const f=await fixture(),receiver=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=receiver.publicKey.export({format:'jwk'}),ua=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 const auth=Buffer.alloc(16,7),sub={endpoint:'https://fcm.googleapis.com/fcm/send/test',p256dh:ua.toString('base64url'),auth:auth.toString('base64url')},payload={title:'Due today',body:'Akir Enterprises · Prepare the schedule',url:'/'};
 const encrypted=Buffer.from(await encryptPayload(sub,payload)),salt=encrypted.subarray(0,16),pub=encrypted.subarray(21,86),content=encrypted.subarray(86);
 assert.equal(encrypted.readUInt32BE(16),4096);assert.equal(encrypted[20],65);
 const peer=createPublicKey({key:{kty:'EC',crv:'P-256',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url')},format:'jwk'}),shared=diffieHellman({privateKey:receiver.privateKey,publicKey:peer});
 const ikm=hkdfSync('sha256',shared,auth,Buffer.concat([Buffer.from('WebPush: info\0'),ua,pub]),32),cek=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
 const decipher=createDecipheriv('aes-128-gcm',cek,nonce);decipher.setAuthTag(content.subarray(-16));const plain=Buffer.concat([decipher.update(content.subarray(0,-16)),decipher.final()]);assert.equal(plain.at(-1),2);assert.deepEqual(JSON.parse(plain.subarray(0,-1)),payload);
 const request=await pushRequest(sub,payload,f.env),jwt=request.headers.Authorization.match(/t=([^,]+)/)[1],parts=jwt.split('.'),vapidPub=createPublicKey({key:JSON.parse(f.env.VAPID_PRIVATE),format:'jwk'});
 assert(verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key:vapidPub,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')));
 assert.equal(JSON.parse(Buffer.from(parts[1],'base64url')).aud,'https://fcm.googleapis.com');assert.equal(request.redirect,'manual');f.db.close();
});
test('authentication, CSRF, persistence, edit conflicts, completion and reopen',async()=>{
 const f=await fixture();assert.equal((await f.request('/api/state')).status,401);assert.equal((await f.request('/api/login','POST',{password:'wrong'})).status,401);const login=await f.login();assert.match(login.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 assert.equal((await f.request('/api/tasks','POST',sample(),{noOrigin:true})).status,403);
 const created=await f.request('/api/tasks','POST',sample());assert.equal(created.status,201);const {id}=await created.json();await f.drain();
 const data=await (await f.request('/api/state')).json();assert.equal(data.tasks.length,1);assert.equal(data.tasks[0].id,id);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,3);
 const changed=await f.request('/api/tasks/'+id,'PATCH',{version:1,assignee:'Felicia',company:'xpress'});assert.equal(changed.status,200);await f.drain();assert.equal((await f.request('/api/tasks/'+id,'PATCH',{version:1,status:'done'})).status,409);
 assert.equal((await f.request('/api/tasks/'+id,'PATCH',{version:2,status:'done'})).status,200);await f.drain();assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='pending'").get().n,0);
 assert.equal((await f.request('/api/tasks/'+id,'PATCH',{version:3,status:'open'})).status,200);await f.drain();assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='pending'").get().n,3);
 const tasks=(await (await f.request('/api/state')).json()).tasks;assert.equal(tasks[0].assignee,'Felicia');assert.equal(tasks[0].company,'xpress');
 await f.request('/api/logout','POST',{});assert.equal((await f.request('/api/state')).status,401);f.db.close();
});
test('password attempts are limited and static shell does not expose secrets',async()=>{const f=await fixture();for(let i=0;i<10;i++)assert.equal((await f.request('/api/login','POST',{password:'wrong'})).status,401);assert.equal((await f.request('/api/login','POST',{password:'wrong'})).status,429);const res=await f.request('/');assert.equal(res.status,200);assert(!(await res.text()).includes(f.env.TJ_PASSWORD));assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);f.db.close();});
test('subscription validation, cancellation, deduplication and push retry',async()=>{
 const f=await fixture();await f.login();assert.equal((await f.request('/api/subscriptions','POST',{person:'TJ',subscription:{endpoint:'https://evil.test'}})).status,400);
 const receiver=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=receiver.publicKey.export({format:'jwk'}),pub=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:pub.toString('base64url'),auth:Buffer.alloc(16,4).toString('base64url')}};
 assert.equal((await f.request('/api/subscriptions','POST',{person:'TJ',subscription})).status,200);await f.drain();
 const original=globalThis.fetch;let calls=0,code=503;globalThis.fetch=async()=>{calls++;return new Response('',{status:code});};
 try{const {id}=await (await f.request('/api/tasks','POST',sample())).json();await f.drain();assert.equal(calls,1);let j=f.db.prepare("SELECT * FROM jobs WHERE kind='assigned'").get();assert.equal(j.state,'pending');assert.match(j.last_error,/503/);
 code=201;await processJobs(f.env,Date.now()+360000);assert.equal(calls,2);await processJobs(f.env,Date.now()+720000);assert.equal(calls,2);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n,1);
 await f.request('/api/tasks/'+id,'PATCH',{version:1,status:'done'});await f.drain();await processJobs(f.env,Date.now()+3*86400000);assert.equal(calls,2);
 await f.request('/api/subscriptions/remove','POST',{endpoint:subscription.endpoint});assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,0);
 }finally{globalThis.fetch=original;f.db.close();}
});

test('self-assigned Apple push uses Workers-compatible redirects and never accepts a redirect as delivery',async()=>{
 const f=await fixture();await f.login();
 const receiver=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=receiver.publicKey.export({format:'jwk'}),pub=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 const subscription={endpoint:'https://web.push.apple.com/test',keys:{p256dh:pub.toString('base64url'),auth:Buffer.alloc(16,4).toString('base64url')}};
 await f.request('/api/subscriptions','POST',{subscription});await f.drain();
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,init)=>{
  assert.equal(url,subscription.endpoint);assert.equal(init.redirect,'manual');calls++;
  return calls===1?new Response(null,{status:307,headers:{Location:'https://example.test/untrusted'}}):new Response(null,{status:201});
 };
 try{
  assert.equal((await f.request('/api/tasks','POST',sample())).status,201);await f.drain();
  assert.equal(calls,1);const job=f.db.prepare("SELECT * FROM jobs WHERE kind='assigned'").get();
  assert.equal(job.state,'pending');assert.match(job.last_error,/307/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM deliveries').get().n,0);
  await processJobs(f.env,Date.now()+360000);assert.equal(calls,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM deliveries').get().n,1);
 }finally{globalThis.fetch=original;f.db.close();}
});

test('personal accounts isolate both companies and prevent direct access to other tasks',async()=>{
 const f=await fixture();await f.login();const ids={};
 for(const person of ['TJ','Ms. Tay','Felicia']){const r=await f.request('/api/tasks','POST',{...sample(),assignee:person,company:person==='Felicia'?'xpress':'akir',description:'Private task for '+person});ids[person]=(await r.json()).id;await f.drain();}
 assert.equal((await (await f.request('/api/state')).json()).tasks.length,3);
 for(const person of ['Ms. Tay','Felicia']){
  await f.login(person);const state=await (await f.request('/api/state?assignee=TJ&role=admin')).json();
  assert.deepEqual(state.user,{name:person,role:'member'});assert.deepEqual(state.tasks.map(t=>t.id),[ids[person]]);
  for(const other of ['TJ','Ms. Tay','Felicia'].filter(p=>p!==person))assert.equal((await f.request('/api/tasks/'+ids[other],'PATCH',{version:1,status:'done',role:'admin',person:'TJ'})).status,404);
  assert.equal((await f.request('/api/tasks/'+ids[person],'PATCH',{version:1,status:'done'})).status,200);await f.drain();
 }
 await f.login();const state=await (await f.request('/api/state')).json();assert.equal(state.user.role,'admin');assert.equal(state.tasks.length,3);assert.equal(state.tasks.filter(t=>t.status==='done').length,2);f.db.close();
});
test('members see their assignments by default and retain creator access after reassignment',async()=>{
 const f=await fixture();
 for(const person of ['Ms. Tay','Felicia']){
  await f.login(person);for(const assignee of ['TJ','Ms. Tay','Felicia']){const r=await f.request('/api/tasks','POST',{...sample(),assignee});assert.equal(r.status,201);await f.drain();}
  const state=await (await f.request('/api/state')).json();assert(state.tasks.every(t=>t.assignee===person));
  const own=state.tasks[0];assert.equal((await f.request('/api/tasks/'+own.id,'PATCH',{version:own.version,assignee:'TJ'})).status,200);await f.drain();
  assert(!(await (await f.request('/api/state')).json()).tasks.some(t=>t.id===own.id));
  assert.equal((await f.request('/api/tasks/'+own.id,'PATCH',{version:own.version+1,description:'Creator follow-up'})).status,200);
 }
 await f.login();assert.equal((await (await f.request('/api/state')).json()).tasks.length,6);f.db.close();
});
test('password determines identity; legacy and invalid identity sessions are rejected',async()=>{
 const f=await fixture();const token=b64(crypto.getRandomValues(new Uint8Array(32))),hash=b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
 f.db.prepare('INSERT INTO sessions(id,expires_at,person) VALUES(?,?,?)').run(hash,Date.now()+60000,null);
 assert.equal((await f.request('/api/state','GET',undefined,{headers:{cookie:'team_session='+token}})).status,401);
 f.db.prepare('UPDATE sessions SET person=? WHERE id=?').run('admin',hash);
 assert.equal((await f.request('/api/state','GET',undefined,{headers:{cookie:'team_session='+token}})).status,401);
 const login=await f.request('/api/login','POST',{password:f.env.MSTAY_PASSWORD,person:'TJ',role:'admin'});const cookie=login.headers.get('set-cookie').split(';')[0];
 const state=await (await f.request('/api/state','GET',undefined,{headers:{cookie}})).json();assert.deepEqual(state.user,{name:'Ms. Tay',role:'member'});f.db.close();
});
test('phone subscriptions belong to the authenticated account and logout disconnects its phone',async()=>{
 const f=await fixture();await f.login();const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'}),pub=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/ownership-test',keys:{p256dh:pub.toString('base64url'),auth:Buffer.alloc(16,3).toString('base64url')}};
 assert.equal((await f.request('/api/subscriptions','POST',{subscription})).status,200);await f.drain();
 await f.login('Ms. Tay');assert.equal((await f.request('/api/subscriptions','POST',{subscription,person:'TJ'})).status,403);
 assert.equal((await f.request('/api/subscriptions','POST',{subscription})).status,409);
 assert.equal((await f.request('/api/push-test','POST',{endpoint:subscription.endpoint})).status,400);
 await f.request('/api/subscriptions/remove','POST',{endpoint:subscription.endpoint});assert.equal(f.db.prepare('SELECT person FROM subscriptions').get().person,'TJ');
 await f.request('/api/logout','POST',{endpoint:subscription.endpoint});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM subscriptions').get().n,1);
 await f.login();await f.request('/api/logout','POST',{endpoint:subscription.endpoint});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM subscriptions').get().n,0);assert.equal((await f.request('/api/state')).status,401);f.db.close();
});
test('upgrade preserves tasks, revokes shared sessions, and requires phone ownership verification',async()=>{
 const db=new DatabaseSync(':memory:');const schema=(await readFile(new URL('./schema.sql',import.meta.url),'utf8')).replace('expires_at INTEGER NOT NULL, person TEXT','expires_at INTEGER NOT NULL').replace(', verified INTEGER NOT NULL DEFAULT 0','');db.exec(schema);
 db.exec("INSERT INTO tasks(id,company,assignee,due_date,description,created_at,updated_at) VALUES('existing','akir','Ms. Tay','2027-01-01','Keep this task',1,1); INSERT INTO sessions VALUES('legacy',9999999999999); INSERT INTO subscriptions VALUES('legacy-phone','TJ','https://fcm.googleapis.com/fcm/send/legacy','key','auth',1);");
 db.exec(await readFile(new URL('./migrations/002_personal_accounts.sql',import.meta.url),'utf8'));
 assert.equal(db.prepare('SELECT description FROM tasks').get().description,'Keep this task');assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);assert.equal(db.prepare('SELECT verified FROM subscriptions').get().verified,0);db.close();
});

test('creator view, task collaboration and files stay private from unrelated members',async()=>{
 const f=await fixture();await f.login('Ms. Tay');
 const {id}=await (await f.request('/api/tasks','POST',{...sample(),assignee:'TJ',priority:'urgent',checklist:['Review invoice']})).json();await f.drain();
 assert.equal((await (await f.request('/api/state')).json()).tasks.length,0);
 let created=await (await f.request('/api/state?view=created')).json();assert.equal(created.tasks.length,1);assert.equal(created.tasks[0].created_by,'Ms. Tay');
 assert.equal((await f.request('/api/tasks/'+id+'/comments','POST',{body:'Please check <script>this</script>.'})).status,201);
 const bytes=new Uint8Array(600000);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const uploaded=await f.request('/api/tasks/'+id+'/attachments','POST',null,{raw:bytes,headers:{'content-type':'application/octet-stream','x-file-name':encodeURIComponent('invoice & notes.pdf')}});assert.equal(uploaded.status,201);const aid=(await uploaded.json()).id;
 const download=await f.request('/api/tasks/'+id+'/attachments/'+aid);assert.equal(download.status,200);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),bytes);assert.match(download.headers.get('content-disposition'),/attachment/);assert.match(download.headers.get('content-security-policy'),/sandbox/);
 await f.login('Felicia');for(const path of ['/api/tasks/'+id,'/api/tasks/'+id+'/attachments/'+aid])assert.equal((await f.request(path)).status,404);
 assert.equal((await f.request('/api/tasks/'+id+'/comments','POST',{body:'Forbidden'})).status,404);
 assert.equal((await f.request('/api/tasks/'+id+'/checklist','POST',{title:'Forbidden'})).status,404);
 await f.login();const detail=await (await f.request('/api/tasks/'+id)).json();assert.equal(detail.comments.length,1);assert.equal(detail.attachments.length,1);assert.equal(detail.task.priority,'urgent');assert(detail.history.some(e=>e.actor==='Ms. Tay'&&e.event==='attachment'));
 await f.login('Ms. Tay');assert.equal((await f.request('/api/tasks/'+id+'/attachments/'+aid,'DELETE',{})).status,200);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM attachment_chunks').get().n,0);f.db.close();
});
test('progress requires a blocked reason; completion, reopening, checklist and history work',async()=>{
 const f=await fixture();await f.login();const {id}=await (await f.request('/api/tasks','POST',{...sample(),priority:'high',checklist:['Inspect supplies','Send report']})).json();await f.drain();
 assert.equal((await f.request('/api/tasks/'+id,'PATCH',{version:1,progress:'blocked'})).status,400);
 assert.equal((await f.request('/api/tasks/'+id,'PATCH',{version:1,progress:'blocked',blocked_reason:'Waiting for delivery'})).status,200);await f.drain();
 let detail=await (await f.request('/api/tasks/'+id)).json();assert.equal(detail.task.status,'open');assert.equal(detail.task.progress,'blocked');assert.equal(detail.task.blocked_reason,'Waiting for delivery');
 const item=detail.checklist[0];assert.equal((await f.request('/api/tasks/'+id+'/checklist/'+item.id,'PATCH',{version:1,done:true})).status,200);
 assert.equal((await f.request('/api/tasks/'+id+'/checklist/'+item.id,'PATCH',{version:1,done:false})).status,409);
 const state=await (await f.request('/api/state')).json();assert.equal(state.tasks[0].checklist_total,2);assert.equal(state.tasks[0].checklist_done,1);
 assert.equal((await f.request('/api/tasks/'+id,'PATCH',{version:2,progress:'completed'})).status,200);await f.drain();
 detail=await (await f.request('/api/tasks/'+id)).json();assert.equal(detail.task.status,'done');assert.equal(detail.task.blocked_reason,'');assert(detail.history.some(a=>a.detail.includes('Checked checklist item')));
 assert.equal((await f.request('/api/tasks/'+id,'PATCH',{version:3,status:'open'})).status,200);await f.drain();assert.equal((await (await f.request('/api/tasks/'+id)).json()).task.progress,'not_started');f.db.close();
});
test('recurrence preserves monthly anchor, checklist, ownership and deduplicates generation',async()=>{
 assert.equal(nextDate('2027-01-31','monthly',31),'2027-02-28');assert.equal(nextDate('2027-02-28','monthly',31),'2027-03-31');assert.equal(nextDate('2028-01-31','monthly',31),'2028-02-29');assert.equal(nextDate('2027-12-31','daily'),'2028-01-01');
 const f=await fixture();await f.login('Ms. Tay');const {id}=await (await f.request('/api/tasks','POST',{...sample(),due_date:'2027-01-31',assignee:'Felicia',recurrence:'monthly',checklist:['Count stock']})).json();await f.drain();
 const s=f.db.prepare('SELECT * FROM recurring_series').get();assert.equal(s.next_due_date,'2027-02-28');
 await f.request('/api/tasks/'+id+'/checklist','POST',{title:'Send totals'});
 await f.request('/api/tasks/'+id,'PATCH',{version:1,status:'done'});await f.drain();
 let tasks=f.db.prepare('SELECT * FROM tasks ORDER BY due_date').all();assert.equal(tasks.length,2);assert.equal(tasks[1].due_date,'2027-02-28');assert.equal(tasks[1].created_by,'Ms. Tay');assert.equal(tasks[1].assignee,'Felicia');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM checklist_items WHERE task_id=? AND done=0').get(tasks[1].id).n,2);
 await processRecurrences(f.env,jobStatements,Date.parse('2027-02-01T18:00:00Z'));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,2);
 // The next occurrence is created after a missed due date, while the missed task stays open.
 await processRecurrences(f.env,jobStatements,Date.parse('2027-03-01T18:00:00Z'));tasks=f.db.prepare('SELECT * FROM tasks ORDER BY due_date').all();assert.equal(tasks.length,3);assert.equal(tasks[1].status,'open');assert.equal(tasks[2].due_date,'2027-03-31');
 await processRecurrences(f.env,jobStatements,Date.parse('2027-03-01T18:00:00Z'));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,3);
 await f.request('/api/tasks/'+tasks[2].id,'PATCH',{version:1,recurrence:'none'});await f.drain();await processRecurrences(f.env,jobStatements,Date.parse('2027-04-01T18:00:00Z'));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,3);f.db.close();
});
test('daily summaries use recipient scope, Central 9 AM, retry and per-device deduplication',async()=>{
 const f=await fixture();await f.login();const date='2027-02-12',now=morning(date);
 for(const assignee of ['TJ','Ms. Tay','Felicia']){await f.request('/api/tasks','POST',{...sample(),assignee,due_date:date});await f.drain();}
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'}),pub=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 for(const person of ['TJ','Ms. Tay'])f.db.prepare('INSERT INTO subscriptions(id,person,endpoint,p256dh,auth,created_at,verified) VALUES(?,?,?,?,?,?,1)').run(person,person,'https://web.push.apple.com/'+person,pub.toString('base64url'),Buffer.alloc(16,4).toString('base64url'),now);
 assert.equal((await summaryFor(f.env,{name:'TJ'},now)).due_today.length,3);assert.equal((await summaryFor(f.env,{name:'Ms. Tay'},now)).due_today.length,1);
 const original=globalThis.fetch;let calls=0,failOnce=true;globalThis.fetch=async(url)=>{calls++;if(url.endsWith('TJ')&&failOnce){failOnce=false;return new Response(null,{status:503});}return new Response(null,{status:201});};
 try{await processDigests(f.env,now-1);assert.equal(calls,0);await processDigests(f.env,now);assert.equal(calls,2);await processDigests(f.env,now+1000);assert.equal(calls,2);await processDigests(f.env,now+301000);assert.equal(calls,3);await processDigests(f.env,now+601000);assert.equal(calls,3);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM digest_deliveries').get().n,2);
 await f.login('Ms. Tay');await f.request('/api/preferences','PATCH',{digest_enabled:false});await processDigests(f.env,morning('2027-02-13'));assert.equal(calls,4);assert.equal((await (await f.request('/api/state')).json()).preferences.digest_enabled,false);
 }finally{globalThis.fetch=original;f.db.close();}
});
test('validation rejects hostile uploads, invalid recurrence, oversized checklist and forged creator',async()=>{
 const f=await fixture();await f.login('Felicia');
 for(const patch of [{priority:'critical'},{recurrence:'yearly'},{checklist:Array(31).fill('Step')},{progress:'blocked'},{checklist:[' '] }])assert.equal((await f.request('/api/tasks','POST',{...sample(),...patch})).status,400);
 const {id}=await (await f.request('/api/tasks','POST',{...sample(),created_by:'TJ'})).json();await f.drain();assert.equal(f.db.prepare('SELECT created_by FROM tasks WHERE id=?').get(id).created_by,'Felicia');
 assert.equal((await f.request('/api/tasks/'+id+'/attachments','POST',null,{raw:new Uint8Array([1]),headers:{'x-file-name':'attack.html'}})).status,400);
 assert.equal((await f.request('/api/tasks/'+id+'/attachments','POST',null,{raw:new Uint8Array([1]),headers:{'x-file-name':'big.pdf','content-length':String(6*1024*1024)}})).status,413);
 assert.equal((await f.request('/api/tasks/'+id+'/comments','POST',{body:'x'.repeat(2001)})).status,400);f.db.close();
});
test('workflow migration preserves live tasks, sessions and phone subscriptions',async()=>{
 const db=new DatabaseSync(':memory:');const schema=await readFile(new URL('./schema.sql',import.meta.url),'utf8');db.exec(schema.split('-- Additive upgrade:')[0]);
 db.exec("INSERT INTO tasks(id,company,assignee,due_date,description,status,created_at,updated_at) VALUES('old','akir','TJ','2026-12-01','Keep original','done',1,1);INSERT INTO sessions VALUES('session',9999999999999,'TJ');INSERT INTO subscriptions VALUES('phone','TJ','https://web.push.apple.com/example','key','auth',1,1);");
 db.exec(await readFile(new URL('./migrations/003_team_workflows.sql',import.meta.url),'utf8'));
 const t=db.prepare('SELECT * FROM tasks').get();assert.equal(t.description,'Keep original');assert.equal(t.progress,'completed');assert.equal(t.created_by,null);assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);assert.equal(db.prepare('SELECT verified FROM subscriptions').get().verified,1);db.close();
});
test('scheduled recurrence, reminders and three summaries fit the free-plan query budget',async()=>{
 const f=await fixture();await f.login();const date='2027-02-13',now=morning(date);
 await f.request('/api/tasks','POST',{...sample(),due_date:'2027-02-12',recurrence:'daily',checklist:Array.from({length:30},(_,i)=>'Step '+i)});await f.drain();
 for(const assignee of ['TJ','Ms. Tay','Felicia']){await f.request('/api/tasks','POST',{...sample(),assignee,due_date:date});await f.drain();}
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'}),pub=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 for(const person of ['TJ','Ms. Tay','Felicia'])for(let i=0;i<3;i++)f.db.prepare('INSERT INTO subscriptions(id,person,endpoint,p256dh,auth,created_at,verified) VALUES(?,?,?,?,?,?,1)').run(person+i,person,'https://web.push.apple.com/'+person+i,pub.toString('base64url'),Buffer.alloc(16,4).toString('base64url'),now);
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(null,{status:201});
 try{f.resetCount();await worker.scheduled({scheduledTime:now},f.env);assert(f.queryCount()<=50,'Scheduled queries: '+f.queryCount());assert.equal(f.db.prepare('SELECT COUNT(*) n FROM digest_deliveries').get().n,3);}
 finally{globalThis.fetch=original;f.db.close();}
});

test('deletion enforces access and versions, stops reminders, and hides private content',async()=>{
 const f=await fixture();await f.login('Ms. Tay');
 const {id}=await (await f.request('/api/tasks','POST',{...sample(),assignee:'Felicia',due_date:centralDate(Date.now())})).json();await f.drain();
 const file=await (await f.request('/api/tasks/'+id+'/attachments','POST',null,{raw:new TextEncoder().encode('private'),headers:{'x-file-name':'note.txt'}})).json();
 const {id:other}=await (await f.request('/api/tasks','POST',{...sample(),assignee:'Ms. Tay'})).json();await f.drain();
 await f.login('Felicia');assert.equal((await f.request('/api/tasks/'+other,'DELETE',{version:1})).status,404);
 assert.equal((await f.request('/api/tasks/'+id,'DELETE',{version:2})).status,409);
 assert.equal((await f.request('/api/tasks/'+id,'DELETE',{version:1},{noOrigin:true})).status,403);
 assert.equal((await f.request('/api/tasks/'+id,'DELETE',{version:1})).status,200);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM jobs WHERE task_id=? AND state='pending'").get(id).n,0);
 assert(f.db.prepare('SELECT deleted_at FROM tasks WHERE id=?').get(id).deleted_at);
 assert.equal((await f.request('/api/tasks/'+id)).status,404);
 assert.equal((await f.request('/api/tasks/'+id+'/attachments/'+file.id)).status,404);
 assert.equal((await f.request('/api/tasks/'+id,'PATCH',{version:2,priority:'urgent'})).status,404);
 assert.equal((await f.request('/api/tasks/'+id+'/comments','POST',{body:'No longer accessible'})).status,404);
 for(const person of ['TJ','Ms. Tay','Felicia']){await f.login(person);for(const view of ['default','mine','created']){const board=await (await f.request('/api/state?view='+view)).json();assert(!board.tasks.some(t=>t.id===id));}const summary=await (await f.request('/api/summary')).json();assert(![...summary.due_today,...summary.overdue].some(t=>t.id===id));}
 assert.equal(f.db.prepare('SELECT deleted_at FROM tasks WHERE id=?').get(other).deleted_at,null);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM activity WHERE task_id=? AND event='deleted'").get(id).n,1);await f.drain();f.db.close();
});
test('deleting the latest repeating task stops repeats; deleting older occurrences preserves the series',async()=>{
 const f=await fixture();await f.login();
 const {id}=await (await f.request('/api/tasks','POST',{...sample(),recurrence:'daily'})).json();await f.drain();
 await f.request('/api/tasks/'+id,'PATCH',{version:1,progress:'completed'});await f.drain();
 const series=f.db.prepare('SELECT * FROM recurring_series').get();assert.notEqual(series.current_task_id,id);
 assert.equal((await f.request('/api/tasks/'+id,'DELETE',{version:2})).status,200);
 assert.equal(f.db.prepare('SELECT active FROM recurring_series').get().active,1);
 assert.equal((await f.request('/api/tasks/'+series.current_task_id,'DELETE',{version:1})).status,200);
 assert.equal(f.db.prepare('SELECT active FROM recurring_series').get().active,0);
 await processRecurrences(f.env,jobStatements,Date.now()+10*86400000);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tasks').get().n,2);f.db.close();
});
test('inline status, priority and reassignment updates appear in the correct personal lists',async()=>{
 const f=await fixture();await f.login('Ms. Tay');const {id}=await (await f.request('/api/tasks','POST',{...sample(),assignee:'Ms. Tay'})).json();await f.drain();
 for(const [version,change] of [[1,{priority:'urgent'}],[2,{progress:'in_progress'}],[3,{assignee:'Felicia'}]]){assert.equal((await f.request('/api/tasks/'+id,'PATCH',{version,...change})).status,200);await f.drain();}
 assert.equal((await (await f.request('/api/state?view=mine')).json()).tasks.length,0);
 assert.equal((await (await f.request('/api/state?view=created')).json()).tasks.length,1);
 await f.login('Felicia');const mine=await (await f.request('/api/state?view=mine')).json();assert.equal(mine.tasks[0].priority,'urgent');assert.equal(mine.tasks[0].progress,'in_progress');
 assert.equal((await f.request('/api/tasks/'+id,'PATCH',{version:4,progress:'blocked'})).status,400);
 assert.equal((await f.request('/api/tasks/'+id,'PATCH',{version:4,progress:'completed'})).status,200);await f.drain();assert.equal(f.db.prepare('SELECT status FROM tasks WHERE id=?').get(id).status,'done');f.db.close();
});
