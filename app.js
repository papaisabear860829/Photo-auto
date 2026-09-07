const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("start");
const captureButton = document.getElementById("capture");
const switchButton = document.getElementById("switchCamera");
const statusText = document.getElementById("statusText");
const dot = document.querySelector(".dot");
const guide = document.getElementById("guide");
const guideText = document.getElementById("guideText");
const arrow = document.getElementById("arrow");
const ready = document.getElementById("ready");

let stream = null;
let detector = null;
let facingMode = "user";
let running = false;
let aiLoading = false;
let lastVideoTime = -1;
let lastDetect = 0;

const TFJS = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
const COCO = "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js";

function setStatus(text, active=false) {
  statusText.textContent = text;
  dot.style.background = active ? "#45d483" : "#999";
}
function resizeCanvas(){ canvas.width=video.videoWidth||720; canvas.height=video.videoHeight||1280; }
function clearOverlay(){ ctx.clearRect(0,0,canvas.width,canvas.height); }
function loadScript(src){ return new Promise((resolve,reject)=>{ const s=document.createElement("script"); s.src=src; s.onload=resolve; s.onerror=()=>reject(new Error("SCRIPT_LOAD_FAILED: "+src)); document.head.appendChild(s); }); }

async function loadAI(){
  if(detector||aiLoading) return;
  aiLoading=true;
  setStatus("AI 載入中…", true);
  guide.classList.remove("hidden"); ready.classList.add("hidden"); arrow.textContent="•"; guideText.textContent="AI 正在準備場景理解…";
  try{
    if(!window.tf) await loadScript(TFJS);
    await tf.ready();
    guideText.textContent="AI 正在載入場景模型…";
    if(!window.cocoSsd) await loadScript(COCO);
    detector=await cocoSsd.load({base:"lite_mobilenet_v2"});
    setStatus("AI 已載入",true);
    guideText.textContent="AI 已就緒：正在找主體與背景";
  }catch(e){
    console.error(e);
    detector=null;
    setStatus("AI 載入失敗",false);
    guideText.textContent=`AI錯誤：${e?.message||e}`;
  }finally{ aiLoading=false; }
}

async function startCamera(){
  if(!window.isSecureContext) throw new Error("SECURE_CONTEXT");
  if(!navigator.mediaDevices?.getUserMedia) throw new Error("GET_USER_MEDIA_UNAVAILABLE");
  if(stream) stream.getTracks().forEach(t=>t.stop());
  stream=null; running=false;
  setStatus("正在開啟相機…");
  let s;
  try{s=await navigator.mediaDevices.getUserMedia({video:{facingMode:{exact:facingMode}},audio:false});}
  catch(e){s=await navigator.mediaDevices.getUserMedia({video:{facingMode},audio:false});}
  stream=s; video.srcObject=s; video.muted=true; video.setAttribute("playsinline",""); video.setAttribute("autoplay","");
  await video.play(); resizeCanvas(); running=true; captureButton.disabled=false; startButton.textContent="重新啟動"; setStatus("相機已開啟",true);
  requestAnimationFrame(loop);
  loadAI();
}

function boxToPx(b){return {x:b[0],y:b[1],w:b[2],h:b[3]};}
function drawBox(b,label){
  const x=b.x,y=b.y,w=b.w,h=b.h;
  ctx.save(); ctx.strokeStyle="rgba(255,255,255,.9)"; ctx.lineWidth=Math.max(2,canvas.width/280); ctx.setLineDash([12,8]); ctx.strokeRect(x,y,w,h);
  ctx.setLineDash([]); ctx.fillStyle="rgba(0,0,0,.6)"; ctx.font=`${Math.max(13,canvas.width/42)}px -apple-system`; ctx.fillText(label,x+8,Math.max(20,y+20)); ctx.restore();
}
function guideFor(preds){
  const people=preds.filter(p=>p.class==="person").sort((a,b)=>b.score-a.score);
  const others=preds.filter(p=>p.class!=="person" && p.score>.45).sort((a,b)=>(b.bbox[2]*b.bbox[3])-(a.bbox[2]*a.bbox[3]));
  clearOverlay();
  if(people.length){
    const p=boxToPx(people[0].bbox); drawBox(p,"人物");
    const cx=(p.x+p.w/2)/canvas.width; const top=p.y/canvas.height; const bottom=(p.y+p.h)/canvas.height;
    if(others.length){
      const o=boxToPx(others[0].bbox); drawBox(o,"背景主體");
      const ocx=(o.x+o.w/2)/canvas.width;
      if(p.w/canvas.width>.72){ arrow.textContent="↓"; guideText.textContent="往後一點，讓人物和背景都進來"; guide.classList.remove("hidden"); ready.classList.add("hidden"); return; }
      if(cx<.34){arrow.textContent="←";guideText.textContent="人物往右一點，留空間給背景";guide.classList.remove("hidden");ready.classList.add("hidden");return;}
      if(cx>.66){arrow.textContent="→";guideText.textContent="人物往左一點，留空間給背景";guide.classList.remove("hidden");ready.classList.add("hidden");return;}
      if(Math.abs(ocx-cx)<.16 && p.w/canvas.width>.48){arrow.textContent="↓";guideText.textContent="手機往後一點，避免人物擋住背景";guide.classList.remove("hidden");ready.classList.add("hidden");return;}
      guide.classList.add("hidden");ready.classList.remove("hidden"); return;
    }
    if(cx<.40){arrow.textContent="←";guideText.textContent="人物往右一點";guide.classList.remove("hidden");ready.classList.add("hidden");return;}
    if(cx>.60){arrow.textContent="→";guideText.textContent="人物往左一點";guide.classList.remove("hidden");ready.classList.add("hidden");return;}
    if(top<.04 || bottom>.96){arrow.textContent="↓";guideText.textContent="往後一點，留完整背景";guide.classList.remove("hidden");ready.classList.add("hidden");return;}
    guide.classList.add("hidden"); ready.classList.remove("hidden"); return;
  }
  if(others.length){
    const o=boxToPx(others[0].bbox); drawBox(o,"主要物件");
    const cx=(o.x+o.w/2)/canvas.width;
    if(cx<.34){arrow.textContent="←";guideText.textContent="手機往右一點，把主體放進畫面";guide.classList.remove("hidden");ready.classList.add("hidden");return;}
    if(cx>.66){arrow.textContent="→";guideText.textContent="手機往左一點，把主體放進畫面";guide.classList.remove("hidden");ready.classList.add("hidden");return;}
    guide.classList.add("hidden");ready.classList.remove("hidden"); return;
  }
  guide.classList.remove("hidden");ready.classList.add("hidden");arrow.textContent="•";guideText.textContent="先看看這個場景…";
}

async function loop(){
  if(!running) return;
  if(video.readyState>=2 && video.currentTime!==lastVideoTime){
    lastVideoTime=video.currentTime; resizeCanvas();
    if(detector && performance.now()-lastDetect>500){
      lastDetect=performance.now();
      try{const preds=await detector.detect(video); guideFor(preds);}catch(e){console.error(e); detector=null; setStatus("相機已開啟（AI 暫停）",true);}
    }
  }
  requestAnimationFrame(loop);
}

captureButton.addEventListener("click",()=>{
  if(!stream)return;
  const photo=document.createElement("canvas"); photo.width=video.videoWidth; photo.height=video.videoHeight; const p=photo.getContext("2d");
  if(facingMode==="user"){p.translate(photo.width,0);p.scale(-1,1);} p.drawImage(video,0,0,photo.width,photo.height);
  photo.toBlob(async blob=>{if(!blob)return; const file=new File([blob],`AI攝影師-${Date.now()}.jpg`,{type:"image/jpeg"});
    if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:"AI 攝影師照片"});return;}catch(e){if(e?.name==="AbortError")return;}}
    const a=document.createElement("a");a.download=file.name;a.href=URL.createObjectURL(blob);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  },"image/jpeg",.92);
});
startButton.addEventListener("click",async()=>{try{await startCamera();}catch(e){console.error(e);setStatus(`相機無法開啟：${e.name||"錯誤"}${e.message?"｜"+e.message:""}`);}});
switchButton.addEventListener("click",async()=>{if(!stream)return;facingMode=facingMode==="user"?"environment":"user";try{await startCamera();}catch(e){console.error(e);facingMode=facingMode==="user"?"environment":"user";setStatus("切換鏡頭失敗");}});
window.addEventListener("resize",resizeCanvas);
guide.addEventListener("click",()=>{if(running&&!detector)loadAI();});
