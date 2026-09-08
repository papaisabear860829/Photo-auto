const video=document.getElementById("video"),overlay=document.getElementById("overlay"),ctx=overlay.getContext("2d"),statusEl=document.getElementById("status"),aiStatusEl=document.getElementById("aiStatus"),guideEl=document.getElementById("guide"),sceneEl=document.getElementById("scene"),debugEl=document.getElementById("debug"),startBtn=document.getElementById("startBtn"),shotBtn=document.getElementById("shotBtn"),switchBtn=document.getElementById("switchBtn");
let stream=null,facingMode="environment",poseDetector=null,objectDetector=null,running=false,aiLoading=false,lastInference=0,lastObjectInference=0,lastGuide="",lastScene="",lastObjects=[],deviceBeta=null,deviceGamma=null;
function guide(t){if(t!==lastGuide){guideEl.textContent=t;lastGuide=t}}
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
  ctx.clearRect(0,0,overlay.width,overlay.height);
  drawGrid();
  const W=overlay.width,H=overlay.height;
  const meaningful=(objects||[])
    .filter(o=>(o.score||0)>.55&&o.class!=="person")
    .sort((a,b)=>(b.score||0)-(a.score||0))
    .slice(0,3);

  meaningful.forEach(o=>{
    const [x,y,w,h]=o.bbox;
    ctx.save();ctx.setLineDash([7,7]);ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);ctx.restore();
  });

  if(!p?.keypoints){
    if(meaningful.length){
      const main=meaningful[0], [x,y,w,h]=main.bbox;
      scene("找到拍攝主體："+main.class);
      const area=(w*h)/(W*H), cx=(x+w/2)/W, cy=(y+h/2)/H;
      if(area<.025){guide("主體太遠，靠近一點  ↑");return}
      if(cx<.20){guide("主體太靠左，往右一點  →");return}
      if(cx>.80){guide("主體太靠右，往左一點  ←");return}
      if(y<.03&&h<.35){guide("主體位置太高，手機放低一點  ↓");return}
      if(y+h>H*.97&&h<.35){guide("主體位置太低，手機抬高一點  ↑");return}
      guide("✓ 主體位置可以拍");return;
    }
    scene("還沒找到明確的拍攝主體");
    guide("先找一個想拍的主體");
    return;
  }

  const k=p.keypoints.filter(x=>(x.score||0)>.35);
  if(k.length<5){scene("人物位置還不清楚");guide("請讓人物進入畫面");return}

  const xs=k.map(x=>x.x),ys=k.map(x=>x.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const cx=(minX+maxX)/2,h=maxY-minY,r=h/H;
  const pad=12;
  ctx.save();ctx.setLineDash([10,8]);ctx.lineWidth=3;ctx.strokeRect(minX-pad,minY-pad,maxX-minX+pad*2,h+pad*2);ctx.restore();

  const nose=k.find(x=>x.name==="nose"), leftShoulder=k.find(x=>x.name==="left_shoulder"), rightShoulder=k.find(x=>x.name==="right_shoulder");
  const selfie=facingMode==="user";
  const faceX=nose?.x??cx, faceY=nose?.y??minY;
  const faceTooHigh=faceY<H*.16, faceTooLow=faceY>H*.55;
  const shouldersVisible=leftShoulder&&rightShoulder;
  const personObj=(objects||[]).find(o=>o.class==="person"&&o.score>.45);
  const mainObj=meaningful[0];

  if(personObj&&mainObj){
    const [ox,oy,ow,oh]=mainObj.bbox,ocx=ox+ow/2;
    scene("人物＋背景主體："+mainObj.class);
    // First protect the relationship between person and background subject.
    if(ocx<W*.30 && cx<W*.50){guide("人物往右一點，留住背景  →");return}
    if(ocx>W*.70 && cx>W*.50){guide("人物往左一點，留住背景  ←");return}
    if(selfie){
      if(faceTooHigh){guide("手機抬高一點  ↑");return}
      if(faceTooLow){guide("手機放低一點  ↓");return}
      if(!shouldersVisible && r>.70){guide("手機再拿遠一點");return}
    }else{
      if(r>.88){guide("再往後一點  ↓");return}
      if(r<.38){guide("再靠近一點  ↑");return}
    }
    const tilt=cameraTiltGuide();if(tilt){guide(tilt);return}
    guide("✓ 人物＋背景構圖可以拍");return;
  }

  if(selfie){
    scene("人物自拍構圖");
    // Don't endlessly ask the user to move away. Only ask when the face/body is actually being cut off.
    if(faceTooHigh){guide("手機抬高一點  ↑");return}
    if(faceTooLow){guide("手機放低一點  ↓");return}
    if(minX<W*.03 || maxX>W*.97){guide("臉太靠邊，往中間一點");return}
    if(!shouldersVisible && r>.72){guide("已接近自拍極限，可以拍");return}
    const tilt=cameraTiltGuide();if(tilt){guide(tilt);return}
    guide("✓ 自拍構圖可以拍");return;
  }

  scene(mainObj?"人物＋環境構圖":"人物構圖");
  if(cx<W*.38)guide("人物往右一點  →");
  else if(cx>W*.62)guide("人物往左一點  ←");
  else if(r>.88)guide("再往後一點  ↓");
  else if(r<.38)guide("再靠近一點  ↑");
  else {const tilt=cameraTiltGuide();guide(tilt||"✓ 人物構圖可以拍")}
}
function drawGrid(){ctx.save();ctx.strokeStyle="rgba(255,255,255,.20)";ctx.lineWidth=1;ctx.setLineDash([]);for(let i=1;i<3;i++){let x=overlay.width*i/3,y=overlay.height*i/3;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,overlay.height);ctx.stroke();ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(overlay.width,y);ctx.stroke()}ctx.restore()}
function capture(){if(!stream||video.readyState<2)return;const c=document.createElement("canvas");c.width=video.videoWidth;c.height=video.videoHeight;const x=c.getContext("2d");if(facingMode==="user"){x.translate(c.width,0);x.scale(-1,1)}x.drawImage(video,0,0,c.width,c.height);c.toBlob(async b=>{if(!b)return;const f=new File([b],"AI攝影師.jpg",{type:"image/jpeg"});try{if(navigator.share&&navigator.canShare?.({files:[f]}))await navigator.share({files:[f],title:"AI 攝影師"});else{const u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download="AI攝影師.jpg";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}}catch(e){}},"image/jpeg",.92)}
startBtn.onclick=startCamera;shotBtn.onclick=capture;switchBtn.onclick=async()=>{facingMode=facingMode==="environment"?"user":"environment";await startCamera()}
