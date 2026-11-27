import test from 'node:test';
import assert from 'node:assert/strict';
import {celebrateCompletion,clearCelebration} from './public/celebration.js';

function environment(t,{reduced=false,hidden=false}={}){
  const nodes=[],timers=new Map();let timerId=0;
  const node=()=>({children:[],style:{setProperty(){}},setAttribute(){},append(child){this.children.push(child);},remove(){this.removed=true;}});
  const values={document:{hidden,createElement:node,body:{append(el){nodes.push(el);}}},matchMedia:()=>({matches:reduced}),innerWidth:390,innerHeight:844};
  for(const [key,value] of Object.entries(values)){
    const old=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
  }
  t.mock.method(globalThis,'setTimeout',(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;});
  t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
  t.after(clearCelebration);
  return {nodes,timers};
}
const anchor={left:30,top:300,width:20,height:20};

test('reduced-motion preference suppresses all celebration effects',t=>{
  const {nodes,timers}=environment(t,{reduced:true});
  celebrateCompletion(anchor);
  assert.equal(nodes.length,0);assert.equal(timers.size,0);
});
test('background tabs never start a celebration',t=>{
  const {nodes}=environment(t,{hidden:true});
  celebrateCompletion(anchor);assert.equal(nodes.length,0);
});
test('rapid completions replace prior effects and clean up promptly',t=>{
  const {nodes,timers}=environment(t);
  celebrateCompletion(anchor);celebrateCompletion(anchor);
  assert.equal(nodes.filter(n=>!n.removed).length,1);
  assert.ok(nodes[1].children.length<=40,'Keep the particle count bounded on phones');
  assert.equal(timers.size,1);
  const timer=[...timers.values()][0];assert.ok(timer.ms<=1600);
  timer.fn();assert.equal(nodes.filter(n=>!n.removed).length,0);
});
