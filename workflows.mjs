import {PEOPLE,COMPANIES,PROGRESS,DAY,fail,centralDate,morning,validateTask,validateExtra,validateCadence,nextDate,checkTitle} from './domain.mjs';
import {sendPush} from './push.mjs';
const json=(data,status=200)=>Response.json(data,{status});
const uid=()=>crypto.randomUUID();
export const ACCESS="deleted_at IS NULL AND (?='TJ' OR assignee=? OR created_by=?)";
export async function accessibleTask(env,id,user){const t=await env.DB.prepare(`SELECT * FROM tasks WHERE id=? AND ${ACCESS}`).bind(id,user.name,user.name,user.name).first();if(!t)fail('Task not found.',404);return t;}
function gate(env,id,user){return env.DB.prepare(`SELECT id FROM tasks WHERE id=? AND ${ACCESS}`).bind(id,user.name,user.name,user.name);}
function eventStmt(env,t,actor,event,detail,now,mutation=null){return env.DB.prepare('INSERT INTO activity(id,task_id,actor,event,detail,created_at) SELECT ?,id,?,?,?,? FROM tasks WHERE id=? AND (? IS NULL OR mutation_id=?)').bind(uid(),actor,event,detail,now,t.id,mutation,mutation);}
function template(t,items=[]){return JSON.stringify({...validateTask(t),priority:t.priority,created_by:t.created_by,checklist:items});}
function taskInsert(env,t,now,condition='1',args=[]){return env.DB.prepare(`INSERT OR IGNORE INTO tasks(id,company,assignee,due_date,description,status,version,created_at,updated_at,created_by,priority,progress,blocked_reason,series_id,occurrence_date,mutation_id) SELECT ?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,? WHERE ${condition}`).bind(t.id,t.company,t.assignee,t.due_date,t.description,t.status??'open',now,now,t.created_by,t.priority??'normal',t.progress??'not_started',t.blocked_reason??'',t.series_id??null,t.occurrence_date??null,t.mutation_id??null,...args);}
function itemsInsert(env,t,titles){if(!titles.length)return [];return [env.DB.prepare("INSERT INTO checklist_items(id,task_id,title,position) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.title'),CAST(key AS INTEGER) FROM json_each(?) WHERE EXISTS(SELECT 1 FROM tasks WHERE id=? AND mutation_id=?)").bind(t.id,JSON.stringify(titles.map(title=>({id:uid(),title}))),t.id,t.mutation_id)];}
export async function createTask(env,b,user,now,jobStatements){
 const cadence=validateCadence(b.recurrence??'none');const titles=b.checklist??[];if(!Array.isArray(titles)||titles.length>30)fail('Use up to 30 checklist items.');const items=titles.map(checkTitle);
 const t={...validateTask(b),...validateExtra(b),id:uid(),version:1,created_by:user.name,mutation_id:uid(),series_id:cadence==='none'?null:uid()};
 if(t.series_id&&t.status==='done')fail('Start a recurring task as an open task.');
 const statements=[taskInsert(env,t,now,'(SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL)<2000'),eventStmt(env,t,user.name,'created','Created the task.',now,t.mutation_id),...itemsInsert(env,t,items),...jobStatements(env,t,'assigned',now)];
 if(t.series_id)statements.push(env.DB.prepare('INSERT INTO recurring_series(id,cadence,anchor_day,template,current_task_id,next_due_date) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tasks WHERE id=?)').bind(t.series_id,cadence,Number(t.due_date.slice(8)),template(t,items),t.id,nextDate(t.due_date,cadence),t.id),env.DB.prepare('UPDATE tasks SET occurrence_date=? WHERE id=?').bind(t.due_date,t.id));
 const out=await env.DB.batch(statements);if(!out[0].meta.changes)fail('The workspace has reached its 2,000-task limit.',409);return t;
}
export async function patchTask(env,id,b,user,now,jobStatements){
 const old=await accessibleTask(env,id,user);if(!Number.isInteger(b.version)||old.version!==b.version)fail('Someone changed this task. Refresh and try again.',409);
 const t={...old,...validateTask({...old,...b}),...validateExtra(b,old),version:old.version+1,mutation_id:uid()};
 const series=old.series_id?await env.DB.prepare('SELECT * FROM recurring_series WHERE id=?').bind(old.series_id).first():null;
 const cadence=validateCadence(b.recurrence??(series?.active?series.cadence:'none'));
 const current=series?.current_task_id===id;
 if(Object.hasOwn(b,'recurrence')&&series&&!current&&cadence!==(series.active?series.cadence:'none'))fail('Change the repeat schedule on the latest occurrence.');
 const startSeries=!series&&cadence!=='none';if(startSeries&&t.status==='done')fail('Reopen the task before adding a repeat schedule.');if(startSeries)t.series_id=uid();
 const changed=[];for(const field of ['company','assignee','due_date','description','priority','progress','blocked_reason'])if(t[field]!==old[field]){const label={company:'Company',assignee:'Assignee',due_date:'Due date',description:'Description',priority:'Priority',progress:'Progress',blocked_reason:'Blocked reason'}[field];const value=v=>field==='company'?COMPANIES[v]:field==='progress'?PROGRESS[v]:v;changed.push(`${label}: ${value(old[field])||'—'} → ${value(t[field])||'—'}`);}
 if(cadence!==(series?.active?series.cadence:'none'))changed.push(`Repeat: ${cadence}`);
 if(!changed.length)return old;
 const statements=[env.DB.prepare(`UPDATE tasks SET company=?,assignee=?,due_date=?,description=?,status=?,priority=?,progress=?,blocked_reason=?,series_id=?,version=version+1,updated_at=?,mutation_id=? WHERE id=? AND version=? AND ${ACCESS}`).bind(t.company,t.assignee,t.due_date,t.description,t.status,t.priority,t.progress,t.blocked_reason,t.series_id,now,t.mutation_id,id,old.version,user.name,user.name,user.name),eventStmt(env,t,user.name,'updated',changed.join('\n'),now,t.mutation_id),env.DB.prepare("UPDATE jobs SET state='cancelled' WHERE task_id=? AND version=? AND state='pending' AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND mutation_id=?)").bind(id,old.version,id,t.mutation_id)];
 const notify=['company','assignee','due_date','description','priority'].some(k=>old[k]!==t[k])||old.status==='done';
 if(t.status==='open')statements.push(...jobStatements(env,t,notify?(old.assignee!==t.assignee?'assigned':'updated'):'silent',now));
 if(current||startSeries){
 const {results:items}=await env.DB.prepare('SELECT title FROM checklist_items WHERE task_id=? ORDER BY position').bind(id).all();
 if(startSeries)statements.push(env.DB.prepare('INSERT INTO recurring_series(id,cadence,anchor_day,template,current_task_id,next_due_date) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tasks WHERE id=? AND mutation_id=?)').bind(t.series_id,cadence,Number(t.due_date.slice(8)),template(t,items.map(i=>i.title)),id,nextDate(t.due_date,cadence),id,t.mutation_id),env.DB.prepare('UPDATE tasks SET occurrence_date=? WHERE id=? AND mutation_id=?').bind(t.due_date,id,t.mutation_id));
 else{const anchor=t.due_date!==old.due_date?Number(t.due_date.slice(8)):series.anchor_day;statements.push(env.DB.prepare('UPDATE recurring_series SET cadence=?,anchor_day=?,template=?,next_due_date=?,active=?,revision=revision+1 WHERE id=? AND current_task_id=? AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND mutation_id=?)').bind(cadence==='none'?series.cadence:cadence,anchor,template(t,items.map(i=>i.title)),nextDate(t.due_date,cadence==='none'?series.cadence:cadence,anchor),cadence==='none'?0:1,series.id,id,id,t.mutation_id));}
 }
 const out=await env.DB.batch(statements);if(!out[0].meta.changes)fail('Someone changed this task. Refresh and try again.',409);return t;
}
export async function deleteTask(env,id,b,user,now){
 if(!Number.isInteger(b.version))fail('Refresh the task before deleting it.',409);
 const mutation=uid();
 const out=await env.DB.batch([
 env.DB.prepare(`UPDATE tasks SET deleted_at=?,updated_at=?,version=version+1,mutation_id=? WHERE id=? AND version=? AND ${ACCESS}`).bind(now,now,mutation,id,b.version,user.name,user.name,user.name),
 eventStmt(env,{id},user.name,'deleted','Deleted the task and stopped its reminders.',now,mutation),
 env.DB.prepare("UPDATE jobs SET state='cancelled' WHERE task_id=? AND state='pending' AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND mutation_id=?)").bind(id,id,mutation),
 env.DB.prepare('UPDATE recurring_series SET active=0,revision=revision+1 WHERE current_task_id=? AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND mutation_id=?)').bind(id,id,mutation)
 ]);
 if(!out[0].meta.changes)fail('Someone changed this task. Refresh and try again.',409);
}
export async function processRecurrences(env,jobStatements,now=Date.now()){
 const today=centralDate(now);
 const {results:series}=await env.DB.prepare("SELECT s.* FROM recurring_series s JOIN tasks t ON t.id=s.current_task_id WHERE s.active=1 AND t.deleted_at IS NULL AND (t.status='done' OR t.due_date<?) ORDER BY s.next_due_date LIMIT 1").bind(today).all();
 for(const s of series){
 const tpl=JSON.parse(s.template),mutation=uid(),t={...tpl,id:uid(),series_id:s.id,occurrence_date:s.next_due_date,due_date:s.next_due_date,version:1,status:'open',progress:'not_started',mutation_id:mutation};
 const condition="(SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL)<2000 AND EXISTS(SELECT 1 FROM recurring_series s JOIN tasks t ON t.id=s.current_task_id WHERE s.id=? AND s.revision=? AND s.active=1 AND t.deleted_at IS NULL AND (t.status='done' OR t.due_date<?))";
 await env.DB.batch([taskInsert(env,t,now,condition,[s.id,s.revision,today]),...itemsInsert(env,t,tpl.checklist||[]),eventStmt(env,t,'System','recurring',`Created the next ${s.cadence} occurrence.`,now,mutation),...jobStatements(env,t,'assigned',now),env.DB.prepare('UPDATE recurring_series SET current_task_id=?,next_due_date=?,revision=revision+1 WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND mutation_id=?)').bind(t.id,nextDate(t.due_date,s.cadence,s.anchor_day),s.id,s.revision,t.id,mutation)]);
 }
}
export async function summaryFor(env,user,now=Date.now()){
 const today=centralDate(now);const {results:tasks}=await env.DB.prepare("SELECT id,company,assignee,due_date,description,priority,progress FROM tasks WHERE deleted_at IS NULL AND status='open' AND due_date<=? AND (?='TJ' OR assignee=?) ORDER BY due_date,CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,created_at LIMIT 2000").bind(today,user.name,user.name).all();
 return {today,due_today:tasks.filter(t=>t.due_date===today),overdue:tasks.filter(t=>t.due_date<today),scope:user.name==='TJ'?'both companies':'your tasks'};
}
export async function processDigests(env,now=Date.now()){
 const date=centralDate(now),at=morning(date);
 await env.DB.prepare("UPDATE digest_jobs SET state='expired' WHERE state='pending' AND date<?").bind(date).run();
 if(now<at||now>=at+3*3600000)return;
 for(const person of PEOPLE){
 const preference=await env.DB.prepare('SELECT digest_enabled FROM user_preferences WHERE person=?').bind(person).first();if(preference?.digest_enabled===0)continue;
 const id=`${date}:${person}`;await env.DB.prepare('INSERT OR IGNORE INTO digest_jobs(id,person,date) VALUES(?,?,?)').bind(id,person,date).run();
 const claim=await env.DB.prepare("UPDATE digest_jobs SET attempts=attempts+1,lease_until=? WHERE id=? AND state='pending' AND lease_until<?").bind(now+300000,id,now).run();if(!claim.meta.changes)continue;
 const summary=await summaryFor(env,{name:person},now);
 const text=person==='TJ'?`Both companies: ${summary.due_today.length} due today, ${summary.overdue.length} overdue.`:`${person}: ${summary.due_today.length} due today, ${summary.overdue.length} overdue.`;
 const {results:subs}=await env.DB.prepare('SELECT * FROM subscriptions WHERE person=? AND verified=1 LIMIT 10').bind(person).all();
 const {results:delivered}=await env.DB.prepare('SELECT subscription_id FROM digest_deliveries WHERE job_id=?').bind(id).all();
 const remaining=subs.filter(s=>!delivered.some(d=>d.subscription_id===s.id));let pending=subs.length===0||remaining.length>1,error=subs.length===0?'Waiting for an enabled phone':null;
 for(const sub of remaining.slice(0,1)){
 try{const res=await sendPush(sub,{title:'Your morning task summary',body:text,tag:'daily-summary:'+id,url:'/?view=summary'},env);if(res.ok)await env.DB.prepare('INSERT OR IGNORE INTO digest_deliveries(job_id,subscription_id,accepted_at) VALUES(?,?,?)').bind(id,sub.id,now).run();else{pending=true;error=`Push service HTTP ${res.status}`;if(res.status===404||res.status===410)await env.DB.prepare('DELETE FROM subscriptions WHERE id=?').bind(sub.id).run();}}
 catch{pending=true;error='Push service temporarily unavailable';}}
 await env.DB.prepare("UPDATE digest_jobs SET state=?,last_error=? WHERE id=? AND state='pending'").bind(pending?'pending':'accepted',error,id).run();
 }
}
export async function details(env,t){
 const [comments,checklist,attachments,history,series]=await env.DB.batch([env.DB.prepare('SELECT * FROM (SELECT * FROM comments WHERE task_id=? ORDER BY created_at DESC,id DESC LIMIT 201) ORDER BY created_at,id').bind(t.id),env.DB.prepare('SELECT * FROM checklist_items WHERE task_id=? ORDER BY position,id').bind(t.id),env.DB.prepare('SELECT id,author,name,size,mime,created_at FROM attachments WHERE task_id=? ORDER BY created_at DESC').bind(t.id),env.DB.prepare('SELECT * FROM activity WHERE task_id=? ORDER BY created_at DESC,id DESC LIMIT 201').bind(t.id),env.DB.prepare('SELECT id,cadence,active,next_due_date,current_task_id FROM recurring_series WHERE id=?').bind(t.series_id)]);
 return {task:t,comments:comments.results,checklist:checklist.results,attachments:attachments.results,history:history.results,series:series.results[0]||null};
}
async function boundedBytes(req,max){if(Number(req.headers.get('content-length')||0)>max)fail('Each file must be 5 MB or smaller.',413);const reader=req.body?.getReader();if(!reader)fail('Choose a file.');let total=0,chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>max){await reader.cancel();fail('Each file must be 5 MB or smaller.',413);}chunks.push(value);}if(!total)fail('The file is empty.');const out=new Uint8Array(total);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;}
export async function workflowRoute(req,env,ctx,user,helpers,now){
 const path=new URL(req.url).pathname,{body,jobStatements,processJobs}=helpers;
 const background=()=>ctx.waitUntil((async()=>{await processRecurrences(env,jobStatements);await processJobs(env);})().catch(()=>console.error(JSON.stringify({event:'task_automation_failed'}))));
 if(path==='/api/tasks'&&req.method==='POST'){const t=await createTask(env,await body(req),user,now,jobStatements);background();return json({id:t.id},201);}
 if(path==='/api/summary'&&req.method==='GET')return json(await summaryFor(env,user,now));
 if(path==='/api/preferences'&&req.method==='PATCH'){const b=await body(req);if(typeof b.digest_enabled!=='boolean')fail('Choose whether to receive the daily summary.');await env.DB.prepare('INSERT INTO user_preferences(person,digest_enabled) VALUES(?,?) ON CONFLICT(person) DO UPDATE SET digest_enabled=excluded.digest_enabled').bind(user.name,b.digest_enabled?1:0).run();return json({ok:true});}
 const match=path.match(/^\/api\/tasks\/([\w-]+)(?:\/(comments|checklist|attachments)(?:\/([\w-]+))?)?$/);
 if(!match)return null;
 const [,id,resource,itemId]=match,t=await accessibleTask(env,id,user);
 if(!resource){if(req.method==='DELETE'){await deleteTask(env,id,await body(req),user,now);return json({ok:true});}if(req.method==='GET')return json(await details(env,t));if(req.method==='PATCH'){await patchTask(env,id,await body(req),user,now,jobStatements);background();return json({ok:true});}return null;}
 if(resource==='comments'&&req.method==='POST'){
 const b=await body(req);if(typeof b.body!=='string'||!b.body.trim()||b.body.trim().length>2000)fail('Write a comment of 1–2,000 characters.');
 const cid=uid();const out=await env.DB.batch([env.DB.prepare(`INSERT INTO comments(id,task_id,author,body,created_at) SELECT ?,id,?,?,? FROM tasks WHERE id=? AND ${ACCESS} AND (SELECT COUNT(*) FROM comments WHERE task_id=?)<200`).bind(cid,user.name,b.body.trim(),now,id,user.name,user.name,user.name,id),env.DB.prepare('INSERT INTO activity(id,task_id,actor,event,detail,created_at) SELECT ?,task_id,author,?,?,? FROM comments WHERE id=?').bind(uid(),'comment','Added a comment.',now,cid)]);if(!out[0].meta.changes)fail('This task has reached its 200-comment limit or your access changed.',409);return json({id:cid},201);
 }
 if(resource==='checklist'&&req.method==='POST'){
 const b=await body(req),title=checkTitle(b.title),iid=uid();const out=await env.DB.batch([env.DB.prepare(`INSERT INTO checklist_items(id,task_id,title,position) SELECT ?,id,?,COALESCE((SELECT MAX(position)+1 FROM checklist_items WHERE task_id=?),0) FROM tasks WHERE id=? AND ${ACCESS} AND (SELECT COUNT(*) FROM checklist_items WHERE task_id=?)<30`).bind(iid,title,id,id,user.name,user.name,user.name,id),env.DB.prepare('INSERT INTO activity(id,task_id,actor,event,detail,created_at) SELECT ?,task_id,?,?,?,? FROM checklist_items WHERE id=?').bind(uid(),user.name,'checklist','Added checklist item: '+title,now,iid)]);if(!out[0].meta.changes)fail('Use up to 30 checklist items per task.',409);await refreshChecklistTemplate(env,id);return json({id:iid},201);
 }
 if(resource==='checklist'&&itemId&&(req.method==='PATCH'||req.method==='DELETE')){
 const b=await body(req),item=await env.DB.prepare('SELECT * FROM checklist_items WHERE id=? AND task_id=?').bind(itemId,id).first();if(!item)fail('Checklist item not found.',404);if(item.version!==b.version)fail('This checklist changed. Refresh and try again.',409);
 const done=b.done;if(req.method==='PATCH'&&typeof done!=='boolean')fail('Choose a checklist state.');
 const query=req.method==='DELETE'?'DELETE FROM checklist_items WHERE id=? AND task_id=? AND version=?':`UPDATE checklist_items SET done=${done?1:0},version=version+1 WHERE id=? AND task_id=? AND version=?`;
 // changes() is evaluated immediately after the optimistic mutation inside the batch.
 const out=await env.DB.batch([env.DB.prepare(query+` AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND ${ACCESS})`).bind(itemId,id,b.version,id,user.name,user.name,user.name),env.DB.prepare('INSERT INTO activity(id,task_id,actor,event,detail,created_at) SELECT ?,?,?,?,?,? WHERE changes()>0').bind(uid(),id,user.name,'checklist',`${req.method==='DELETE'?'Removed':done?'Checked':'Unchecked'} checklist item: ${item.title}`,now)]);if(!out[0].meta.changes)fail('This checklist changed. Refresh and try again.',409);if(req.method==='DELETE')await refreshChecklistTemplate(env,id);return json({ok:true});
 }
 if(resource==='attachments'&&!itemId&&req.method==='POST'){
 let name;try{name=decodeURIComponent(req.headers.get('x-file-name')||'');}catch{fail('Invalid filename.');}name=name.replace(/[\x00-\x1f\x7f/\\]/g,'_').trim();if(!name||name.length>150)fail('Use a filename of up to 150 characters.');
 if(!/\.(pdf|png|jpe?g|webp|heic|txt|csv|docx|xlsx)$/i.test(name))fail('Upload a photo, PDF, text, CSV, Word, or Excel file.');
 const bytes=await boundedBytes(req,5*1024*1024),aid=uid(),mime='application/octet-stream';
 const statements=[env.DB.prepare(`INSERT INTO attachments(id,task_id,author,name,size,mime,created_at) SELECT ?,id,?,?,?,?,? FROM tasks WHERE id=? AND ${ACCESS} AND (SELECT COUNT(*) FROM attachments WHERE task_id=?)<20 AND COALESCE((SELECT SUM(size) FROM attachments),0)+?<=262144000`).bind(aid,user.name,name,bytes.length,mime,now,id,user.name,user.name,user.name,id,bytes.length)];
 for(let offset=0,part=0;offset<bytes.length;offset+=262144,part++)statements.push(env.DB.prepare('INSERT INTO attachment_chunks(attachment_id,part,data) SELECT id,?,? FROM attachments WHERE id=?').bind(part,bytes.slice(offset,offset+262144).buffer,aid));
 statements.push(env.DB.prepare('INSERT INTO activity(id,task_id,actor,event,detail,created_at) SELECT ?,task_id,author,?,?,? FROM attachments WHERE id=?').bind(uid(),'attachment','Attached file: '+name,now,aid));
 const out=await env.DB.batch(statements);if(!out[0].meta.changes)fail('File limit reached: 20 per task or 250 MB for the workspace.',409);return json({id:aid},201);
 }
 if(resource==='attachments'&&itemId&&req.method==='GET'){
 const attachment=await env.DB.prepare(`SELECT a.* FROM attachments a JOIN tasks t ON t.id=a.task_id WHERE a.id=? AND a.task_id=? AND t.deleted_at IS NULL AND (?='TJ' OR t.assignee=? OR t.created_by=?)`).bind(itemId,id,user.name,user.name,user.name).first();if(!attachment)fail('File not found.',404);
 const {results}=await env.DB.prepare('SELECT data FROM attachment_chunks WHERE attachment_id=? ORDER BY part').bind(itemId).all();const out=new Uint8Array(attachment.size);let offset=0;for(const row of results){const chunk=new Uint8Array(row.data);out.set(chunk,offset);offset+=chunk.length;}if(offset!==attachment.size)fail('Unable to read the complete file.',500);
 return new Response(out,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,'Content-Length':String(out.length),'Cache-Control':'no-store','Content-Security-Policy':"sandbox; default-src 'none'"}});
 }
 if(resource==='attachments'&&itemId&&req.method==='DELETE'){
 await body(req);const a=await env.DB.prepare('SELECT * FROM attachments WHERE id=? AND task_id=?').bind(itemId,id).first();if(!a)fail('File not found.',404);if(user.name!=='TJ'&&user.name!==a.author&&user.name!==t.created_by)fail('Only the uploader, task creator, or TJ can remove this file.',403);
 await env.DB.batch([env.DB.prepare('DELETE FROM attachments WHERE id=? AND task_id=?').bind(itemId,id),eventStmt(env,t,user.name,'attachment','Removed file: '+a.name,now)]);return json({ok:true});
 }
 return null;
}
async function refreshChecklistTemplate(env,id){
 // Single SQL statement keeps the next occurrence's checklist in sync without a lost update.
 await env.DB.prepare("UPDATE recurring_series SET template=json_set(template,'$.checklist',json(COALESCE((SELECT json_group_array(title) FROM (SELECT title FROM checklist_items WHERE task_id=? ORDER BY position,id)),'[]'))),revision=revision+1 WHERE current_task_id=? AND active=1").bind(id,id).run();
}
