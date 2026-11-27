import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createPublicKey,diffieHellman,hkdfSync,createDecipheriv,verify} from 'node:crypto';
import worker,{morning,centralDate,validateTask,processJobs} from './worker.mjs';
import {encryptPayload,pushRequest,validEndpoint,b64,unb64} from './push.mjs';
const origin='https://example.test';
async function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 function prepare(sql){let args=[];const result={bind(...a){args=a;return result;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};},sql,args:()=>args};return result;}
 const DB={prepare,async batch(stmts){db.exec('BEGIN');try{const out=[];for(const s of stmts){if(/^\s*SELECT/i.test(s.sql))out.push(await s.all());else out.push(await s.run());}db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const vapid=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=vapid.privateKey.export({format:'jwk'}),pub=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 const env={DB,TEAM_PASSWORD:'test-only-password',APP_ORIGIN:origin,VAPID_PRIVATE:JSON.stringify(jwk),VAPID_PUBLIC:pub.toString('base64url')};let cookie='',pending=[];
 const ctx={waitUntil(p){pending.push(p);}};
 async function request(path,method='GET',data,options={}){const headers={...(!options.noOrigin?{origin}:{}),...(cookie?{cookie}:{}),...(data?{'Content-Type':'application/json'}:{}),...(options.headers||{})};return worker.fetch(new Request(origin+path,{method,headers,body:data?JSON.stringify(data):undefined}),env,ctx);}
 async function login(){const r=await request('/api/login','POST',{password:env.TEAM_PASSWORD});cookie=r.headers.get('set-cookie').split(';')[0];return r;}
 async function drain(){await Promise.all(pending);pending=[];}
 return {db,env,request,login,drain};
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
 assert.equal(JSON.parse(Buffer.from(parts[1],'base64url')).aud,'https://fcm.googleapis.com');assert.equal(request.redirect,'error');f.db.close();
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
test('password attempts are limited and static shell does not expose secrets',async()=>{const f=await fixture();for(let i=0;i<10;i++)assert.equal((await f.request('/api/login','POST',{password:'wrong'})).status,401);assert.equal((await f.request('/api/login','POST',{password:'wrong'})).status,429);const res=await f.request('/');assert.equal(res.status,200);assert(!(await res.text()).includes(f.env.TEAM_PASSWORD));assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);f.db.close();});
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
