const video=document.getElementById("video"),overlay=document.getElementById("overlay"),ctx=overlay.getContext("2d"),statusEl=document.getElementById("status"),aiStatusEl=document.getElementById("aiStatus"),guideEl=document.getElementById("guide"),sceneEl=document.getElementById("scene"),debugEl=document.getElementById("debug"),startBtn=document.getElementById("startBtn"),shotBtn=document.getElementById("shotBtn"),switchBtn=document.getElementById("switchBtn");
let stream=null,facingMode="environment",poseDetector=null,objectDetector=null,running=false,aiLoading=false,lastInference=0,lastObjectInference=0,lastGuide="",lastScene="",lastObjects=[],deviceBeta=null,deviceGamma=null,stableCandidate="",stableSince=0,stableGuide="";
function guide(t){
  const now=performance.now();
  // Hysteresis: do not let tiny frame-to-frame changes make the instruction jump.
  if(t!==stableCandidate){stableCandidate=t;stableSince=now;return}
  const hold=t.startsWith("✓")?700:450;
  if(now-stableSince<hold)return;
  if(t!==lastGuide){guideEl.textContent=t;lastGuide=t}
}
function scene(t){if(t!==lastScene){sceneEl.textContent=t;lastScene=t}}
function resize(){overlay.width=video.videoWidth||innerWidth;overlay.height=video.videoHeight||innerHeight}
video.addEventListener("loadedmetadata",resize);addEventListener("resize",resize);
addEventListener("deviceorientation",e=>{deviceBeta=e.beta;deviceGamma=e.gamma},{passive:true});
function cameraTiltGuide(){
  if(typeof deviceBeta!=="number"||typeof deviceGamma!=="number") return null;
  // beta: front/back tilt, gamma: left/right tilt. Only give guidance when clearly tilted.
  if(Math.abs(deviceGamma)>10) return deviceGamma>0?"手機往左轉一點  ←":"手機往右轉一點  →";
  if(deviceBeta>12) return "手機抬高一點  ↑";
  if(deviceBeta< -8) return "手機放低一點  ↓";
  return null;
}
async function startCamera(){try{if(!isSecureContext)throw Error("不是安全連線（HTTPS）");if(!navigator.mediaDevices?.getUserMedia)throw Error("此瀏覽器不支援相機");if(stream)stream.getTracks().forEach(t=>t.stop());stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facingMode},width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=stream;video.muted=true;video.playsInline=true;await video.play();resize();statusEl.textContent="相機已開啟";shotBtn.disabled=false;startBtn.textContent="重新啟動";guide("AI 準備中…");startLoop();loadAI()}catch(e){statusEl.textContent="相機無法開啟";guide("請允許 Safari 使用相機");debugEl.textContent=(e.name||"Error")+"："+(e.message||e)}}
async function loadAI(){if(aiLoading||(poseDetector&&objectDetector))return;aiLoading=true;aiStatusEl.textContent="AI：載入中…";debugEl.textContent="AI ① TensorFlow.js";try{if(!window.tf)throw Error("TensorFlow.js 未載入");await tf.ready();debugEl.textContent="AI ② TFJS "+tf.version.tfjs;if(!window.poseDetection)throw Error("Pose Detection 未載入");debugEl.textContent="AI ③ 人體模型載入中…";poseDetector=await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet,{modelType:poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,enableSmoothing:true});aiStatusEl.textContent="AI：人物偵測已就緒";guide("請讓人物進入畫面");if(window.cocoSsd){try{debugEl.textContent="AI ④ 場景模型載入中…";objectDetector=await cocoSsd.load({base:"lite_mobilenet_v2"});scene("AI 正在理解人物與背景");debugEl.textContent="AI ⑤ 人物＋場景即時偵測已啟動"}catch(e){debugEl.textContent="場景模型略過："+(e.message||e);scene("目前先以人物構圖為主")}}aiStatusEl.textContent=objectDetector?"AI：人物＋場景已就緒":"AI：人物偵測已就緒"}catch(e){poseDetector=null;objectDetector=null;aiStatusEl.textContent="AI：載入失敗";debugEl.textContent=(e.name||"Error")+"："+(e.message||e);guide("AI 尚未就緒，但相機可使用")}finally{aiLoading=false}}
function startLoop(){if(running)return;running=true;requestAnimationFrame(loop)}
async function loop(now){if(!running)return;if(poseDetector&&video.readyState>=2&&now-lastInference>120){lastInference=now;try{const poses=await poseDetector.estimatePoses(video,{flipHorizontal:false});let objects=lastObjects;if(objectDetector&&now-lastObjectInference>550){lastObjectInference=now;try{objects=await objectDetector.detect(video);lastObjects=objects}catch(e){debugEl.textContent="場景偵測錯誤："+(e.message||e)}}draw(poses?.[0],objects)}catch(e){debugEl.textContent="人物偵測錯誤："+(e.message||e)}}requestAnimationFrame(loop)}
function draw(p,objects){
  ctx.clearRect(0,0,overlay.width,overlay.height); drawGrid();
  const W=overlay.width,H=overlay.height;
  const meaningful=(objects||[]).filter(o=>(o.score||0)>.55&&o.class!=="person").sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,3);
  meaningful.forEach(o=>{const [x,y,w,h]=o.bbox;ctx.save();ctx.setLineDash([7,7]);ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);ctx.restore()});

  // No person is NOT an error. A good camera assistant must also handle scenery and objects.
  if(!p?.keypoints){
    if(meaningful.length){
      const main=meaningful[0], [x,y,w,h]=main.bbox, area=w*h/(W*H), cx=(x+w/2)/W;
      scene("純景／物：拍攝主體「"+main.class+"」");
      if(area<.018){guide("主體太小，靠近一點  ↑");return}
      if(cx<.18){guide("主體太靠左，往右一點  →");return}
      if(cx>.82){guide("主體太靠右，往左一點  ←");return}
      if(y<.02&&h<.30){guide("主體太靠上，手機放低一點  ↓");return}
      if(y+h>H*.98&&h<.30){guide("主體太靠下，手機抬高一點  ↑");return}
      const tilt=cameraTiltGuide(); guide(tilt||"✓ 這個主體可以拍"); return;
    }
    scene("純景／物：還沒找到明確主體");
    guide("找一個你想拍的主體"); return;
  }

  const k=p.keypoints.filter(x=>(x.score||0)>.35);
  if(k.length<5){scene("人物位置還不清楚");guide("請讓人物進入畫面");return}
  const xs=k.map(x=>x.x),ys=k.map(x=>x.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const cx=(minX+maxX)/2,h=maxY-minY,r=h/H,pad=12;
  ctx.save();ctx.setLineDash([10,8]);ctx.lineWidth=3;ctx.strokeRect(Math.max(0,minX-pad),Math.max(0,minY-pad),Math.min(W,maxX+pad)-Math.max(0,minX-pad),Math.min(H,maxY+pad)-Math.max(0,minY-pad));ctx.restore();

  const by=n=>k.find(x=>x.name===n), nose=by("nose"), leftShoulder=by("left_shoulder"), rightShoulder=by("right_shoulder"), leftWrist=by("left_wrist"),rightWrist=by("right_wrist"),leftEar=by("left_ear"),rightEar=by("right_ear");
  const selfie=facingMode==="user", faceX=nose?.x??cx, faceY=nose?.y??minY;
  const shouldersVisible=leftShoulder&&rightShoulder;
  const mainObj=meaningful[0], personObj=(objects||[]).find(o=>o.class==="person"&&o.score>.45);

  // Explicit target zone: instead of "a little", show where the person should go.
  const targetCx=selfie?W*.50:(mainObj?(mainObj.bbox[0]+mainObj.bbox[2]/2< W/2?W*.62:W*.38):W*.50);
  const dx=(targetCx-cx)/W;
  if(Math.abs(dx)>.11){
    const amount=Math.abs(dx)>.25?"約一個身位":"約半個身位";
    guide(dx>0?`人物往右 ${amount} →`:`人物往左 ${amount} ←`); return;
  }

  if(mainObj&&personObj){scene("人物＋背景主體："+mainObj.class)} else {scene(selfie?"人物自拍構圖":"人物構圖")}

  if(selfie){
    // Face size from ear distance / shoulder width; much stricter than overall body height.
    const earSpan=(leftEar&&rightEar)?Math.abs(leftEar.x-rightEar.x)/W:0;
    const shoulderSpan=(leftShoulder&&rightShoulder)?Math.abs(leftShoulder.x-rightShoulder.x)/W:0;
    const faceTooLarge=earSpan>.32 || shoulderSpan>.72 || r>.90;
    const headCut=faceY<H*.06 || minX<W*.015 || maxX>W*.985;
    const handsCut=(leftWrist&&leftWrist.x<W*.025)||(rightWrist&&rightWrist.x>W*.975)||(leftWrist&&leftWrist.y>H*.99)||(rightWrist&&rightWrist.y>H*.99);
    if(faceTooLarge){guide("臉太近，請拿遠一點");return}
    if(headCut){guide("頭部太靠邊，手機往後一點");return}
    if(handsCut){guide("手被切到了，請拿遠一點");return}
    const tilt=cameraTiltGuide();guide(tilt||"✓ 自拍構圖可以拍");return;
  }

  // Non-selfie person: use a wide acceptable band so tiny movements don't flip the result.
  if(r>.83){guide("人物太近，請往後約半個身位  ↓");return}
  if(r<.34){guide("人物太遠，請靠近約半個身位  ↑");return}
  const tilt=cameraTiltGuide(); guide(tilt|| (mainObj?"✓ 人物＋背景構圖可以拍":"✓ 人物構圖可以拍"));
}
function drawGrid(){ctx.save();ctx.strokeStyle="rgba(255,255,255,.20)";ctx.lineWidth=1;ctx.setLineDash([]);for(let i=1;i<3;i++){let x=overlay.width*i/3,y=overlay.height*i/3;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,overlay.height);ctx.stroke();ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(overlay.width,y);ctx.stroke()}ctx.restore()}
function capture(){if(!stream||video.readyState<2)return;const c=document.createElement("canvas");c.width=video.videoWidth;c.height=video.videoHeight;const x=c.getContext("2d");if(facingMode==="user"){x.translate(c.width,0);x.scale(-1,1)}x.drawImage(video,0,0,c.width,c.height);c.toBlob(async b=>{if(!b)return;const f=new File([b],"AI攝影師.jpg",{type:"image/jpeg"});try{if(navigator.share&&navigator.canShare?.({files:[f]}))await navigator.share({files:[f],title:"AI 攝影師"});else{const u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download="AI攝影師.jpg";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}}catch(e){}},"image/jpeg",.92)}
startBtn.onclick=startCamera;shotBtn.onclick=capture;switchBtn.onclick=async()=>{facingMode=facingMode==="environment"?"user":"environment";await startCamera()}
