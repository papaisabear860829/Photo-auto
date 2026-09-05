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
let PoseLandmarker = null;
let FilesetResolver = null;
let facingMode = "user";
let running = false;
let lastVideoTime = -1;

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

function setStatus(text, active = false) {
  statusText.textContent = text;
  dot.style.background = active ? "#45d483" : "#999";
}

async function loadModel() {
  setStatus("正在準備人物偵測…");
  try {
    const visionModule = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs");
    PoseLandmarker = visionModule.PoseLandmarker;
    FilesetResolver = visionModule.FilesetResolver;
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL_URL }, runningMode: "VIDEO", numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    setStatus("人物偵測已準備好", true);
  } catch (err) {
    console.error("AI model error:", err);
    setStatus("相機已開啟（AI 偵測載入失敗）", true);
  }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("此瀏覽器不支援相機功能");
    throw new Error("getUserMedia 不可用");
  }
  if (stream) stream.getTracks().forEach(t => t.stop());
  setStatus("正在開啟相機…");
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false });
  video.srcObject = stream;
  await video.play();
  resizeCanvas();
  captureButton.disabled = false;
  startButton.textContent = "重新啟動";
  running = true;
  setStatus("相機已開啟", true);
  if (!poseLandmarker) await loadModel();
  requestAnimationFrame(loop);
}

function resizeCanvas() {
  canvas.width = video.videoWidth || 720;
  canvas.height = video.videoHeight || 1280;
}

function clearOverlay() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawGuideBox(minX, minY, maxX, maxY) {
  const pad = Math.min(canvas.width, canvas.height) * 0.025;
  const x = minX * canvas.width - pad;
  const y = minY * canvas.height - pad;
  const w = (maxX - minX) * canvas.width + pad * 2;
  const h = (maxY - minY) * canvas.height + pad * 2;

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = Math.max(3, canvas.width / 240);
  ctx.setLineDash([14, 10]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function analyzePose(landmarks) {
  const visible = landmarks.filter(p => (p.visibility ?? 1) > 0.35);
  if (visible.length < 8) {
    guide.classList.remove("hidden");
    ready.classList.add("hidden");
    arrow.textContent = "•";
    guideText.textContent = "請讓人物完整入鏡";
    return;
  }

  const xs = visible.map(p => p.x);
  const ys = visible.map(p => p.y);
  const minX = Math.max(0, Math.min(...xs));
  const maxX = Math.min(1, Math.max(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxY = Math.min(1, Math.max(...ys));

  drawGuideBox(minX, minY, maxX, maxY);

  const centerX = (minX + maxX) / 2;
  const height = maxY - minY;

  let message = "";
  let symbol = "";

  if (centerX < 0.42) {
    symbol = "←";
    message = "人物往右一點";
  } else if (centerX > 0.58) {
    symbol = "→";
    message = "人物往左一點";
  } else if (height > 0.88) {
    symbol = "↓";
    message = "往後一點";
  } else if (height < 0.42) {
    symbol = "↑";
    message = "靠近一點";
  }

  if (message) {
    guide.classList.remove("hidden");
    ready.classList.add("hidden");
    arrow.textContent = symbol;
    guideText.textContent = message;
  } else {
    guide.classList.add("hidden");
    ready.classList.remove("hidden");
  }
}

async function loop() {
  if (!running) return;

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    resizeCanvas();
    clearOverlay();

    try {
      const result = poseLandmarker.detectForVideo(video, performance.now());
      if (result.landmarks?.length) {
        analyzePose(result.landmarks[0]);
      } else {
        guide.classList.remove("hidden");
        ready.classList.add("hidden");
        arrow.textContent = "•";
        guideText.textContent = "找不到人物";
      }
    } catch (err) {
      console.error(err);
      statusText.textContent = `相機無法開啟：${err.name || '錯誤'}${err.message ? '｜' + err.message : ''}`;
    }
  }

  requestAnimationFrame(loop);
}

captureButton.addEventListener("click", () => {
  if (!stream) return;

  const photo = document.createElement("canvas");
  photo.width = video.videoWidth;
  photo.height = video.videoHeight;
  const pctx = photo.getContext("2d");

  if (facingMode === "user") {
    pctx.translate(photo.width, 0);
    pctx.scale(-1, 1);
  }

  pctx.drawImage(video, 0, 0, photo.width, photo.height);

  const link = document.createElement("a");
  link.download = `ai-camera-${Date.now()}.jpg`;
  link.href = photo.toDataURL("image/jpeg", 0.92);
  link.click();
});

startButton.addEventListener("click", async () => {
  try {
    await startCamera();
  } catch (err) {
    console.error("Camera error:", err);
    setStatus(`相機無法開啟：${err.name || "錯誤"}`, false);
  }
});

switchButton.addEventListener("click", async () => {
  facingMode = facingMode === "user" ? "environment" : "user";
  if (stream) {
    try {
      await startCamera();
    } catch (err) {
      console.error(err);
      statusText.textContent = `相機無法開啟：${err.name || '錯誤'}${err.message ? '｜' + err.message : ''}`;
      setStatus("切換鏡頭失敗");
    }
  }
});

window.addEventListener("resize", resizeCanvas);
