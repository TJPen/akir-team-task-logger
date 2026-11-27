// A small, non-blocking celebration. Task persistence remains independent of it.
let active=null,cleanupTimer;
export function clearCelebration(){
  clearTimeout(cleanupTimer);
  active?.remove();
  active=null;
}
export function celebrateCompletion(rect){
  clearCelebration();
  if(document.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const layer=document.createElement('div');
  layer.className='completion-celebration';
  layer.setAttribute('aria-hidden','true');
  const x=Math.max(35,Math.min(innerWidth-35,rect.left+rect.width/2));
  const y=Math.max(50,Math.min(innerHeight-60,rect.top+rect.height/2));
  layer.style.setProperty('--origin-x',x+'px');
  layer.style.setProperty('--origin-y',y+'px');
  const colors=['#87b64f','#39b8ce','#f0836c','#a18bda','#e5b841'];
  for(let i=0;i<32;i++){
    const piece=document.createElement('i');
    piece.className='confetti-piece';
    const angle=(-165+Math.random()*150)*Math.PI/180;
    const distance=65+Math.random()*100;
    const dx=Math.cos(angle)*distance;
    const dy=Math.sin(angle)*distance;
    piece.style.setProperty('--dx',dx+'px');
    piece.style.setProperty('--apex-x',dx*.65+'px');
    piece.style.setProperty('--apex-y',dy+'px');
    piece.style.setProperty('--fall-y',(35+Math.random()*65)+'px');
    piece.style.setProperty('--spin',(Math.random()*480-240)+'deg');
    piece.style.setProperty('--duration',(950+Math.random()*350)+'ms');
    piece.style.setProperty('--delay',(Math.random()*70)+'ms');
    piece.style.background=colors[i%colors.length];
    piece.style.borderRadius=i%3===0?'50%':'2px';
    piece.style.width=(5+Math.random()*4)+'px';
    piece.style.height=(i%3===0?7:11)+'px';
    layer.append(piece);
  }
  active=layer;
  document.body.append(layer);
  cleanupTimer=setTimeout(clearCelebration,1500);
}
