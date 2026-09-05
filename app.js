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
let poseLandmarker = null;
let facingMode = "user";
let running = false;
let aiLoading = false;
let lastVideoTime = -1;

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

function setStatus(text, active = false) { statusText.textContent = text; dot.style.background = active ? "#45d483" : "#999"; }
function resizeCanvas() { canvas.width = video.videoWidth || 720; canvas.height = video.videoHeight || 1280; }
function clearOverlay() { ctx.clearRect(0,0,canvas.width,canvas.height); }

async function loadModel() {
  if (poseLandmarker || aiLoading) return;
  aiLoading = true;
  try {
    const m = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs");
    const vision = await m.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
    poseLandmarker = await m.PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL }, runningMode: "VIDEO", numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
    });
    if (running) setStatus("人物偵測已準備好", true);
  } catch (e) {
    console.error("AI model error", e);
    poseLandmarker = null;
    if (running) setStatus("相機已開啟（AI 尚未載入）", true);
  } finally { aiLoading = false; }
}

async function startCamera() {
  if (!window.isSecureContext) throw new Error("SECURE_CONTEXT");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("GET_USER_MEDIA_UNAVAILABLE");
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; running = false;
  setStatus("正在開啟相機…");
  const constraints = { video: { facingMode: { exact: facingMode } }, audio: false };
  let nextStream;
  try { nextStream = await navigator.mediaDevices.getUserMedia(constraints); }
  catch (e) {
    // Some iOS devices reject exact facingMode; retry with a simple facingMode constraint.
    nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
  }
  stream = nextStream;
  video.srcObject = stream;
  video.muted = true; video.setAttribute("playsinline", ""); video.setAttribute("autoplay", "");
  await video.play();
  resizeCanvas();
  running = true; captureButton.disabled = false; startButton.textContent = "重新啟動";
  setStatus("相機已開啟", true);
  requestAnimationFrame(loop);
  loadModel();
}

function drawGuideBox(minX,minY,maxX,maxY) {
  const pad=Math.min(canvas.width,canvas.height)*0.025,x=minX*canvas.width-pad,y=minY*canvas.height-pad,w=(maxX-minX)*canvas.width+pad*2,h=(maxY-minY)*canvas.height+pad*2;
  ctx.save(); ctx.strokeStyle="rgba(255,255,255,.9)"; ctx.lineWidth=Math.max(3,canvas.width/240); ctx.setLineDash([14,10]); ctx.strokeRect(x,y,w,h); ctx.restore();
}
function analyzePose(lm) {
  const v=lm.filter(p=>(p.visibility??1)>0.35);
  if(v.length<8){guide.classList.remove("hidden");ready.classList.add("hidden");arrow.textContent="•";guideText.textContent="請讓人物完整入鏡";return;}
  const xs=v.map(p=>p.x),ys=v.map(p=>p.y),minX=Math.max(0,Math.min(...xs)),maxX=Math.min(1,Math.max(...xs)),minY=Math.max(0,Math.min(...ys)),maxY=Math.min(1,Math.max(...ys));
  drawGuideBox(minX,minY,maxX,maxY); const cx=(minX+maxX)/2,h=maxY-minY; let msg="",sym="";
  if(cx<0.42){sym="←";msg="人物往右一點";} else if(cx>0.58){sym="→";msg="人物往左一點";} else if(h>0.88){sym="↓";msg="往後一點";} else if(h<0.42){sym="↑";msg="靠近一點";}
  if(msg){guide.classList.remove("hidden");ready.classList.add("hidden");arrow.textContent=sym;guideText.textContent=msg;}else{guide.classList.add("hidden");ready.classList.remove("hidden");}
}

function loop() {
  if(!running) return;
  if(video.readyState>=2 && video.currentTime!==lastVideoTime){
    lastVideoTime=video.currentTime; resizeCanvas(); clearOverlay();
    if(poseLandmarker){
      try { const r=poseLandmarker.detectForVideo(video, performance.now()); if(r.landmarks?.length) analyzePose(r.landmarks[0]); else {guide.classList.remove("hidden");ready.classList.add("hidden");arrow.textContent="•";guideText.textContent="找不到人物";} }
      catch(e){ console.error("Pose error",e); poseLandmarker=null; setStatus("相機已開啟（AI 偵測暫停）",true); }
    }
  }
  requestAnimationFrame(loop);
}

captureButton.addEventListener("click",()=>{ if(!stream)return; const photo=document.createElement("canvas"); photo.width=video.videoWidth;photo.height=video.videoHeight;const p=photo.getContext("2d"); if(facingMode==="user"){p.translate(photo.width,0);p.scale(-1,1);} p.drawImage(video,0,0,photo.width,photo.height); const a=document.createElement("a");a.download=`ai-camera-${Date.now()}.jpg`;a.href=photo.toDataURL("image/jpeg",.92);a.click(); });
startButton.addEventListener("click",async()=>{try{await startCamera();}catch(e){console.error("Camera error",e); setStatus(`相機無法開啟：${e.name||"錯誤"}${e.message?"｜"+e.message:""}`);}});
switchButton.addEventListener("click",async()=>{if(!stream)return; facingMode=facingMode==="user"?"environment":"user"; try{await startCamera();}catch(e){console.error(e);facingMode=facingMode==="user"?"environment":"user";setStatus("切換鏡頭失敗");}});
window.addEventListener("resize",resizeCanvas);
