const ROOT='../';
const IDS=['JAMES','OLIVIA','ETHAN','SOPHIA','NOAH','AVA','LIAM','MAYA'];
const height={idle:220,walk:205,sit:130,typing:124};
const stage=document.querySelector('#stage'), avatar=document.querySelector('#avatar'), shadow=document.querySelector('#shadow'), tag=document.querySelector('#tag');
const charSel=document.querySelector('#character'), stateSel=document.querySelector('#state');
for(const id of IDS) charSel.add(new Option(id,id));
let x=.52,y=.62,target=null,last=performance.now(),speed=.19,currentState='idle';
function setState(s){currentState=s; stateSel.value=s; const id=charSel.value;avatar.src=`${ROOT}01_characters/${id}/${id}_${s.toUpperCase()}.png`;avatar.className=s;avatar.style.height=`${height[s]}px`;tag.textContent=id; shadow.style.width=(s==='sit'||s==='typing')?'120px':'78px';shadow.style.height=(s==='sit'||s==='typing')?'25px':'18px';render()}
function render(){const r=stage.getBoundingClientRect(),px=x*r.width,py=y*r.height;avatar.style.left=px+'px';avatar.style.top=py+'px';avatar.style.transform=`translate(-50%,-98%) ${target&&target.x<x?'scaleX(-1)':''}`;avatar.style.zIndex=Math.round(y*10000);shadow.style.left=px+'px';shadow.style.top=(py-2)+'px';shadow.style.zIndex=Math.round(y*10000)-1;tag.style.left=px+'px';tag.style.top=(py-avatar.offsetHeight)+'px';tag.style.zIndex=Math.round(y*10000)+1}
function go(nx,ny){target={x:Math.max(.08,Math.min(.92,nx)),y:Math.max(.16,Math.min(.91,ny))};setState('walk')}
stage.addEventListener('click',e=>{const r=stage.getBoundingClientRect();go((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height)});charSel.onchange=()=>setState(currentState);stateSel.onchange=()=>{target=null;setState(stateSel.value)};document.querySelector('#move').onclick=()=>go(.12+Math.random()*.76,.25+Math.random()*.6);document.querySelector('#audit').onclick=()=>window.open('../06_quality/identity-audit.html','_blank');
function tick(t){const dt=Math.min(.04,(t-last)/1000);last=t;if(target){const dx=target.x-x,dy=target.y-y,d=Math.hypot(dx,dy);if(d<.006){x=target.x;y=target.y;target=null;setState('idle')}else{x+=dx/d*speed*dt;y+=dy/d*speed*dt;render()}}requestAnimationFrame(tick)}
charSel.value='OLIVIA';setState('idle');requestAnimationFrame(tick);addEventListener('resize',render);
