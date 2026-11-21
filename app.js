
/* Creator credit: change this one line to your name. Shown on the home screen and in the page's author tag. */
const CREATOR='hexonzero';
const $=s=>document.querySelector(s);
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const synth=window.speechSynthesis;
let ch=[],ci=0,si=0,playing=false,token=0,rate=1,voice=null,total=0,bookId='',docTitle='',pdfN=0,docPages=1;
const store={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
if(typeof pdfjsLib!=='undefined'){try{pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js'}catch(e){}}

let wakeOn=!!store.get('wake'),wl=null,wlQ=Promise.resolve(),wd=null,stall=0;
let mode=store.get('mode')==='page'?'page':'scroll',lo=0,hi=0,rpg=null,jump=false,progUntil=0,st=null;
let lib=store.get('books')||[],wish=store.get('wish')||[];
/* ---------- text -> chapters ---------- */
const seg=window.Intl&&Intl.Segmenter?new Intl.Segmenter(undefined,{granularity:'sentence'}):null;
function split(t){
  if(t.length<=260)return[t];
  const bits=[];
  t.replace(/([,;:—])\s+/g,'$1\u0001').split('\u0001').forEach(p=>{
    if(p.length<=240)bits.push(p);
    else{let c='';for(const w of p.split(/\s+/)){if(c&&(c+' '+w).length>240){bits.push(c);c=w}else c=c?c+' '+w:w}if(c)bits.push(c)}
  });
  const o=[];let c='';
  for(const p of bits){if(c&&(c+' '+p).length>240){o.push(c);c=p}else c=c?c+' '+p:p}
  if(c)o.push(c);return o;
}
function sentences(par){
  let a=[];
  if(seg){for(const x of seg.segment(par)){const t=x.segment.trim();if(t)a.push(t)}}
  else a=(par.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g)||[par]).map(x=>x.trim());
  return a.flatMap(split).filter(t=>/[\p{L}\p{N}]/u.test(t));
}
function build(title,text,pgs){
  const S=[];let n=0;
  (pgs||[{text}]).forEach(pg=>{
    pg.text.split(/\n+/).map(p=>p.replace(/\s+/g,' ').trim()).filter(Boolean).forEach(p=>{
      sentences(p).forEach((t,k)=>{S.push({t,p:k===0,o:n,pg:pg.n});n+=t.length+1});
    });
  });
  return{title,S,len:n};
}
function htmlText(d){
  d.querySelectorAll('script,style,nav').forEach(e=>e.remove());
  d.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,div,br,blockquote,tr,section').forEach(e=>e.after(d.createTextNode('\n')));
  return(d.body||d.documentElement).textContent;
}
const parseHTML=s=>new DOMParser().parseFromString(s,'text/html');

/* ---------- parsers: each returns [{title,text}] ---------- */
async function readPdf(buf){
  if(typeof pdfjsLib==='undefined')throw new Error('The PDF reader failed to load. Check your connection and reload the page.');
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  const pages=[];
  for(let i=1;i<=pdf.numPages;i++){
    const tc=await (await pdf.getPage(i)).getTextContent();
    let s='';tc.items.forEach(it=>{s+=it.str+(it.hasEOL?'\n':' ')});
    pages.push(s.replace(/-\n(?=[a-z])/g,'').replace(/\s+/g,' ').trim());
    if(i%10===0)setMsg('Reading page '+i+' of '+pdf.numPages+'…');
  }
  let starts=[];
  try{
    const ol=await pdf.getOutline();
    for(const it of ol||[]){
      let d=it.dest;if(typeof d==='string')d=await pdf.getDestination(d);
      if(d)starts.push({title:it.title,idx:await pdf.getPageIndex(d[0])});
    }
  }catch(e){}
  starts=starts.sort((a,b)=>a.idx-b.idx).filter((x,i,a)=>!i||x.idx!==a[i-1].idx);
  pdfN=pages.length;
  const mk=(title,a,b)=>({title,text:'',pages:pages.slice(a,b).map((t,i)=>({n:a+i+1,text:t}))});
  const out=[];
  if(starts.length>=2){
    if(starts[0].idx>0)out.push(mk('Beginning',0,starts[0].idx));
    starts.forEach((x,i)=>out.push(mk(x.title,x.idx,i+1<starts.length?starts[i+1].idx:undefined)));
  }else{
    for(let i=0;i<pages.length;i+=5)out.push(mk('Pages '+(i+1)+(pages.length>i+1?'–'+Math.min(i+5,pages.length):''),i,i+5));
  }
  return out;
}
async function readEpub(buf){
  if(typeof JSZip==='undefined')throw new Error('The file reader failed to load. Check your connection and reload the page.');
  const z=await JSZip.loadAsync(buf);
  const txt=async p=>(await z.file(p).async('string'));
  const cont=new DOMParser().parseFromString(await txt('META-INF/container.xml'),'application/xml');
  const opfPath=cont.querySelector('rootfile').getAttribute('full-path');
  const opf=new DOMParser().parseFromString(await txt(opfPath),'application/xml');
  const t=opf.getElementsByTagName('dc:title')[0];if(t)docTitle=t.textContent;
  const base=opfPath.includes('/')?opfPath.replace(/[^/]*$/,''):'';
  const man={};opf.querySelectorAll('manifest > item').forEach(i=>man[i.getAttribute('id')]=i.getAttribute('href'));
  const out=[];let n=0;
  for(const r of opf.querySelectorAll('spine > itemref')){
    const href=man[r.getAttribute('idref')];if(!href)continue;
    let dh=href;try{dh=decodeURI(href)}catch(e){}const f=z.file(base+dh)||z.file(dh);if(!f)continue;
    const d=parseHTML(await f.async('string'));
    const h=d.querySelector('h1,h2,h3');const title=h&&h.textContent.trim();
    const text=htmlText(d);
    if(text.replace(/\s/g,'').length<80)continue;
    out.push({title:title||('Section '+(++n)),text});
  }
  return out;
}
async function readDocx(buf){
  if(typeof JSZip==='undefined')throw new Error('The file reader failed to load. Check your connection and reload the page.');
  const z=await JSZip.loadAsync(buf);
  const x=new DOMParser().parseFromString(await z.file('word/document.xml').async('string'),'application/xml');
  const out=[];let cur={title:'Beginning',text:''};
  for(const p of x.getElementsByTagName('w:p')){
    let s='';for(const n of p.getElementsByTagName('*')){if(n.nodeName==='w:t')s+=n.textContent;else if(n.nodeName==='w:tab')s+=' '}
    s=s.trim();if(!s)continue;
    const st=p.getElementsByTagName('w:pStyle')[0];
    if(st&&/^(Heading[1-2]|Title)/i.test(st.getAttribute('w:val')||'')){out.push(cur);cur={title:s,text:''}}
    cur.text+=s+'\n';
  }
  out.push(cur);return out.filter(c=>c.text.trim());
}
function splitBig(list){
  const o=[];
  list.forEach(c=>{
    if(list.length>1||c.pages||c.text.length<9000){o.push(c);return}
    const paras=c.text.split(/\n+/);let cur='',n=1;
    paras.forEach(p=>{if(cur.length>6000){o.push({title:'Part '+n++,text:cur});cur=''}cur+=p+'\n'});
    if(cur.trim())o.push({title:'Part '+n,text:cur});
  });
  return o;
}

/* ---------- loading ---------- */
function setMsg(t,err){const m=$('#msg');m.textContent=t;m.className=err?'err':''}
async function load(file){
  setMsg('Opening '+file.name+'…');docTitle=file.name.replace(/\.[^.]+$/,'');pdfN=0;
  stop();
  try{
    const ext=file.name.split('.').pop().toLowerCase();let list;
    if(ext==='pdf')list=await readPdf(await file.arrayBuffer());
    else if(ext==='epub')list=await readEpub(await file.arrayBuffer());
    else if(ext==='docx')list=await readDocx(await file.arrayBuffer());
    else if(ext==='html'||ext==='htm')list=htmlChapters(await file.text(),docTitle);
    else if(ext==='txt'||ext==='md')list=[{title:docTitle,text:await file.text()}];
    else throw new Error('This file type isn’t supported. Try PDF, EPUB, DOCX, TXT or HTML.');
    ch=splitBig(list).map(c=>build(c.title,c.text,c.pages)).filter(c=>c.S.length);
    if(!ch.length)throw new Error('No readable text found. Scanned PDFs without a text layer can’t be read aloud.');
    total=0;ch.forEach(c=>{c.off=total;total+=c.len});
    bookId=file.name+'|'+file.size;docPages=pdfN||Math.max(1,Math.ceil(total/1800));
    let b=lib.find(x=>x.id===bookId);
    if(!b){b={id:bookId,name:file.name,title:docTitle,added:Date.now(),ci:0,si:0};lib.push(b);try{await fput(bookId,file)}catch(e){}}
    ci=ch[b.ci]?b.ci:0;si=ch[ci].S[b.si]?b.si:0;
    $('#title').textContent=docTitle;
    $('#chlist').innerHTML=ch.map((c,i)=>'<button data-c="'+i+'">'+(i+1)+'. '+esc(c.title.slice(0,80))+'</button>').join('');
    $('#home').hidden=true;$('#homeBtn').hidden=false;$('#chbar').hidden=false;$('#menuBtn').hidden=false;$('#title').hidden=true;$('#pane').hidden=false;$('#fab').hidden=false;sheet(false);window.fabClamp&&window.fabClamp();setMsg('');hintOnce();
    jump=true;render();mark();jump=false;
    return true;
  }catch(e){console.error(e);showTab('add');setMsg(e.message||'Couldn’t open that file.',true);return false}
}

/* ---------- reading pane ---------- */
/* Two reading views: "scroll" = endless scroll (chapters load as you go, both directions),
   "page" = one page at a time (real PDF pages, otherwise ~1800 characters, matching the "Page x of y" numbers). */
function spansHTML(c,k,a,b){
  let h='';
  for(let i=a;i<=b;i++){const t=c.S[i];if(t.p&&i>a)h+='</p><p>';h+='<span class="s" data-c="'+k+'" data-i="'+i+'">'+esc(t.t)+' </span>'}
  return h;
}
const chHTML=k=>'<section class="chap" data-c="'+k+'"><h2>'+esc(ch[k].title)+'</h2><p>'+spansHTML(ch[k],k,0,ch[k].S.length-1)+'</p></section>';
function pagesOf(c){
  if(c.pgs)return c.pgs;
  const key=i=>c.S[i].pg!==undefined?c.S[i].pg:Math.floor((c.off+c.S[i].o)/1800),out=[];let a=0;
  for(let i=1;i<=c.S.length;i++){if(i===c.S.length||key(i)!==key(i-1)){out.push([a,i-1]);a=i}}
  return c.pgs=out;
}
const pageIdx=(c,i)=>{const p=pagesOf(c);for(let k=0;k<p.length;k++)if(i<=p[k][1])return k;return p.length-1};
function pageHTML(){
  const c=ch[ci],pg=pagesOf(c),pi=pageIdx(c,si),r=pg[pi],t0=c.S[r[0]];
  rpg={c:ci,a:r[0],b:r[1]};
  const no=t0.pg||Math.floor((c.off+t0.o)/1800)+1;
  return '<section class="chap" data-c="'+ci+'">'+(pi===0?'<h2>'+esc(c.title)+'</h2>':'')+'<p>'+spansHTML(c,ci,r[0],r[1])+'</p></section>'
   +'<nav class="pager"><button type="button" data-pg="-1"'+(pi===0&&ci===0?' disabled':'')+'>‹ Previous</button><span>Page '+(pdfN?'':'~')+no+' of '+docPages+'</span><button type="button" data-pg="1"'+(pi===pg.length-1&&ci===ch.length-1?' disabled':'')+'>Next ›</button></nav>';
}
function render(){
  const pane=$('#pane'),m=$('#main');
  if(mode==='page'){pane.innerHTML=pageHTML();m.scrollTop=0;return}
  rpg=null;lo=hi=ci;pane.innerHTML=chHTML(ci);m.scrollTop=0;fill();
}
function appendCh(){if(hi>=ch.length-1)return;hi++;$('#pane').insertAdjacentHTML('beforeend',chHTML(hi));trim()}
function prependCh(){
  if(lo<=0)return;lo--;
  const m=$('#main'),b=m.scrollHeight;$('#pane').insertAdjacentHTML('afterbegin',chHTML(lo));m.scrollTop+=m.scrollHeight-b;   /* keep the view where it was */
}
function trim(){   /* drop chapters far above the reader so very long books stay light */
  const m=$('#main');
  while(hi-lo>6&&lo<ci-1){const e=$('#pane .chap[data-c="'+lo+'"]');if(e){const b=m.scrollHeight;e.remove();m.scrollTop-=b-m.scrollHeight}lo++}
}
function fill(){
  if(mode!=='scroll'||$('#pane').hidden||!ch.length)return;
  const m=$('#main');let n=0;
  while(hi<ch.length-1&&m.scrollHeight-m.scrollTop-m.clientHeight<1500&&n++<3)appendCh();
  if(lo>0&&m.scrollTop<500)prependCh();
}
function showCh(c){   /* make sure chapter c is on screen-able in the DOM */
  if(mode==='page'){render();return}
  if(c>=lo&&c<=hi)return;
  if(c===hi+1)appendCh();else if(c===lo-1)prependCh();else render();
}
function syncScroll(){   /* when not playing, the reading position follows what you scroll to */
  if(mode!=='scroll'||playing||!ch.length||$('#pane').hidden||Date.now()<progUntil)return;
  const x=innerWidth/2,y0=innerHeight*0.35;let el=null;
  for(const dy of [0,20,-20,40,-40,70,-70,100]){const e=document.elementFromPoint(x,y0+dy);el=e&&e.closest?e.closest('.s'):null;if(el)break}
  if(!el)return;
  const c=+el.dataset.c,i=+el.dataset.i;
  if(c!==ci||i!==si){ci=c;si=i;mark(true)}
}
function setMode(m){
  mode=m;store.set('mode',m);
  if(ch.length){jump=true;render();mark();jump=false}
  toast(m==='page'?'Page by page':'Infinite scroll');
}
function vis(el){const r=el.getBoundingClientRect();return r.top>=70&&r.bottom<=innerHeight*0.8}
function pageNav(d){
  const c=ch[ci],pg=pagesOf(c),pi=pageIdx(c,si);
  if(d>0){if(pi+1<pg.length)go(ci,pg[pi+1][0]);else if(ci+1<ch.length)go(ci+1,0);else toast('End of book')}
  else{if(pi>0)go(ci,pg[pi-1][0]);else if(ci>0){const p=pagesOf(ch[ci-1]);go(ci-1,p[p.length-1][0])}else toast('Start of book')}
}
function mark(noscroll){
  const c=ch[ci],s=c.S[si];
  if(mode==='page'&&(!rpg||rpg.c!==ci||si<rpg.a||si>rpg.b))render();
  const prev=$('.s.on');if(prev)prev.classList.remove('on');
  const pp=$('#pane p.on');if(pp)pp.classList.remove('on');
  const el=$('.s[data-c="'+ci+'"][data-i="'+si+'"]');
  if(el){
    el.classList.add('on');el.parentNode.classList.add('on');
    if((follow||jump)&&!noscroll&&(playing||jump||!vis(el))){
      progUntil=Date.now()+1000;
      const sec=si===0&&mode==='scroll'?el.closest('.chap'):null;
      (sec||el).scrollIntoView({block:sec?'start':'center',behavior:jump||matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
    }
  }
  $('#now').textContent=s.t;
  $('#chap').textContent=docTitle+' · Page '+(pdfN?'':'~')+pageNow()+' of '+docPages;
  $('#ctt').textContent='Chapter '+(ci+1)+' · '+c.title;$('#cv').textContent=(docTitle||'R').charAt(0).toUpperCase();
  const pos=c.off+s.o,cps=15*rate;
  $('#seek').value=Math.round(s.o/c.len*1000);
  $('#pct').textContent=Math.floor(pos/total*100)+'% read';$('#rp').style.strokeDashoffset=String(182*(1-s.o/c.len));
  $('#t1').textContent=fmt(s.o/cps);$('#t2').textContent='≈ −'+fmt((c.len-s.o)/cps);
  $('#left').textContent='≈ '+Math.max(1,Math.round((c.len-s.o)/cps/60))+' min left in chapter';
  $('#chname').textContent=c.title;$('#chn').textContent='Ch. '+(ci+1)+' / '+ch.length+':';
  const cur=$('#chlist .cur');if(cur)cur.classList.remove('cur');
  const nb=$('#chlist [data-c="'+ci+'"]');if(nb)nb.classList.add('cur');
  const b=lib.find(x=>x.id===bookId);
  if(b){Object.assign(b,{ci,si,pct:Math.floor(pos/total*100),page:pageNow(),pages:docPages,est:!pdfN,chNo:ci+1,chTotal:ch.length,chTitle:c.title,last:Date.now()});store.set('books',lib)}
  if('mediaSession'in navigator){try{navigator.mediaSession.metadata=new MediaMetadata({title:c.title,artist:docTitle})}catch(e){}}
}
function go(c,s){
  c=Math.max(0,Math.min(ch.length-1,c));
  const changed=c!==ci;ci=c;si=Math.max(0,Math.min(ch[ci].S.length-1,s));
  if(changed){showCh(ci);toast('Chapter '+(ci+1)+' · '+ch[ci].title)}
  mark();if(playing)speak();
}
const nextS=()=>si+1<ch[ci].S.length?go(ci,si+1):ci+1<ch.length?go(ci+1,0):finish();
const prevS=()=>si>0?go(ci,si-1):ci>0?go(ci-1,ch[ci-1].S.length-1):0;
const nextC=()=>ci+1<ch.length&&go(ci+1,0);
const prevC=()=>si>2||ci===0?go(ci,0):go(ci-1,0);

/* ---------- speech ---------- */
/* Browser voices can't be pre-rendered, but the engine accepts a queue. Keeping the next few
   sentences queued lets it fetch/prepare them while the current one is still talking, so there is no gap. */
const AHEAD=3;let nq=null,part=null;
const posAfter=(c,s)=>{s++;if(s>=ch[c].S.length){c++;s=0}return c<ch.length?{c,s}:null};
function speak(){
  const t=++token;synth.cancel();
  if(!playing)return;
  let txt=ch[ci].S[si].t;
  if(part&&part.c===ci&&part.s===si)txt=txt.slice(part.o)||txt;
  part=null;nq=posAfter(ci,si);
  queueU(t,ci,si,txt);
  for(let n=0;n<AHEAD;n++)topUp(t);
}
function topUp(t){
  if(t!==token||!nq)return;
  const p=nq;nq=posAfter(p.c,p.s);queueU(t,p.c,p.s,ch[p.c].S[p.s].t);
}
function advance(t,c,s){
  if(t!==token||!playing)return;
  if(c!==ci||s!==si){const changed=c!==ci;ci=c;si=s;if(changed){showCh(ci);toast('Chapter '+(ci+1)+' · '+ch[ci].title)}mark();topUp(t)}
}
function queueU(t,c,s,txt){
  const u=new SpeechSynthesisUtterance(spoken(txt)),last=!posAfter(c,s);
  if(voice){u.voice=voice;u.lang=voice.lang}
  u.rate=rate;u.volume=muted?0:1;
  /* some voices never fire onstart, so onend also moves the highlight on (advance ignores repeats) */
  u.onstart=()=>advance(t,c,s);
  u.onend=()=>{if(t!==token||!playing)return;if(last)finish();else{const n=posAfter(c,s);advance(t,n.c,n.s)}};
  u.onerror=e=>{if(t===token&&playing&&last&&e.error!=='canceled'&&e.error!=='interrupted')finish()};
  synth.speak(u);
}
const keep=new Audio();keep.loop=true;
(function(){try{const n=8000,b=new Uint8Array(44+n),d=new DataView(b.buffer),w=(o,s)=>[...s].forEach((c,i)=>d.setUint8(o+i,c.charCodeAt(0)));
w(0,'RIFF');d.setUint32(4,36+n,true);w(8,'WAVEfmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,8000,true);d.setUint32(28,8000,true);d.setUint16(32,1,true);d.setUint16(34,8,true);w(36,'data');d.setUint32(40,n,true);b.fill(128,44);
let s='';b.forEach(x=>s+=String.fromCharCode(x));keep.src='data:audio/wav;base64,'+btoa(s)}catch(e){}})();
function setPlaying(p){
  playing=p;$('#fab').classList.toggle('playing',p);
  document.querySelectorAll('.pp').forEach(b=>{b.innerHTML='<svg viewBox="0 0 24 24">'+(p?'<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>':'<path d="M8 5l11 7-11 7z"/>')+'</svg>';b.setAttribute('aria-label',p?'Pause':'Play')});
  try{if(p)keep.play().catch(()=>{});else keep.pause()}catch(e){}
  wakeSync();watch(p);
  if('mediaSession'in navigator)navigator.mediaSession.playbackState=p?'playing':'paused';
}
function toggle(){
  if(!ch.length)return;
  if(!synth){toast('This browser can’t read aloud');return}
  setPlaying(!playing);speak();
}
/* watchdog: if the speech engine silently dies (a known Chrome quirk) restart it instead of staying "playing" in silence */
function watch(on){
  clearInterval(wd);stall=0;
  if(on)wd=setInterval(()=>{
    if(!playing||document.hidden){stall=0;return}
    if(!synth.speaking&&!synth.pending){if(++stall>=2){stall=0;if(!posAfter(ci,si))finish();else speak()}}else stall=0;
  },2500);
}
/* keep the screen on while reading (user preference) */
function wakeSync(){
  wlQ=wlQ.then(async()=>{
    const want=wakeOn&&playing&&document.visibilityState==='visible'&&!!navigator.wakeLock;
    if(want&&!wl){wl=await navigator.wakeLock.request('screen');wl.addEventListener('release',()=>{wl=null})}
    else if(!want&&wl){const x=wl;wl=null;await x.release()}
  }).catch(()=>{wl=null});
}
function wakeSet(v){
  if(v&&!navigator.wakeLock){toast('This browser can’t keep the screen on');return}
  wakeOn=v;store.set('wake',v);wakeSync();toast(v?'Screen stays on while reading':'Screen can sleep normally');
}
function stop(){setPlaying(false);token++;synth.cancel()}
function finish(){stop();toast('Finished reading',2200)}

/* ---------- controls ---------- */
document.querySelectorAll('#sheet .pp').forEach(b=>b.onclick=toggle);
document.querySelectorAll('.prc').forEach(b=>b.onclick=prevC);
document.querySelectorAll('.nxc').forEach(b=>b.onclick=nextC);
$('#ns').onclick=nextS;$('#ps').onclick=prevS;
$('#rate').oninput=e=>{rate=+e.target.value;store.set('rate',rate);if(ch.length)mark()};
$('#rate').onchange=()=>{if(playing)speak()};
function chList(open){
  const l=$('#chlist');l.hidden=!open;$('#chbar').setAttribute('aria-expanded',open);
  if(open){const c=l.querySelector('.cur');if(c)l.scrollTop=c.offsetTop-80}
}
$('#chbar').onclick=()=>chList($('#chlist').hidden);
$('#chlist').onclick=e=>{const b=e.target.closest('[data-c]');if(b){chList(false);go(+b.dataset.c,0)}};
document.addEventListener('click',e=>{if(!e.target.closest('.top'))chList(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape')chList(false)});
const seek=$('#seek');
seek.oninput=()=>{const c=ch[ci],o=seek.value/1000*c.len,k=15*rate;$('#t1').textContent=fmt(o/k);$('#t2').textContent='≈ −'+fmt((c.len-o)/k)};
seek.onchange=()=>{const rel=seek.value/1000*ch[ci].len;let s=0;ch[ci].S.forEach((x,i)=>{if(x.o<=rel)s=i});go(ci,s)};
$('#pane').onclick=e=>{
  const pb=e.target.closest('[data-pg]');if(pb){pageNav(+pb.dataset.pg);return}
  const s=e.target.closest('.s'),n=Date.now();
  if(coarse&&n-lastTap<320){lastTap=0;toggle();toast(playing?'Playing':'Paused');buzz();return}
  lastTap=n;if(s)go(+s.dataset.c,+s.dataset.i);
};
document.addEventListener('keydown',e=>{
  if(!ch.length||!$('#home').hidden||/INPUT|SELECT|BUTTON|TEXTAREA/.test(e.target.tagName))return;
  if(e.code==='Space'){e.preventDefault();toggle()}
  else if(e.key==='ArrowRight'){e.preventDefault();e.shiftKey?nextC():nextS()}
  else if(e.key==='ArrowLeft'){e.preventDefault();e.shiftKey?prevC():prevS()}
});
document.addEventListener('visibilitychange',()=>{wakeSync();if(playing&&!synth.speaking&&!synth.pending)speak()});
if('mediaSession'in navigator){
  const h=(a,f)=>{try{navigator.mediaSession.setActionHandler(a,f)}catch(e){}};
  h('play',()=>{if(!playing)toggle()});h('pause',()=>{if(playing)toggle()});
  h('nexttrack',nextC);h('previoustrack',prevC);h('seekforward',nextS);h('seekbackward',prevS);
}

/* ---------- voices (this browser / device) ---------- */
let dev=[];
const isNat=v=>!v.localService||/natural|neural|online|google/i.test(v.name);
const isUS=v=>/^en[-_]US$/i.test(v.lang);
function pickVoice(v,save){
  if(![...$('#voice').options].some(x=>x.value===v))v=($('#voice').options[0]||{}).value||'';
  $('#voice').value=v;if(save)store.set('voice3',v);
  voice=dev.find(x=>x.voiceURI===v)||null;
}
function loadVoices(){
  dev=synth?synth.getVoices():[];
  const lang=(navigator.language||'en').slice(0,2);
  const sc=v=>isUS(v)?4:v.lang.toLowerCase().startsWith(lang)?2:0;
  dev.sort((a,b)=>(isNat(b)-isNat(a))||(sc(b)-sc(a))||a.name.localeCompare(b.name));
  const opt=v=>'<option value="'+esc(v.voiceURI)+'">'+esc(v.name)+' ('+v.lang+')</option>';
  const nat=dev.filter(isNat),oth=dev.filter(v=>!isNat(v));
  $('#voice').innerHTML=(nat.length?'<optgroup label="Natural / online voices">'+nat.map(opt).join('')+'</optgroup>':'')+(oth.length?'<optgroup label="Other voices on this device">'+oth.map(opt).join('')+'</optgroup>':'')||'<option value="">No voices found</option>';
  const def=dev.find(v=>isNat(v)&&isUS(v))||dev.find(isUS)||dev[0];
  pickVoice(store.get('voice3')||(def&&def.voiceURI)||'',false);
}
$('#voice').onchange=e=>{pickVoice(e.target.value,true);if(playing)speak()};
loadVoices();if(synth)synth.onvoiceschanged=loadVoices;
$('#rate').innerHTML=[0.6,0.8,1,1.2,1.4,1.6,1.8,2,2.5,3].map(v=>'<option value="'+v+'">'+v.toFixed(1)+'×</option>').join('');$('#rate').value='1';
const sr=store.get('rate');if(sr&&[...$('#rate').options].some(o=>+o.value===sr)){rate=sr;$('#rate').value=String(sr)}

/* ---------- file input ---------- */
const fi=$('#file');
$('#drop').onclick=()=>fi.click();
$('#drop').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fi.click()}};
fi.onchange=()=>{if(fi.files[0])load(fi.files[0]);fi.value=''};
const hasF=e=>e.dataTransfer&&[...(e.dataTransfer.types||[])].includes('Files');
['dragover','dragenter'].forEach(t=>document.addEventListener(t,e=>{if(!hasF(e))return;e.preventDefault();$('#drop').classList.add('over')}));
['dragleave','drop'].forEach(t=>document.addEventListener(t,e=>{if(t==='drop'&&!hasF(e))return;e.preventDefault();$('#drop').classList.remove('over')}));
document.addEventListener('drop',e=>{const f=e.dataTransfer&&e.dataTransfer.files[0];if(f)load(f)});

/* ---------- home: books + wishlist ---------- */
function pageNow(){const s=ch[ci].S[si];return s.pg||Math.floor((ch[ci].off+s.o)/1800)+1}
let _db=null;
const idb=()=>_db||(_db=new Promise((res,rej)=>{const r=indexedDB.open('readaloud',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}).catch(e=>{_db=null;throw e}));
async function fx(mode,fn){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction('files',mode);const q=fn(t.objectStore('files'));t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error)})}
const fput=(k,v)=>fx('readwrite',s=>s.put(v,k));
const fget=k=>fx('readonly',s=>s.get(k));
const fdel=k=>fx('readwrite',s=>s.delete(k));
function showTab(n){
  ['add','books','wish'].forEach(t=>{$('#tab-'+t).setAttribute('aria-selected',t===n);$('#p-'+t).hidden=t!==n});
  if(n==='books')renderBooks();if(n==='wish')renderWish();
}
function renderBooks(){
  const L=[...lib].sort((a,b)=>(b.last||b.added)-(a.last||a.added));
  $('#nb').textContent=L.length||'';
  $('#p-books').innerHTML=L.length?L.map(b=>{
    const p=b.pct||0;
    const info=b.chTotal?'Page '+(b.est?'~':'')+b.page+' of '+b.pages+' · Chapter '+b.chNo+' of '+b.chTotal+(b.chTitle?' · '+esc(b.chTitle.slice(0,40)):''):'Not started';
    return '<div class="card" tabindex="0" role="button" data-id="'+encodeURIComponent(b.id)+'"><button class="x" data-del="'+encodeURIComponent(b.id)+'">Remove</button><h3>'+esc(b.title||b.name)+'</h3><p>'+info+'</p><div class="meter"><i style="width:'+p+'%"></i></div><p style="margin:6px 0 0">'+p+'% finished</p></div>';
  }).join(''):'<div class="empty">No books yet. Add a file and it will show up here.</div>';
}
async function openBook(id){
  try{
    const f=await fget(id);if(!f)throw 0;
    await load(f instanceof File?f:new File([f],lib.find(b=>b.id===id).name));
  }catch(e){showTab('add');setMsg('This file isn’t stored on your device any more. Add it again to continue where you left off.',true)}
}
$('#p-books').onclick=async e=>{
  const x=e.target.closest('[data-del]');
  if(x){
    e.stopPropagation();
    if(!x.dataset.arm){x.dataset.arm=1;x.textContent='Tap again';return}
    const id=decodeURIComponent(x.dataset.del);
    lib=lib.filter(b=>b.id!==id);store.set('books',lib);try{await fdel(id)}catch(_){}
    renderBooks();return;
  }
  const c=e.target.closest('.card');if(c)openBook(decodeURIComponent(c.dataset.id));
};
$('#p-books').onkeydown=e=>{if(e.key==='Enter'&&e.target.classList.contains('card'))openBook(decodeURIComponent(e.target.dataset.id))};
function renderWish(){
  $('#wl').innerHTML=wish.length?wish.map((w,i)=>'<div class="wi'+(w.done?' done':'')+'"><input type="checkbox" data-d="'+i+'"'+(w.done?' checked':'')+' aria-label="Mark as read"><div><b>'+esc(w.t)+'</b>'+(w.n?'<small>'+esc(w.n)+'</small>':'')+'</div><button data-r="'+i+'" aria-label="Remove">✕</button></div>').join(''):'<div class="empty">Nothing saved yet. Write down what you want to read later.</div>';
}
function addWish(){const t=$('#wt').value.trim();if(!t)return;wish.unshift({t,n:$('#wn').value.trim(),done:false});store.set('wish',wish);$('#wt').value='';$('#wn').value='';renderWish();$('#wt').focus()}
$('#wadd').onclick=addWish;
['#wt','#wn'].forEach(s=>$(s).onkeydown=e=>{if(e.key==='Enter')addWish()});
$('#wl').onclick=e=>{
  const d=e.target.closest('[data-d]'),r=e.target.closest('[data-r]');
  if(d){wish[+d.dataset.d].done=d.checked;store.set('wish',wish)}
  if(r){wish.splice(+r.dataset.r,1);store.set('wish',wish)}
  if(d||r)renderWish();
};
['add','books','wish'].forEach(t=>$('#tab-'+t).onclick=()=>{setMsg('');showTab(t)});
$('#homeBtn').onclick=()=>{
  stop();chList(false);$('#menu').hidden=true;$('#menuBtn').hidden=true;$('#title').hidden=false;$('#chbar').hidden=true;$('#pane').hidden=true;$('#fab').hidden=true;sheet(false);$('#homeBtn').hidden=true;
  $('#home').hidden=false;$('#title').textContent='Read Aloud';showTab('books');
};
/* ---------- player: sheet, floating button, gestures ---------- */
let hm=['s','p','o'].includes(store.get('hm'))?store.get('hm'):'p',follow=true,muted=false,sleepMin=0,sleepT=null,
  theme=store.get('theme')||'auto',fs=store.get('fs')||19,lastTap=0,skipClick=false,tt=null;
const fmt=sec=>{sec=Math.max(0,Math.round(sec));return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')};
const buzz=()=>{try{navigator.vibrate&&navigator.vibrate(12)}catch(e){}};
function toast(m,ms=1300){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('on'),ms)}
function hintOnce(){if(!store.get('hint')){store.set('hint',1);toast('Swipe ← → for sentences · double-tap the text to play or pause',4000)}}
function applyTheme(){const r=document.documentElement;if(theme==='auto')r.removeAttribute('data-theme');else r.setAttribute('data-theme',theme)}
function applyFs(){document.documentElement.style.setProperty('--fs',fs+'px')}
applyTheme();applyFs();$('#pane').className='hm-'+hm;
function sheet(open){$('#sheet').hidden=!open;$('#fab').classList.toggle('away',open);$('#menu').hidden=true}

/* ---------- reading filters: characters / words that are left out of the speech (the screen text is unchanged) ---------- */
let flt=Object.assign({special:false,emoji:false,cite:false,url:false,custom:''},store.get('filters')||{}),fre=[],fdirty=false;
const SPECIAL=/[^\p{L}\p{N}\p{M}\s.,;:!?'"’‘“”()\-–—…%$€£¥&]/gu,EMOJI=/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu,FKEYS=['special','emoji','cite','url'];
const filtersOn=()=>FKEYS.some(k=>flt[k])||fre.length>0;
function compileFilters(){
  fre=[];
  String(flt.custom||'').split('\n').map(x=>x.trim()).filter(Boolean).slice(0,200).forEach(w=>{
    const e=w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),word=/^[\p{L}\p{N}_'’-]+$/u.test(w);
    try{fre.push({w:word,re:word?new RegExp('(^|[^\\p{L}\\p{N}])'+e+'(?![\\p{L}\\p{N}])','giu'):new RegExp(e,'g')})}catch(x){}
  });
}
function spoken(t){
  if(!filtersOn())return t;
  if(flt.url)t=t.replace(/https?:\/\/\S+|www\.\S+/gi,' ');
  if(flt.cite)t=t.replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g,' ');
  fre.forEach(f=>{t=t.replace(f.re,f.w?'$1 ':' ')});
  if(flt.emoji)t=t.replace(EMOJI,' ');
  if(flt.special)t=t.replace(SPECIAL,' ');
  t=t.replace(/\s+/g,' ').trim();
  return /[\p{L}\p{N}]/u.test(t)?t:' ';
}
compileFilters();
const fd=$('#flt');
function openFilters(){
  if(!fd.showModal){toast('This browser can’t show the filter window');return}
  FKEYS.forEach(k=>$('#f-'+k).checked=!!flt[k]);$('#f-custom').value=flt.custom||'';fdirty=false;fd.showModal();
}
fd.addEventListener('input',()=>{FKEYS.forEach(k=>flt[k]=$('#f-'+k).checked);flt.custom=$('#f-custom').value;store.set('filters',flt);compileFilters();fdirty=true});
fd.addEventListener('close',()=>{if(fdirty&&playing)speak();fdirty=false});
fd.addEventListener('click',e=>{if(e.target===fd)fd.close()});
$('#f-done').onclick=()=>fd.close();

function renderMenu(){
  const on=v=>v?'On':'Off';
  $('#menu').innerHTML='<button data-a="wake" role="switch" aria-checked="'+wakeOn+'">Keep screen on<i class="sw"></i></button>'
   +'<button data-a="sleep">Sleep timer<span>'+(sleepMin?sleepMin+' min':'Off')+'</span></button>'
   +'<button data-a="filters">Reading filters<span>'+(filtersOn()?'On':'Off')+'</span></button>'
   +'<button data-a="mute">Mute<span>'+on(muted)+'</span></button>'
   +'<button data-a="view">Reading view<span>'+(mode==='page'?'Page by page':'Infinite scroll')+'</span></button>'
   +'<button data-a="follow">Follow text<span>'+on(follow)+'</span></button>'
   +'<button data-a="theme">Theme<span>'+theme+'</span></button>'
   +'<div class="row">Text size<span><button data-a="fs-" aria-label="Smaller text">A−</button><button data-a="fs+" aria-label="Larger text">A+</button></span></div>'
   +'<h4>Highlight</h4>'+[['s','Sentence'],['p','Paragraph'],['o','Off']].map(h=>'<button data-h="'+h[0]+'">'+h[1]+'<span>'+(hm===h[0]?'✓':'')+'</span></button>').join('');
}
$('#gear').onclick=()=>{const m=$('#menu');m.hidden=!m.hidden;if(!m.hidden)renderMenu()};
$('#xp').onclick=()=>sheet(false);
$('#menu').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;const a=b.dataset.a,L=[0,15,30,60],T=['auto','light','dark','sepia'];
  if(a==='wake')wakeSet(!wakeOn);
  else if(a==='sleep'){sleepMin=L[(L.indexOf(sleepMin)+1)%4];clearTimeout(sleepT);if(sleepMin)sleepT=setTimeout(()=>{stop();sleepMin=0},sleepMin*60000)}
  else if(a==='filters'){$('#menu').hidden=true;openFilters();return}
  else if(a==='mute'){muted=!muted;if(playing)speak()}
  else if(a==='view')setMode(mode==='page'?'scroll':'page');
  else if(a==='follow')follow=!follow;
  else if(a==='theme'){theme=T[(T.indexOf(theme)+1)%4];store.set('theme',theme);applyTheme()}
  else if(a==='fs+'||a==='fs-'){fs=Math.max(14,Math.min(32,fs+(a==='fs+'?1:-1)));store.set('fs',fs);applyFs();if(ch.length)mark()}
  else if(b.dataset.h){hm=b.dataset.h;store.set('hm',hm);$('#pane').className='hm-'+hm;if(ch.length)mark()}
  renderMenu();
};
document.addEventListener('click',e=>{if(!e.composedPath().some(n=>n.id==='menu'||n.id==='gear'))$('#menu').hidden=true});
document.addEventListener('keydown',e=>{if(e.key==='Escape')sheet(false)});
$('#menuBtn').onclick=()=>chList($('#chlist').hidden);

/* floating button: tap = play/pause, badge or long-press = open player, drag = move */
(function(){
  const f=$('#fab');let sx=null,sy=0,ox=0,oy=0,drag=false,lp=null;
  const place=(x,y)=>{x=Math.max(8,Math.min(innerWidth-70,x));y=Math.max(64,Math.min(innerHeight-70,y));f.style.left=x+'px';f.style.top=y+'px';f.style.right=f.style.bottom='auto'};
  const sp=store.get('fab');if(sp)place(sp.x*innerWidth,sp.y*innerHeight);
  /* keep it on screen after rotation, keyboard or address-bar resize */
  const clamp=()=>{if(f.hidden||!f.style.left)return;const r=f.getBoundingClientRect();place(r.left,r.top)};
  window.fabClamp=clamp;addEventListener('resize',clamp);addEventListener('orientationchange',clamp);
  f.addEventListener('contextmenu',e=>e.preventDefault());
  f.addEventListener('pointerdown',e=>{
    skipClick=false;if(e.target.closest('#fabx'))return;
    sx=e.clientX;sy=e.clientY;const r=f.getBoundingClientRect();ox=r.left;oy=r.top;drag=false;
    try{f.setPointerCapture(e.pointerId)}catch(_){}
    clearTimeout(lp);lp=setTimeout(()=>{if(!drag){skipClick=true;buzz();sheet(true)}},520);
  });
  f.addEventListener('pointermove',e=>{
    if(sx===null)return;const dx=e.clientX-sx,dy=e.clientY-sy;
    if(!drag&&Math.hypot(dx,dy)>8){drag=true;clearTimeout(lp)}
    if(drag)place(ox+dx,oy+dy);
  });
  const end=()=>{clearTimeout(lp);if(sx===null)return;sx=null;if(drag){skipClick=true;const r=f.getBoundingClientRect();store.set('fab',{x:r.left/innerWidth,y:r.top/innerHeight})}};
  f.addEventListener('pointerup',end);f.addEventListener('pointercancel',end);
  /* the only place the floating play button toggles playback */
  f.addEventListener('click',e=>{
    if(e.target.closest('#fabx')){sheet(true);return}
    if(skipClick){skipClick=false;return}
    toggle();
  });
})();

/* swipe gestures */
function swipe(el,fn){
  let x0=null,y0=0,t0=0;
  el.addEventListener('touchstart',e=>{if(e.touches.length!==1||e.target.closest('input,select')){x0=null;return}x0=e.touches[0].clientX;y0=e.touches[0].clientY;t0=Date.now()},{passive:true});
  el.addEventListener('touchend',e=>{
    if(x0===null)return;const t=e.changedTouches[0],dx=t.clientX-x0,dy=t.clientY-y0;x0=null;
    if(Date.now()-t0>650)return;const ax=Math.abs(dx),ay=Math.abs(dy);
    if(ax>60&&ax>ay*1.6)fn(dx<0?'left':'right');else if(ay>70&&ay>ax*1.6)fn(dy<0?'up':'down');
  },{passive:true});
}
swipe($('#pane'),d=>{
  if(mode==='page'){if(d==='left'){pageNav(1);buzz()}else if(d==='right'){pageNav(-1);buzz()}}
  else if(d==='left'){nextS();toast('Next sentence');buzz()}else if(d==='right'){prevS();toast('Previous sentence');buzz()}
});
swipe($('#sheet'),d=>{if(d==='down')sheet(false);else if(d==='left'){nextC();buzz()}else if(d==='right'){prevC();buzz()}});
/* ---------- web pages, pasted text, read-from-selection ---------- */
const coarse=matchMedia('(pointer:coarse)').matches;
const PROXIES=[u=>u,u=>'https://corsproxy.io/?url='+encodeURIComponent(u),u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u),u=>'https://r.jina.ai/'+u];
async function fetchPage(url){
  for(let i=0;i<PROXIES.length;i++){
    const ac=new AbortController(),to=setTimeout(()=>ac.abort(),9000);
    try{const r=await fetch(PROXIES[i](url),{signal:ac.signal});if(!r.ok)throw 0;const t=await r.text();if(t.length<200)throw 0;return{text:t,md:i===3}}
    catch(e){if(i<PROXIES.length-1)setMsg('Trying another route… ('+(i+2)+'/'+PROXIES.length+')')}
    finally{clearTimeout(to)}
  }
  throw new Error('Couldn’t fetch that page. Some sites block outside readers. Open the page, copy its text and use “Paste text” (or “Read what I copied”).');
}
function extract(src,url){
  const d=parseHTML(src),meta=d.querySelector('meta[property="og:title"]');
  const title=((meta&&meta.content)||(d.querySelector('title')||{}).textContent||url).trim();
  d.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,iframe,svg,button,figure,[aria-hidden="true"],[role="navigation"],[role="banner"],[role="complementary"]').forEach(e=>e.remove());
  d.querySelectorAll('[class*="comment"],[class*="sidebar"],[class*="advert"],[class*="promo"],[class*="cookie"],[class*="newsletter"],[class*="social"],[class*="related"],[id*="comment"],[id*="sidebar"]').forEach(e=>{if(e!==d.body&&!e.querySelector('article,main,h1'))e.remove()});
  let root=[...d.querySelectorAll('article,[role="main"],main')].sort((a,b)=>b.textContent.length-a.textContent.length)[0];
  if(!root||root.textContent.length<600){let bs=0;root=d.body;d.querySelectorAll('div,section,td').forEach(e=>{const s=[...e.children].reduce((a,c)=>a+(c.tagName==='P'?c.textContent.length:0),0);if(s>bs){bs=s;root=e}})}
  let h='<h1>'+esc(title)+'</h1>';
  root.querySelectorAll('h1,h2,h3,p,li,blockquote').forEach(e=>{
    if(e.parentElement&&e.parentElement.closest('p,li,blockquote'))return;
    const t=e.textContent.replace(/\s+/g,' ').trim();if(t.length<2)return;
    h+=/^H/.test(e.tagName)?'<h2>'+esc(t)+'</h2>':'<p>'+esc(t)+'</p>';
  });
  return{title,html:h};
}
function mdToHtml(t){
  const m=t.match(/Title:\s*(.*)/),title=m?m[1].trim():'Web page',body=t.split(/Markdown Content:\s*/)[1]||t;
  const h=body.split(/\n+/).map(l=>{
    l=l.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[*_`>]+/g,'').trim();
    if(!l)return'';const x=/^#{1,3}\s+(.*)/.exec(l);return x?'<h2>'+esc(x[1])+'</h2>':'<p>'+esc(l)+'</p>';
  }).join('');
  return{title,html:'<h1>'+esc(title)+'</h1>'+h};
}
function htmlChapters(src,title){
  const d=parseHTML(src);d.querySelectorAll('script,style,nav').forEach(e=>e.remove());
  const out=[];let cur={title,text:''};
  d.body.querySelectorAll('h1,h2,h3,p,li,blockquote,pre').forEach(e=>{
    if(e.parentElement&&e.parentElement.closest('p,li,blockquote,pre'))return;
    const t=e.textContent.replace(/\s+/g,' ').trim();if(!t)return;
    if(/^H[12]$/.test(e.tagName)){if(cur.text.length>400){out.push(cur);cur={title:t,text:''}}else if(!cur.text)cur.title=t}
    cur.text+=t+'\n';
  });
  if(cur.text.trim())out.push(cur);
  return out.length?out:[{title,text:htmlText(d)}];
}
async function readUrl(u){
  u=(typeof u==='string'?u:$('#url').value).trim();if(!u)return false;if(!/^https?:\/\//i.test(u))u='https://'+u;
  try{
    setMsg('Fetching page…');
    const r=await fetchPage(u),p=r.md?mdToHtml(r.text):extract(r.text,u);
    if(p.html.length<300)throw new Error('Couldn’t find readable text on that page.');
    const ok=await load(new File([p.html],(p.title.replace(/[\\/:*?"<>|]+/g,' ').trim().slice(0,60)||'Web page')+'.html',{type:'text/html'}));
    if(ok)$('#url').value='';
    return ok;
  }catch(e){showTab('add');setMsg(e.message,true);return false}
}
$('#urlgo').onclick=()=>readUrl();$('#url').onkeydown=e=>{if(e.key==='Enter')readUrl()};
/* pasted text: a lone link is fetched as a page, anything else is read as text */
async function readText(t,title){
  t=(t||'').trim();if(!t)return false;
  if(/^https?:\/\/\S+$/i.test(t))return readUrl(t);
  return load(new File([t],((title||t.split('\n')[0]).slice(0,50).replace(/[\\/:*?"<>|]+/g,' ').trim()||'Pasted text')+' (pasted).txt',{type:'text/plain'}));
}
$('#ptgo').onclick=async()=>{
  const box=$('#ptxt');
  if(await readText(box.value))box.value='';   /* don't leave the pasted text sitting in the box */
};
const rfh=$('#rfh');let selT=null;
document.addEventListener('selectionchange',()=>{
  clearTimeout(selT);selT=setTimeout(()=>{
    const sel=getSelection();
    if(!sel||sel.isCollapsed||$('#pane').hidden||!sel.anchorNode){rfh.hidden=true;return}
    const rg=sel.getRangeAt(0),sc=rg.startContainer;   /* start of the range, so backwards selections work too */
    const n=sc.nodeType===1?sc:sc.parentElement,s=n&&n.closest&&n.closest('.s');
    if(!s){rfh.hidden=true;return}
    rfh.dataset.i=s.dataset.i;rfh.dataset.c=s.dataset.c;rfh.dataset.o=s.textContent.lastIndexOf(' ',sc.nodeType===3?rg.startOffset:0)+1;
    const r=rg.getBoundingClientRect();
    rfh.hidden=false;rfh.style.top=Math.max(70,Math.min(innerHeight-110,r.bottom+16))+'px';rfh.style.left=Math.max(8,Math.min(innerWidth-176,r.left+r.width/2-84))+'px';
  },200);
});
rfh.addEventListener('pointerdown',e=>e.preventDefault());
rfh.onclick=()=>{
  const i=+rfh.dataset.i,c=+rfh.dataset.c;part={c,s:i,o:+rfh.dataset.o};
  getSelection().removeAllRanges();rfh.hidden=true;
  if(!playing)setPlaying(true);
  ci=c;si=i;mark();speak();
};
$('#main').addEventListener('scroll',()=>{rfh.hidden=true;fill();clearTimeout(st);st=setTimeout(syncScroll,180)},{passive:true});
showTab(lib.length?'books':'add');

/* ---------- "listen to this page" (like Chrome for Android) ----------
   1. Install the app (⋮ → Install app) and use Share → Read Aloud on any page (manifest share_target)
   2. "Read what I copied" button   3. Bookmarklet that sends the page you are looking at   4. ?url= / ?text= links */
$('#clip').onclick=async()=>{
  try{
    const t=await navigator.clipboard.readText();
    if(!t||!t.trim()){setMsg('Your clipboard is empty. Copy a page link or some text first.',true);return}
    if(!(await readText(t)))return;
  }catch(e){setMsg('Couldn’t read the clipboard. Paste into the box above instead.',true)}
};
function bookmarklet(){
  const o=JSON.stringify(location.origin),a=JSON.stringify(location.origin+location.pathname);
  return 'javascript:(function(){var A='+a+',O='+o+',s=String(getSelection()).trim(),m=document.querySelector("article,main,[role=main]"),t=s||(m&&m.innerText.length>600?m.innerText:document.body.innerText),w=window.open(A),n=0,d={readaloud:1,title:document.title,url:location.href,text:t},i=setInterval(function(){if(++n>40)clearInterval(i);try{w.postMessage(d,O)}catch(e){}},400);window.addEventListener("message",function(e){if(e.data==="readaloud-ok")clearInterval(i)})})()';
}
const bm=$('#bm');if(bm)bm.href=bookmarklet();
$('#bmcopy').onclick=async()=>{try{await navigator.clipboard.writeText(bookmarklet());toast('Bookmarklet copied',2000)}catch(e){toast('Couldn’t copy. Long-press the link instead.',2500)}};
let lastMsg='';
addEventListener('message',e=>{
  const d=e.data;if(!d||d.readaloud!==1||typeof d.text!=='string')return;
  try{e.source.postMessage('readaloud-ok',e.origin)}catch(_){}
  const text=d.text.trim(),key=(d.title||'')+'|'+text.length;
  if(key===lastMsg)return;lastMsg=key;
  if(text.length<20){showTab('add');setMsg('That page had no readable text.',true);return}
  readText(text,d.title||'Web page');
});
function handleLaunch(){
  const q=new URLSearchParams(location.search),title=q.get('title')||'',text=q.get('text')||'',url=q.get('url')||'';
  if(!title&&!text&&!url)return;
  try{history.replaceState(null,'',location.pathname)}catch(e){}
  const link=((url.match(/https?:\/\/\S+/i)||text.match(/https?:\/\/\S+/i)||[])[0])||'';
  const rest=text.replace(link,'').trim();
  if(link&&rest.length<400){$('#url').value=link;readUrl(link)}
  else if(text.trim().length>=20)readText(text,title);
}
handleLaunch();
let dip=null;
addEventListener('beforeinstallprompt',e=>{e.preventDefault();dip=e;$('#inst').hidden=false});
addEventListener('appinstalled',()=>{$('#inst').hidden=true;dip=null});
$('#inst').onclick=async()=>{if(!dip)return;dip.prompt();try{await dip.userChoice}catch(_){}dip=null;$('#inst').hidden=true};
if('serviceWorker'in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){navigator.serviceWorker.register('sw.js').catch(()=>{})}


/* creator credit */
{const m=document.createElement('meta');m.name='author';m.content=CREATOR;document.head.appendChild(m);
$('#credit').innerHTML='Idea &amp; creation by <b>'+esc(CREATOR)+'</b>'}
