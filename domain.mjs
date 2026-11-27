export const PEOPLE=['Ms. Tay','TJ','Felicia'];
export const COMPANIES={akir:'Akir Enterprises',xpress:'Xpress One Labs – Alabama'};
export const DAY=86400000;
export function fail(message,status=400){throw Object.assign(new Error(message),{status});}
export function centralDate(time=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(time);}
export function morning(date){const utc=Date.parse(date+'T09:00:00Z');const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'2-digit',hourCycle:'h23'}).format(utc));return utc+(9-hour)*3600000;}
export function validateTask(b){
 if(!Object.hasOwn(COMPANIES,b.company)||!PEOPLE.includes(b.assignee))fail('Choose a company and team member.');
 if(typeof b.description!=='string'||!b.description.trim()||b.description.trim().length>2000)fail('Enter a task description of 1–2,000 characters.');
 if(typeof b.due_date!=='string'||!/^20\d\d-\d{2}-\d{2}$/.test(b.due_date)||!Number.isFinite(Date.parse(b.due_date+'T12:00:00Z'))||new Date(b.due_date+'T12:00:00Z').toISOString().slice(0,10)!==b.due_date)fail('Choose a valid due date.');
 return {company:b.company,assignee:b.assignee,due_date:b.due_date,description:b.description.trim()};
}
export function nextDate(date,cadence,anchor=Number(date.slice(8))){
 const d=new Date(date+'T12:00:00Z');
 if(cadence==='monthly'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(anchor,last));}
 else d.setUTCDate(d.getUTCDate()+(cadence==='weekly'?7:1));
 return d.toISOString().slice(0,10);
}
export const PROGRESS={not_started:'Not started',in_progress:'In progress',blocked:'Blocked',completed:'Completed'};
export function validateExtra(b,old={}){
 const priority=b.priority??old.priority??'normal';if(!['normal','high','urgent'].includes(priority))fail('Choose a valid priority.');
 let progress=b.progress??old.progress??'not_started';
 if(Object.hasOwn(b,'status')&&!Object.hasOwn(b,'progress')){if(!['open','done'].includes(b.status))fail('Invalid task status.');progress=b.status==='done'?'completed':old.status==='done'?'not_started':progress;}
 if(!Object.hasOwn(PROGRESS,progress))fail('Choose a valid progress status.');
 const reason=b.blocked_reason??old.blocked_reason??'';if(typeof reason!=='string'||reason.length>1000)fail('Use a blocked reason of up to 1,000 characters.');
 if(progress==='blocked'&&!reason.trim())fail('Explain what is blocking this task.');
 return {priority,progress,status:progress==='completed'?'done':'open',blocked_reason:progress==='blocked'?reason.trim():''};
}
export function validateCadence(v){if(!['none','daily','weekly','monthly'].includes(v))fail('Choose a valid repeat schedule.');return v;}
export function checkTitle(v){if(typeof v!=='string'||!v.trim()||v.trim().length>200)fail('Use a checklist item of 1–200 characters.');return v.trim();}
