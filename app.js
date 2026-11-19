
const $=s=>document.querySelector(s);
const esc=t=>t.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const synth=window.speechSynthesis;
let ch=[],ci=0,si=0,playing=false,token=0,rate=1,voice=null,total=0,bookId='',docTitle='',pdfN=0,docPages=1;
const store={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
if(pdfjsLib){try{pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js'}catch(e){}}

let lib=store.get('books')||[],wish=store.get('wish')||[];
/* ---------- text -> chapters ---------- */
const seg=window.Intl&&Intl.Segmenter?new Intl.Segmenter(undefined,{granularity:'sentence'}):null;
function split(t){
  if(t.length<=260)return[t];
  const o=[];let c='';
  for(const p of t.split(/(?<=[,;:—])\s+/)){if(c&&(c+' '+p).length>240){o.push(c);c=p}else c=c?c+' '+p:p}
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
    const f=z.file(base+decodeURI(href))||z.file(decodeURI(href));if(!f)continue;
    const d=parseHTML(await f.async('string'));
    const h=d.querySelector('h1,h2,h3');const title=h&&h.textContent.trim();
    const text=htmlText(d);
    if(text.replace(/\s/g,'').length<80)continue;
    out.push({title:title||('Section '+(++n)),text});
  }
  return out;
}
async function readDocx(buf){
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
    $('#home').hidden=true;$('#homeBtn').hidden=false;$('#chbar').hidden=false;$('#menuBtn').hidden=false;$('#title').hidden=true;$('#pane').hidden=false;$('#fab').hidden=false;setMsg('');hintOnce();
    renderChapter();mark();
  }catch(e){console.error(e);showTab('add');setMsg(e.message||'Couldn’t open that file.',true)}
}

/* ---------- reading pane ---------- */
function renderChapter(){
  const c=ch[ci];let h='<h2>'+esc(c.title)+'</h2><p>';
  c.S.forEach((s,i)=>{if(s.p&&i)h+='</p><p>';h+='<span class="s" data-i="'+i+'">'+esc(s.t)+' </span>'});
  $('#pane').innerHTML=h+'</p>';$('#main').scrollTop=0;
}
function mark(){
  const c=ch[ci],s=c.S[si];
  const prev=$('.s.on');if(prev)prev.classList.remove('on');
  const pp=$('#pane p.on');if(pp)pp.classList.remove('on');
  const el=$('.s[data-i="'+si+'"]');
  if(el){el.classList.add('on');el.parentNode.classList.add('on');if(follow)el.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'})}
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
  if(changed){renderChapter();toast('Chapter '+(ci+1)+' · '+ch[ci].title)}
  mark();if(playing)speak();
}
const nextS=()=>si+1<ch[ci].S.length?go(ci,si+1):ci+1<ch.length?go(ci+1,0):finish();
const prevS=()=>si>0?go(ci,si-1):ci>0?go(ci-1,ch[ci-1].S.length-1):0;
const nextC=()=>ci+1<ch.length&&go(ci+1,0);
const prevC=()=>si>2||ci===0?go(ci,0):go(ci-1,0);

/* ---------- speech ---------- */
function speak(){
  const t=++token;synth.cancel();pauseAU();
  if(!playing)return;
  const wasNat=natural;natural=false;
  if(!wasNat&&selK()&&kReady)kdrop();
  let txt=ch[ci].S[si].t;
  if(part&&part.c===ci&&part.s===si)txt=txt.slice(part.o)||txt;
  part=null;
  if(selK()&&kReady)speakK(t,txt);else speakDev(t,txt);
}
function speakDev(t,txt){
  const u=new SpeechSynthesisUtterance(txt),dv=selK()?(dev.find(x=>x.default)||dev[0]):voice;
  if(dv){u.voice=dv;u.lang=dv.lang}
  u.rate=rate;u.volume=muted?0:1;
  u.onend=()=>{if(t===token&&playing)nextS()};
  u.onerror=e=>{if(t===token&&playing&&e.error!=='canceled'&&e.error!=='interrupted')setTimeout(()=>{if(t===token&&playing)nextS()},200)};
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
  if('mediaSession'in navigator)navigator.mediaSession.playbackState=p?'playing':'paused';
}
function toggle(){if(!ch.length)return;setPlaying(!playing);speak()}
function stop(){setPlaying(false);token++;synth.cancel();pauseAU();hideWait()}
function finish(){stop();setMsg('')}

/* ---------- controls ---------- */
document.querySelectorAll('.pp').forEach(b=>b.onclick=toggle);
document.querySelectorAll('.prc').forEach(b=>b.onclick=prevC);
document.querySelectorAll('.nxc').forEach(b=>b.onclick=nextC);
$('#ns').onclick=nextS;$('#ps').onclick=prevS;
$('#rate').oninput=e=>{rate=+e.target.value;store.set('rate',rate);AU.forEach(a=>a.playbackRate=rate);if(ch.length)mark()};
$('#rate').onchange=()=>{if(playing&&!(selK()&&kReady))speak()};
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
  const s=e.target.closest('.s'),n=Date.now();
  if(coarse&&n-lastTap<320){lastTap=0;toggle();toast(playing?'Playing':'Paused');buzz();return}
  lastTap=n;if(s)go(ci,+s.dataset.i);
};
document.addEventListener('keydown',e=>{
  if(!ch.length||!$('#home').hidden||/INPUT|SELECT|BUTTON/.test(e.target.tagName))return;
  if(e.code==='Space'){e.preventDefault();toggle()}
  else if(e.key==='ArrowRight'){e.preventDefault();e.shiftKey?nextC():nextS()}
  else if(e.key==='ArrowLeft'){e.preventDefault();e.shiftKey?prevC():prevS()}
});
document.addEventListener('visibilitychange',()=>{if(playing&&!synth.speaking&&AU.every(a=>a.paused)&&!$('#fab').classList.contains('busy')&&$('#wait').hidden)speak()});
if('mediaSession'in navigator){
  const h=(a,f)=>{try{navigator.mediaSession.setActionHandler(a,f)}catch(e){}};
  h('play',()=>{if(!playing)toggle()});h('pause',()=>{if(playing)toggle()});
  h('nexttrack',nextC);h('previoustrack',prevC);h('seekforward',nextS);h('seekbackward',prevS);
}

/* ---------- voices ---------- */
/* ---------- voices: Kokoro AI (Heart) + this device ---------- */
const KV=[['af_heart','Heart ❤ — Kokoro AI'],['af_bella','Bella — Kokoro AI'],['af_nicole','Nicole — Kokoro AI'],['af_sarah','Sarah — Kokoro AI'],['af_nova','Nova — Kokoro AI'],['af_sky','Sky — Kokoro AI'],['am_adam','Adam — Kokoro AI'],['am_michael','Michael — Kokoro AI'],['am_fenrir','Fenrir — Kokoro AI'],['bf_emma','Emma (UK) — Kokoro AI'],['bf_isabella','Isabella (UK) — Kokoro AI'],['bm_george','George (UK) — Kokoro AI'],['bm_lewis','Lewis (UK) — Kokoro AI']];
let kMode='',dev=[],kv='af_heart',kw=null,kReady=false,kBusy=false,kPct=0,kErr='',kid=0,part=null;
/* Smooth-playback buffer. A "page" is ~1800 characters of text. kspd = measured generation speed (x realtime). */
const PAGE_CH=1800, AHEAD_PAGES=3, KMAX=600, MARGIN=1.2;
const BUF_AHEAD=PAGE_CH*AHEAD_PAGES;
let kspd=0;const kfail=new Map();
const kpend=new Map(),kcache=new Map(),kdone=new Set(),kst=new Set(),au=new Audio();au.preservesPitch=true;
const AU=[au,new Audio()];AU[1].preservesPitch=true;let ai=0,natural=false,waitSkip=false;
const pauseAU=()=>AU.forEach(a=>a.pause());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const selK=()=>$('#voice').value.startsWith('k:');
function kStatus(){
  let h;
  if(kReady)h='<b>Heart is ready</b> · runs on your device and works offline'+(kMode==='main'?'<br><span class="bad">Compatibility mode: the screen can freeze while it speaks. Pick a device voice if it’s too slow.</span>':'');
  else if(kBusy){const p=Math.round(kPct*100);h='Downloading voice… '+p+'%<div class="meter"><i style="width:'+p+'%"></i></div>'}
  else if(kErr)h='<span class="bad">'+esc(kErr)+'</span> <button data-k class="btn">Retry</button><button data-km class="btn">Compatibility mode (may freeze)</button>';
  else h='Kokoro AI voices sound far more natural. One-time download of about 90 MB, then it works offline. <button data-k class="btn">Download Heart</button>';
  document.querySelectorAll('.kst').forEach(e=>e.innerHTML=h);
  $('#ksheet').hidden=!selK()||kReady;
}
const KCDN='https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
/* Engine core: runs inside a Blob web worker, or on the main thread as a fallback. Must stay self-contained. */
function kokoroCore(KokoroTTS,post){
  let tts=null,q=[],busy=false;const files={};
  const wav=(f,sr)=>{
    const n=f.length,b=new DataView(new ArrayBuffer(44+n*2));
    const s=(o,t)=>[...t].forEach((c,i)=>b.setUint8(o+i,c.charCodeAt(0)));
    s(0,'RIFF');b.setUint32(4,36+n*2,true);s(8,'WAVEfmt ');b.setUint32(16,16,true);b.setUint16(20,1,true);b.setUint16(22,1,true);
    b.setUint32(24,sr,true);b.setUint32(28,sr*2,true);b.setUint16(32,2,true);b.setUint16(34,16,true);s(36,'data');b.setUint32(40,n*2,true);
    for(let i=0;i<n;i++)b.setInt16(44+i*2,Math.max(-1,Math.min(1,f[i]))*32767,true);
    return new Blob([b],{type:'audio/wav'});
  };
  async function load(){
    try{
      tts=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q8',device:'wasm',progress_callback:p=>{
        if(p.status==='progress'&&p.total){files[p.file]=[p.loaded,p.total];let l=0,t=0;for(const k in files){l+=files[k][0];t+=files[k][1]}post({type:'progress',pct:l/t})}
      }});
      post({type:'ready'});run();
    }catch(e){post({type:'error',msg:String((e&&e.message)||e)})}
  }
  async function run(){
    if(busy||!tts)return;busy=true;
    while(q.length){
      const m=q.shift();post({type:'start',id:m.id});
      try{const t0=performance.now();const a=await tts.generate(m.text,{voice:m.voice});post({type:'audio',id:m.id,blob:wav(a.audio,a.sampling_rate),dur:a.audio.length/a.sampling_rate,ms:performance.now()-t0})}
      catch(e){post({type:'fail',id:m.id,msg:String(e)})}
      await new Promise(r=>setTimeout(r,40));
    }
    busy=false;
  }
  return m=>{if(m.type==='load')load();else if(m.type==='gen'){m.pri?q.unshift(m):q.push(m);run()}else if(m.type==='bump'){const i=q.findIndex(x=>x.id===m.id);if(i>0)q.unshift(q.splice(i,1)[0])}else if(m.type==='drop'){const d=new Set(m.ids);q=q.filter(x=>!d.has(x.id))}};
}
function kFail(m){
  kBusy=false;kErr=m+(/claude/.test(location.hostname)?' (Claude’s preview blocks the network. Use your hosted copy.)':'');
  if(kw&&kw.terminate)kw.terminate();kw=null;kStatus();
}
function kMsg(e){
  const m=e.data,r=kpend.get(m.id);
  if(m.type==='progress'){kPct=m.pct;kStatus()}
  else if(m.type==='ready'){kReady=true;kBusy=false;store.set('kdl',1);kStatus();toast('Heart voice ready ❤');if(playing&&selK())speak()}
  else if(m.type==='error')kFail(m.msg)
  else if(m.type==='start')kst.add(m.id);
  else if(m.type==='audio'){kst.delete(m.id);if(m.dur&&m.ms){const x=m.dur/(m.ms/1000);kspd=kspd?kspd*.7+x*.3:x}if(r){kpend.delete(m.id);r(URL.createObjectURL(m.blob))}}
  else if(m.type==='fail'){kst.delete(m.id);if(r){kpend.delete(m.id);r(null)}}
}
async function kMain(why){
  if(kw||kReady)return;kErr='';kBusy=true;kMode='main';kStatus();
  try{
    const {KokoroTTS}=await import(KCDN);
    const on=kokoroCore(KokoroTTS,m=>kMsg({data:m}));
    kw={postMessage:on,terminate(){}};kw.postMessage({type:'load'});
  }catch(e){kFail('Couldn’t start the voice engine: '+String((e&&e.message)||e)+' ['+why+']')}
}
function kLoad(){
  if(kw||kReady||kBusy)return;
  if(!/^https?:$/.test(location.protocol)){kFail('This page was opened as a file ('+location.protocol+'//). Browsers block the voice engine there. Open it from GitHub Pages or http://localhost instead.');return}kErr='';kBusy=true;kPct=0;kStatus();
  try{
    const src='import {KokoroTTS} from "'+KCDN+'";const on=('+kokoroCore+')(KokoroTTS,m=>postMessage(m));onmessage=e=>on(e.data);';
    const w=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})),{type:'module'});
    w.onmessage=kMsg;
    w.onerror=ev=>{if(kReady)return;kFail('The background engine failed to start'+(ev&&ev.message?': '+ev.message:'')+'.')};
    kw=w;kMode='worker';w.postMessage({type:'load'});
  }catch(e){kFail('Couldn’t start a background worker: '+String((e&&e.message)||e))}
}
function kgen(text,pri){
  const k=kv+'|'+text;let e=kcache.get(k);
  if(!e){
    const id=++kid;
    e={id,p:new Promise(res=>{kpend.set(id,res);kw.postMessage({type:'gen',id,text,voice:kv,pri})})};
    kcache.set(k,e);
    e.p.then(u=>{if(u){kdone.add(k);kfail.delete(k)}else{if(!e.dropped)kfail.set(k,(kfail.get(k)||0)+1);if(kcache.get(k)===e)kcache.delete(k)}});
    while(kcache.size>KMAX){const f=kcache.keys().next().value,o=kcache.get(f);kcache.delete(f);kdone.delete(f);o.p.then(u=>u&&URL.revokeObjectURL(u))}
  }else if(pri&&!kdone.has(k))kw.postMessage({type:'bump',id:e.id});
  return e.p;
}
/* forget queued-but-not-started sentences (after a jump / voice change) so the engine works on what matters now */
function kdrop(){
  const ids=[];
  for(const [k,e] of kcache){
    if(kpend.has(e.id)&&!kst.has(e.id)){ids.push(e.id);const r=kpend.get(e.id);e.dropped=true;kpend.delete(e.id);kcache.delete(k);r(null)}
  }
  if(ids.length&&kw)kw.postMessage({type:'drop',ids});
}
/* sentences after the current one, up to ~maxCh characters, crossing chapters */
function lookahead(maxCh){
  const o=[];let c=ci,s=si+1,n=0;
  while(n<maxCh){
    if(s>=ch[c].S.length){c++;s=0}
    if(c>=ch.length)break;
    const t=ch[c].S[s].t;o.push(t);n+=t.length;s++;
  }
  return o;
}
const prefetch=()=>lookahead(BUF_AHEAD).forEach(x=>kgen(x));
function showWait(){$('#wait').hidden=false;$('#wdev').hidden=!dev.length}
function setWait(f,eta){
  const p=Math.round(Math.min(1,f)*100);$('#wait i').style.width=p+'%';
  $('#waitt').textContent=p+'% ready'+(eta>1?' · about '+Math.ceil(eta)+'s left':'');
}
function hideWait(){$('#wait').hidden=true}
/* How much must be ready before playing so the buffer can never run dry?
   Audio is consumed at `rate`x and produced at kspd x. If production is faster, only 1-2 sentences are needed;
   if slower, we need the shortfall (1 - kspd/rate) of the lookahead window ready up front. */
function extraNeeded(){
  const g=kspd||.7;
  return Math.round(BUF_AHEAD*Math.max(0,1-g/(rate*MARGIN)));
}
const okK=x=>kdone.has(kv+'|'+x)||(kfail.get(kv+'|'+x)||0)>=2;
async function kWait(t,txt){
  const mk=()=>{const L=[txt,...lookahead(extraNeeded())];return{L,need:L.reduce((a,x)=>a+x.length,0)}};
  const have=L=>{let n=0;for(const x of L){if(!okK(x))break;n+=x.length}return n};
  let {L,need}=mk();
  if(have(L)>=need)return true;
  waitSkip=false;showWait();let shown=0;
  while(t===token&&playing&&!waitSkip){
    ({L,need}=mk());const h=have(L);
    if(h>=need)break;
    shown=Math.max(shown,h/need);
    setWait(shown,(need-h)/15/(kspd||.7));
    L.forEach(x=>{if((kfail.get(kv+'|'+x)||0)<2)kgen(x)});
    await sleep(120);
  }
  setWait(1);hideWait();return t===token&&playing;
}
async function speakK(t,txt){
  const fab=$('#fab');fab.classList.add('busy');
  const p=kgen(txt,true);
  if(kMode!=='main'){prefetch();if(!(await kWait(t,txt))){fab.classList.remove('busy');return}}
  const url=await p;fab.classList.remove('busy');
  if(t!==token||!playing)return;
  if(!url){speakDev(t,txt);return}
  /* gapless: the next sentence is already loaded in the other audio element */
  let a=AU[1-ai];
  if(a.dataset.u===url)ai=1-ai;else{a=AU[ai];a.src=url;a.dataset.u=url}
  AU[1-ai].pause();
  const nx=()=>{if(t===token&&playing){natural=true;nextS()}};
  AU.forEach(x=>{x.onended=null;x.onerror=null});
  a.onended=nx;a.onerror=nx;a.playbackRate=rate;a.volume=muted?0:1;
  try{await a.play()}catch(e){}
  const n=lookahead(1)[0];
  if(n)kgen(n).then(u=>{if(u&&t===token){const o=AU[1-ai];if(o.dataset.u!==u){o.dataset.u=u;o.src=u;o.preload='auto';o.load()}}});
}
function pickVoice(v,save){
  if(![...$('#voice').options].some(x=>x.value===v))v='k:af_heart';
  $('#voice').value=v;if(save)store.set('voice2',v);
  if(v.startsWith('k:'))kv=v.slice(2);else voice=dev.find(x=>x.voiceURI===v)||null;
  kStatus();
}
function loadVoices(){
  dev=synth?synth.getVoices():[];
  const lang=(navigator.language||'en').slice(0,2);
  dev.sort((a,b)=>(b.lang.startsWith(lang)-a.lang.startsWith(lang))||a.name.localeCompare(b.name));
  $('#voice').innerHTML='<optgroup label="Kokoro AI · on-device">'+KV.map(k=>'<option value="k:'+k[0]+'">'+k[1]+'</option>').join('')+'</optgroup>'+(dev.length?'<optgroup label="This device">'+dev.map(x=>'<option value="'+esc(x.voiceURI)+'">'+esc(x.name)+' ('+x.lang+')</option>').join('')+'</optgroup>':'');
  pickVoice(store.get('voice2')||'k:af_heart',false);
}
$('#voice').onchange=e=>{pickVoice(e.target.value,true);if(selK())kLoad();if(playing)speak()};
document.addEventListener('click',e=>{if(e.target.closest('[data-k]'))kLoad();else if(e.target.closest('[data-km]'))kMain('manual')});
loadVoices();if(synth)synth.onvoiceschanged=loadVoices;
if(store.get('kdl'))kLoad();
$('#rate').innerHTML=[0.6,0.8,1,1.2,1.4,1.6,1.8,2,2.5,3].map(v=>'<option value="'+v+'">'+v.toFixed(1)+'×</option>').join('');$('#rate').value='1';
const sr=store.get('rate');if(sr&&[...$('#rate').options].some(o=>+o.value===sr)){rate=sr;$('#rate').value=String(sr)}

/* ---------- file input ---------- */
const fi=$('#file');
$('#drop').onclick=()=>fi.click();
$('#drop').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fi.click()}};
fi.onchange=()=>{if(fi.files[0])load(fi.files[0]);fi.value=''};
['dragover','dragenter'].forEach(t=>document.addEventListener(t,e=>{e.preventDefault();$('#drop').classList.add('over')}));
['dragleave','drop'].forEach(t=>document.addEventListener(t,e=>{e.preventDefault();$('#drop').classList.remove('over')}));
document.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)load(f)});

/* ---------- home: books + wishlist ---------- */
function pageNow(){const s=ch[ci].S[si];return s.pg||Math.floor((ch[ci].off+s.o)/1800)+1}
const idb=()=>new Promise((res,rej)=>{const r=indexedDB.open('readaloud',1);r.onupgradeneeded=()=>r.result.createObjectStore('files');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
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
  stop();chList(false);$('#menu').hidden=true;$('#menuBtn').hidden=true;$('#title').hidden=false;$('#chbar').hidden=true;$('#pane').hidden=true;$('#fab').hidden=true;$('#sheet').hidden=true;$('#homeBtn').hidden=true;
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

function renderMenu(){
  const on=v=>v?'On':'Off';
  $('#menu').innerHTML='<button data-a="sleep">Sleep timer<span>'+(sleepMin?sleepMin+' min':'Off')+'</span></button>'
   +'<button data-a="mute">Mute<span>'+on(muted)+'</span></button>'
   +'<button data-a="follow">Follow text<span>'+on(follow)+'</span></button>'
   +'<button data-a="theme">Theme<span>'+theme+'</span></button>'
   +'<div class="row">Text size<span><button data-a="fs-" aria-label="Smaller text">A−</button><button data-a="fs+" aria-label="Larger text">A+</button></span></div>'
   +'<h4>Highlight</h4>'+[['s','Sentence'],['p','Paragraph'],['o','Off']].map(h=>'<button data-h="'+h[0]+'">'+h[1]+'<span>'+(hm===h[0]?'✓':'')+'</span></button>').join('');
}
$('#gear').onclick=()=>{const m=$('#menu');m.hidden=!m.hidden;if(!m.hidden)renderMenu()};
$('#xp').onclick=()=>sheet(false);
$('#menu').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;const a=b.dataset.a,L=[0,15,30,60],T=['auto','light','dark','sepia'];
  if(a==='sleep'){sleepMin=L[(L.indexOf(sleepMin)+1)%4];clearTimeout(sleepT);if(sleepMin)sleepT=setTimeout(()=>{stop();sleepMin=0},sleepMin*60000)}
  else if(a==='mute'){muted=!muted;if(playing)speak()}
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
  const place=(x,y)=>{x=Math.max(8,Math.min(innerWidth-68,x));y=Math.max(64,Math.min(innerHeight-68,y));f.style.left=x+'px';f.style.top=y+'px';f.style.right=f.style.bottom='auto'};
  const sp=store.get('fab');if(sp)place(sp.x*innerWidth,sp.y*innerHeight);
  f.addEventListener('pointerdown',e=>{
    skipClick=false;if(e.target.closest('#fabx'))return;
    sx=e.clientX;sy=e.clientY;const r=f.getBoundingClientRect();ox=r.left;oy=r.top;drag=false;
    try{f.setPointerCapture(e.pointerId)}catch(_){}
    lp=setTimeout(()=>{if(!drag){skipClick=true;buzz();sheet(true)}},520);
  });
  f.addEventListener('pointermove',e=>{
    if(sx===null)return;const dx=e.clientX-sx,dy=e.clientY-sy;
    if(!drag&&Math.hypot(dx,dy)>8){drag=true;clearTimeout(lp)}
    if(drag)place(ox+dx,oy+dy);
  });
  const end=()=>{clearTimeout(lp);if(sx===null)return;sx=null;if(drag){skipClick=true;const r=f.getBoundingClientRect();store.set('fab',{x:r.left/innerWidth,y:r.top/innerHeight})}};
  f.addEventListener('pointerup',end);f.addEventListener('pointercancel',end);
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
swipe($('#pane'),d=>{if(d==='left'){nextS();toast('Next sentence');buzz()}else if(d==='right'){prevS();toast('Previous sentence');buzz()}});
swipe($('#sheet'),d=>{if(d==='down')sheet(false);else if(d==='left'){nextC();buzz()}else if(d==='right'){prevC();buzz()}});
/* ---------- web pages, pasted text, read-from-selection ---------- */
const coarse=matchMedia('(pointer:coarse)').matches;
const PROXIES=[u=>u,u=>'https://corsproxy.io/?url='+encodeURIComponent(u),u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u),u=>'https://r.jina.ai/'+u];
async function fetchPage(url){
  for(let i=0;i<PROXIES.length;i++){
    try{const r=await fetch(PROXIES[i](url));if(!r.ok)throw 0;const t=await r.text();if(t.length<200)throw 0;return{text:t,md:i===3}}
    catch(e){if(i<PROXIES.length-1)setMsg('Trying another route… ('+(i+2)+'/'+PROXIES.length+')')}
  }
  throw new Error('Couldn’t fetch that page. Some sites block outside readers, and this preview blocks network access. Open the page, copy its text and use “Paste text”.');
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
async function readUrl(){
  let u=$('#url').value.trim();if(!u)return;if(!/^https?:\/\//i.test(u))u='https://'+u;
  try{
    setMsg('Fetching page…');
    const r=await fetchPage(u),p=r.md?mdToHtml(r.text):extract(r.text,u);
    if(p.html.length<300)throw new Error('Couldn’t find readable text on that page.');
    await load(new File([p.html],(p.title.replace(/[\\/:*?"<>|]+/g,' ').trim().slice(0,60)||'Web page')+'.html',{type:'text/html'}));
  }catch(e){showTab('add');setMsg(e.message,true)}
}
$('#urlgo').onclick=readUrl;$('#url').onkeydown=e=>{if(e.key==='Enter')readUrl()};
$('#ptgo').onclick=()=>{
  const t=$('#ptxt').value.trim();if(!t)return;
  load(new File([t],(t.split('\n')[0].slice(0,50).trim()||'Pasted text')+' (pasted).txt',{type:'text/plain'}));
};
const rfh=$('#rfh');let selT=null;
document.addEventListener('selectionchange',()=>{
  clearTimeout(selT);selT=setTimeout(()=>{
    const sel=getSelection();
    if(!sel||sel.isCollapsed||$('#pane').hidden||!sel.anchorNode){rfh.hidden=true;return}
    const n=sel.anchorNode.nodeType===1?sel.anchorNode:sel.anchorNode.parentElement,s=n&&n.closest('.s');
    if(!s){rfh.hidden=true;return}
    rfh.dataset.i=s.dataset.i;rfh.dataset.o=s.textContent.lastIndexOf(' ',sel.anchorNode.nodeType===3?sel.anchorOffset:0)+1;
    const r=sel.getRangeAt(0).getBoundingClientRect();
    rfh.hidden=false;rfh.style.top=Math.max(70,Math.min(innerHeight-110,r.bottom+16))+'px';rfh.style.left=Math.max(8,Math.min(innerWidth-176,r.left+r.width/2-84))+'px';
  },200);
});
rfh.addEventListener('pointerdown',e=>e.preventDefault());
rfh.onclick=()=>{
  const i=+rfh.dataset.i;part={c:ci,s:i,o:+rfh.dataset.o};
  getSelection().removeAllRanges();rfh.hidden=true;
  if(!playing)setPlaying(true);
  si=i;mark();speak();
};
$('#main').addEventListener('scroll',()=>{rfh.hidden=true},{passive:true});
showTab(lib.length?'books':'add');

/* buffering screen buttons */
$('#wgo').onclick=()=>{waitSkip=true};
$('#wdev').onclick=()=>{const d=dev.find(x=>x.default)||dev[0];if(d){waitSkip=true;pickVoice(d.voiceURI,true);hideWait();speak()}};
$('#wcancel').onclick=()=>{stop()};
