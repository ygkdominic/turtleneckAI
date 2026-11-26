import { setupCameraBackground } from "./camera-background.js?v=0.7.4";
import { setupFocusTimer } from "./focus-timer.js?v=0.7.0";
import { setupMiniWindow } from "./mini-window.js?v=0.7.5";
import { setupCameraDevices } from "./camera-device.js?v=0.7.1";

const els = {
  startBtn: document.querySelector("#startBtn"),
  calibrateBtn: document.querySelector("#calibrateBtn"),
  webcam: document.querySelector("#webcam"),
  preview: document.querySelector("#backgroundPreview"),
  cameraPlaceholder: document.querySelector("#cameraPlaceholder"),
  cameraSelect: document.querySelector("#cameraSelect"),
  cameraDeviceStatus: document.querySelector("#cameraDeviceStatus"),
  score: document.querySelector("#score"),
  statusPill: document.querySelector("#statusPill"),
  meterFill: document.querySelector("#meterFill"),
  feedback: document.querySelector("#feedback"),
  sensitivity: document.querySelector("#sensitivity"),
  alertDelay: document.querySelector("#alertDelay"),
  alertMode: document.querySelector("#alertMode"),
  requestNotifyBtn: document.querySelector("#requestNotifyBtn"),
  notificationStatus: document.querySelector("#notificationStatus"),
  soundToggle: document.querySelector("#soundToggle"),
  toast: document.querySelector("#toast"),
  goodTime: document.querySelector("#goodTime"),
  warnTime: document.querySelector("#warnTime"),
  badTime: document.querySelector("#badTime"),
  goodRatio: document.querySelector("#goodRatio"),
  badCount: document.querySelector("#badCount"),
  sessionTime: document.querySelector("#sessionTime"),
  dailyInsight: document.querySelector("#dailyInsight"),
  cameraStatusText: document.querySelector("#cameraStatusText"),
  recognitionChip: document.querySelector("#recognitionChip"),
  recognitionStatusText: document.querySelector("#recognitionStatusText"),
  qualityGuide: document.querySelector("#qualityGuide"),
  reportTimestamp: document.querySelector("#reportTimestamp"),
  saveReportBtn: document.querySelector("#saveReportBtn"),
  autoCalibrateOverlay: document.querySelector("#autoCalibrateOverlay"),
  autoCalibrateMessage: document.querySelector("#autoCalibrateMessage"),
  autoCalibrateCount: document.querySelector("#autoCalibrateCount"),
  soundTestBtn: document.querySelector("#soundTestBtn")
};

let poseLandmarker;
let webcamRunning = false;
let cancelNextPrediction;
let autoCalibrationStart;
let lastVideoTime = -1;
let baseline = null;
let calibrationFrames = [];
let isCalibrating = false;
let badStartedAt = null;
let lastAlertAt = 0;
let badCount = 0;
let sessionStartAt = null;
let sessionElapsedMs = 0;
let lastTickAt = null;
let postureSeconds = { good: 0, warn: 0, bad: 0 };
let currentState = "idle";
let currentRecognitionQuality = { level: "idle", message: "대기 중", usable: false };
let audioContext = null;
let autoCalibrationTimer = null;
let countdownTimer = null;
let toastTimer = null;
let priorityToast = false;
const cameraFrame = document.createElement("canvas");
const cameraFrameContext = cameraFrame.getContext("2d");
const previewContext = els.preview.getContext("2d");
const GUIDE_POINTS = [0, 2, 5, 9, 10, 11, 12];
const GUIDE_CONNECTIONS = [[2, 0], [0, 5], [9, 10], [11, 12]];

const sensitivityMap = {
  low: { badThreshold: 45, warnThreshold: 70, multiplier: 0.82 },
  medium: { badThreshold: 50, warnThreshold: 75, multiplier: 1.0 },
  high: { badThreshold: 55, warnThreshold: 80, multiplier: 1.18 }
};

const alertCopy = {
  warn: {
    title: "자세가 조금 무너졌어요",
    body: "턱을 살짝 당기고 어깨 힘을 빼보세요."
  },
  bad: {
    title: "바른 자세로 돌아올 시간이에요",
    body: "턱을 살짝 당기고 등받이에 기대어 화면과 거리를 조정해보세요."
  }
};

async function createPoseLandmarker() {
  els.feedback.textContent = "AI 습관 코치를 준비하는 중입니다.";

  const { PoseLandmarker, FilesetResolver, DrawingUtils } = await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14"
  );
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  const modelAssetPath =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
  const modelCanvas = document.createElement("canvas");
  const options = {
    canvas: modelCanvas,
    runningMode: "VIDEO",
    numPoses: 1,
    outputSegmentationMasks: true,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  };
  try {
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      ...options, baseOptions: { modelAssetPath, delegate: "GPU" }
    });
  } catch (error) {
    console.warn("GPU 자세 감지 모델을 실행하지 못해 CPU로 다시 시도합니다.", error);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      ...options, baseOptions: { modelAssetPath, delegate: "CPU" }
    });
  }

  cameraBackground.setRenderer(DrawingUtils, modelCanvas);
}

async function enableCam() {
  els.startBtn.disabled = true;
  els.cameraSelect.disabled = true;
  els.startBtn.textContent = "카메라 준비 중…";
  if (els.soundToggle.checked) unlockAudio();

  let stream;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable");
    stream = await cameraDevices.open();
    if (!poseLandmarker) await createPoseLandmarker();
    els.webcam.srcObject = stream;
    await els.webcam.play();
    webcamRunning = true;
    sessionStartAt = Date.now();
    lastTickAt = sessionStartAt;
    cameraBackground.setActive(true);
    cameraDevices.showActive(stream.getVideoTracks()[0]);
    els.cameraPlaceholder.hidden = true;
    els.startBtn.textContent = "카메라 끄기";
    els.calibrateBtn.disabled = false;
    els.feedback.textContent = "카메라가 켜졌습니다. 자세를 바로잡아 주세요. 3초 후 기준자세가 자동으로 설정됩니다.";
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      if (els.webcam.srcObject !== stream) return;
      stopCamera();
      els.feedback.textContent = "카메라 연결이 끊겼어요. 연결 상태를 확인한 뒤 다시 시작하세요.";
    }, { once: true });
    autoCalibrationStart = window.setTimeout(startAutoCalibration, 350);
    schedulePrediction();
  } catch (error) {
    console.error(error);
    if (stream !== els.webcam.srcObject) stream?.getTracks().forEach(track => track.stop());
    stopCamera();
    els.feedback.textContent = getCameraErrorMessage(error);
    setStatus("bad", "실행 오류");
  } finally {
    els.startBtn.disabled = false;
    els.cameraSelect.disabled = !navigator.mediaDevices?.getUserMedia;
  }
}

function stopCamera() {
  webcamRunning = false;
  cancelNextPrediction?.();
  cancelNextPrediction = undefined;
  window.clearTimeout(autoCalibrationStart);
  window.clearTimeout(autoCalibrationTimer);
  hideAutoCalibrationOverlay();
  isCalibrating = false;
  calibrationFrames = [];
  for (const track of els.webcam.srcObject?.getTracks() ?? []) track.stop();
  els.webcam.srcObject = null;
  cameraDevices.showActive();
  cameraBackground.setActive(false);
  cameraFrame.width = cameraFrame.height = 1;
  miniWindow.refreshPreview();

  sessionElapsedMs = getSessionElapsedMs();
  sessionStartAt = null;
  lastTickAt = null;
  lastVideoTime = -1;
  badStartedAt = null;
  lastAlertAt = 0;
  els.cameraPlaceholder.hidden = false;
  els.startBtn.textContent = "카메라 시작";
  els.calibrateBtn.disabled = true;
  els.calibrateBtn.textContent = baseline ? "기준 자세 다시 설정" : "바른 자세 설정";
  els.score.textContent = "--";
  els.meterFill.style.width = "0%";
  els.sessionTime.textContent = formatDuration(sessionElapsedMs / 1000);
  els.feedback.textContent = "카메라를 켜면 자세 측정을 다시 시작할 수 있어요.";
  updateRecognitionQuality({ level: "idle", message: "대기 중", usable: false });
  setStatus("idle", "측정 대기 중");
}

function getCameraErrorMessage(error) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "이 브라우저는 카메라 접근을 지원하지 않습니다. Chrome 최신 버전 또는 HTTPS 주소에서 다시 시도하세요.";
  }
  if (error?.name === "NotAllowedError") {
    return "카메라 접근이 차단됐어요. Safari에서는 설정 → 웹사이트 → 카메라에서 이 주소를 ‘묻기’로 바꾼 뒤 카메라를 다시 시작하세요.";
  }
  if (error?.name === "CameraSelectionError") {
    return error.message;
  }
  if (error?.name === "OverconstrainedError") {
    return "선택한 카메라를 사용할 수 없어요. 카메라 연결과 선택을 확인해 주세요.";
  }
  if (error?.name === "NotFoundError") {
    return "카메라를 찾지 못했습니다. 내장/외장 카메라 연결 상태를 확인하세요.";
  }
  if (error?.name === "NotReadableError") {
    return "다른 앱이 카메라를 사용 중일 수 있습니다. Zoom, Teams, FaceTime 등을 종료 후 다시 시도하세요.";
  }
  return "카메라 또는 AI 모델을 실행하지 못했습니다. HTTPS 주소, 브라우저 권한, 회사 보안망 여부를 확인하세요.";
}

function getMetrics(landmarks) {
  const nose = landmarks[0];
  const leftEye = landmarks[2];
  const rightEye = landmarks[5];
  const leftEar = landmarks[7];
  const rightEar = landmarks[8];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];

  if (!nose || !leftShoulder || !rightShoulder) return null;

  const shoulderMid = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2
  };

  const shoulderWidth = Math.max(0.001, Math.abs(leftShoulder.x - rightShoulder.x));
  const shoulderSlope = Math.abs(leftShoulder.y - rightShoulder.y);
  const headCenterOffset = Math.abs(nose.x - shoulderMid.x) / shoulderWidth;
  const headDrop = (nose.y - shoulderMid.y) / shoulderWidth;

  let faceWidth = 0;
  if (leftEar && rightEar) faceWidth = Math.abs(leftEar.x - rightEar.x);
  else if (leftEye && rightEye) faceWidth = Math.abs(leftEye.x - rightEye.x) * 2.2;

  return { shoulderWidth, shoulderSlope, headCenterOffset, headDrop, faceWidth };
}


function getLandmarkQuality(landmarks) {
  const visible = GUIDE_POINTS.filter(index => isLandmarkUsable(landmarks[index])).length;

  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const nose = landmarks[0];
  const shoulderWidth = leftShoulder && rightShoulder ? Math.abs(leftShoulder.x - rightShoulder.x) : 0;
  const shouldersLowEnough = leftShoulder && rightShoulder ? (leftShoulder.y > 0.35 && rightShoulder.y > 0.35) : false;
  const faceCentered = nose ? (nose.x > 0.22 && nose.x < 0.78 && nose.y > 0.08 && nose.y < 0.68) : false;

  if (visible >= 7 && shoulderWidth >= 0.18 && shouldersLowEnough && faceCentered) {
    return { level: "good", message: "좋음", usable: true };
  }
  if (visible >= 5 && shoulderWidth >= 0.12 && [nose, leftShoulder, rightShoulder].every(isLandmarkUsable)) {
    return { level: "warn", message: "불안정", usable: true };
  }
  return { level: "bad", message: "인식 어려움", usable: false };
}

function isLandmarkUsable(point) {
  return point && point.x >= 0.02 && point.x <= 0.98 && point.y >= 0.02 && point.y <= 0.98 &&
    (point.visibility ?? 1) >= 0.5;
}

function updateRecognitionQuality(quality) {
  currentRecognitionQuality = quality;
  if (!els.recognitionStatusText) return;
  els.recognitionStatusText.textContent = quality.message;
  els.recognitionChip.className = `recognition-chip ${quality.level}`;

  if (els.qualityGuide) {
    if (quality.level === "good") {
      els.qualityGuide.textContent = "얼굴과 양쪽 어깨가 안정적으로 인식되고 있습니다.";
    } else if (quality.level === "warn") {
      els.qualityGuide.textContent = "인식이 조금 불안정합니다. 얼굴과 양쪽 어깨를 화면 중앙에 맞춰주세요.";
    } else if (quality.level === "bad") {
      els.qualityGuide.textContent = "얼굴·입·양쪽 어깨가 충분히 보이지 않습니다. 조명과 카메라 위치를 조정해주세요.";
    } else {
      els.qualityGuide.textContent = "정면을 바라보고, 얼굴과 양쪽 어깨가 화면 안에 들어오면 인식 상태가 안정적으로 표시됩니다.";
    }
  }
}

function averageMetrics(frames) {
  const avg = { shoulderSlope: 0, headCenterOffset: 0, headDrop: 0, faceWidth: 0 };
  frames.forEach(frame => {
    Object.keys(avg).forEach(key => avg[key] += frame[key]);
  });
  Object.keys(avg).forEach(key => avg[key] /= frames.length);
  return avg;
}

function calculateScore(metrics) {
  if (!baseline) return 0;
  const sensitivity = sensitivityMap[els.sensitivity.value];

  const dropPenalty = Math.max(0, metrics.headDrop - baseline.headDrop - 0.08) * 210;
  const centerPenalty = Math.max(0, metrics.headCenterOffset - baseline.headCenterOffset - 0.18) * 130;
  const slopePenalty = Math.max(0, metrics.shoulderSlope - baseline.shoulderSlope - 0.035) * 520;
  const closePenalty = Math.max(0, metrics.faceWidth - baseline.faceWidth - 0.05) * 180;

  const totalPenalty = (dropPenalty + centerPenalty + slopePenalty + closePenalty) * sensitivity.multiplier;
  return Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));
}

function classifyScore(score) {
  const sensitivity = sensitivityMap[els.sensitivity.value];
  if (score >= sensitivity.warnThreshold) return "good";
  if (score >= sensitivity.badThreshold) return "warn";
  return "bad";
}

function updateUI(score, metrics) {
  els.score.textContent = Number.isFinite(score) ? score : "--";
  els.meterFill.style.width = `${Number.isFinite(score) ? score : 0}%`;

  if (!baseline) {
    setStatus("idle", "캘리브레이션 필요");
    return;
  }

  const state = classifyScore(score);
  currentState = state;

  if (state === "good") {
    setStatus("good", "좋은 자세");
    els.feedback.textContent = "좋습니다. 지금 자세를 편안하게 유지해보세요.";
  } else if (state === "warn") {
    setStatus("warn", "주의 자세");
    els.feedback.textContent = "목 또는 어깨 정렬이 조금 무너졌습니다. 턱을 살짝 당겨보세요.";
  } else {
    setStatus("bad", "무너진 자세");
    const reasons = [];
    if (metrics.headDrop > baseline.headDrop + 0.08) reasons.push("고개가 아래/앞으로 내려감");
    if (metrics.headCenterOffset > baseline.headCenterOffset + 0.18) reasons.push("머리 중심이 어깨 중심에서 벗어남");
    if (metrics.shoulderSlope > baseline.shoulderSlope + 0.035) reasons.push("어깨 높이 차이 증가");
    if (metrics.faceWidth > baseline.faceWidth + 0.05) reasons.push("화면에 가까워짐");
    els.feedback.textContent = reasons.length ? `감지: ${reasons.join(", ")}` : "자세가 무너지고 있습니다.";
  }
}

function setStatus(kind, text) {
  els.statusPill.className = `status-pill ${kind}`;
  els.statusPill.textContent = text;
  if (els.cameraStatusText) els.cameraStatusText.textContent = text;
}

function handleAlert(score) {
  if (!baseline) return;
  const now = Date.now();
  const delayMs = Number(els.alertDelay.value) * 1000;
  const state = classifyScore(score);

  if (state === "bad") {
    if (!badStartedAt) badStartedAt = now;
    if (now - badStartedAt > delayMs && now - lastAlertAt > 15000) {
      sendAlert("bad");
      if (els.soundToggle.checked && els.alertMode.value !== "off") softBeep();
      badCount += 1;
      lastAlertAt = now;
    }
  } else {
    badStartedAt = null;
  }
}

function sendAlert(level) {
  const mode = els.alertMode.value;
  if (mode === "off") return;

  const copy = alertCopy[level] || alertCopy.bad;
  if (mode === "page" || mode === "both") showToast(copy.title, copy.body);
  if (mode === "desktop" || mode === "both") showPostureDesktopNotification(copy);
}

function showToast(title, body, { priority = false } = {}) {
  if (priorityToast && !priority) return;
  priorityToast = priority;
  window.clearTimeout(toastTimer);
  els.toast.querySelector("strong").textContent = title;
  els.toast.querySelector("span").textContent = body;
  els.toast.classList.remove("hidden");
  els.toast.setAttribute("aria-hidden", "false");
  toastTimer = window.setTimeout(() => {
    priorityToast = false;
    els.toast.classList.add("hidden");
    els.toast.setAttribute("aria-hidden", "true");
  }, priority ? 8000 : 4200);
}

async function showPostureDesktopNotification({ title, body }) {
  if (await notifyDesktop(title, body, "turtleneckai-posture-alert")) return;
  if (!("Notification" in window)) {
    showToast("데스크톱 알림 미지원", "현재 브라우저는 OS 알림을 지원하지 않습니다.");
  } else if (Notification.permission === "default") {
    updateNotificationStatus();
    showToast("알림 권한이 필요합니다", "알림 설정에서 데스크톱 알림 권한을 먼저 허용해주세요.");
  } else if (Notification.permission === "denied") {
    updateNotificationStatus();
    showToast("알림 권한이 차단됨", "브라우저 사이트 설정에서 알림 권한을 허용해야 합니다.");
  } else {
    showToast(title, body);
  }
}

async function notifyDesktop(title, body, tag) {
  if (window.Notification?.permission !== "granted") return false;
  const options = { body, tag, renotify: true };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.active) {
      await registration.showNotification(title, options);
    } else {
      const notification = new Notification(title, options);
      notification.onclick = () => window.focus();
    }
    return true;
  } catch (error) {
    console.warn("컴퓨터 알림 표시 실패", error);
    return false;
  }
}

function unlockAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  try {
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state !== "running") {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  } catch {
    return null;
  }
}

function softBeep(frequency = 660) {
  const ctx = unlockAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.11, ctx.currentTime + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.34);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.38);
}

function testSound() {
  if (!els.soundToggle.checked) els.soundToggle.checked = true;
  persistSettings();
  softBeep();
  showToast("알림 소리 테스트", "소리가 들리지 않으면 기기 음량, 무음 모드, 브라우저 권한을 확인해주세요.");
}

function updateStats(score) {
  const now = Date.now();
  if (!sessionStartAt || !lastTickAt || !baseline) return;
  const delta = Math.max(0, Math.min(5, (now - lastTickAt) / 1000));
  lastTickAt = now;

  const state = classifyScore(score);
  postureSeconds[state] += delta;

  const totalPostureSeconds = postureSeconds.good + postureSeconds.warn + postureSeconds.bad;
  const goodRatio = totalPostureSeconds > 0 ? Math.round((postureSeconds.good / totalPostureSeconds) * 100) : 0;

  els.goodTime.textContent = formatDuration(postureSeconds.good);
  els.warnTime.textContent = formatDuration(postureSeconds.warn);
  els.badTime.textContent = formatDuration(postureSeconds.bad);
  els.goodRatio.textContent = `${goodRatio}%`;
  els.badCount.textContent = `${badCount}회`;
  els.sessionTime.textContent = formatDuration(getSessionElapsedMs(now) / 1000);
  els.dailyInsight.textContent = makeDailyInsight(goodRatio, postureSeconds);
  updateReportTimestamp();
}

function formatDuration(seconds) {
  if (seconds < 60) return `${Math.floor(seconds)}초`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.floor(seconds % 60);
  if (minutes < 60) return restSeconds > 0 ? `${minutes}분 ${restSeconds}초` : `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours}시간 ${restMinutes}분` : `${hours}시간`;
}

function makeDailyInsight(goodRatio, buckets) {
  const total = buckets.good + buckets.warn + buckets.bad;
  if (total < 15) return "측정 데이터가 조금 더 쌓이면 오늘의 자세 패턴을 요약해드립니다.";
  if (goodRatio >= 75) return "좋은 자세 비율이 높습니다. 지금처럼 화면 거리와 어깨 이완 상태를 유지해보세요.";
  if (buckets.bad > buckets.warn && buckets.bad > buckets.good * 0.25) return "무너진 자세 시간이 늘고 있습니다. 모니터 높이와 의자 등받이 위치를 먼저 점검해보세요.";
  if (buckets.warn > buckets.good) return "주의 자세가 길게 유지되고 있습니다. 알림이 오기 전 턱을 살짝 당기는 습관을 만들어보세요.";
  return "전반적으로 괜찮지만 중간중간 자세가 흐트러집니다. 50분 작업 후 1분 목 스트레칭을 추천합니다.";
}

function drawPoseGuide(landmarks) {
  const { width, height } = els.preview;
  const ctx = previewContext;
  const radius = Math.max(2, width * 0.003);
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.fillStyle = "#fff";
  ctx.lineWidth = radius * 0.7;
  ctx.beginPath();
  for (const [from, to] of GUIDE_CONNECTIONS) {
    const start = landmarks[from];
    const end = landmarks[to];
    if (!isLandmarkUsable(start) || !isLandmarkUsable(end)) continue;
    ctx.moveTo(start.x * width, start.y * height);
    ctx.lineTo(end.x * width, end.y * height);
  }
  ctx.stroke();
  for (const index of GUIDE_POINTS) {
    const point = landmarks[index];
    if (!isLandmarkUsable(point)) continue;
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, radius, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

function schedulePrediction() {
  cancelNextPrediction?.();
  cancelNextPrediction = undefined;
  if (!webcamRunning) return;

  const miniDisplay = miniWindow.frameWindow();
  const displayWindow = miniDisplay && !miniDisplay.closed ? miniDisplay : window;
  if (displayWindow.document.hidden && miniWindow.isOpen()) {
    const id = window.setTimeout(predictWebcam, 125);
    cancelNextPrediction = () => window.clearTimeout(id);
  } else {
    const id = displayWindow.requestAnimationFrame(predictWebcam);
    cancelNextPrediction = () => {
      if (!displayWindow.closed) displayWindow.cancelAnimationFrame(id);
    };
  }
}

function predictWebcam() {
  cancelNextPrediction = undefined;
  if (!webcamRunning) return;
  const video = els.webcam;

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      // Infer and draw from the same unmirrored pixels before CSS positions the preview.
      const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.round(video.videoWidth * scale);
      const height = Math.round(video.videoHeight * scale);
      if (cameraFrame.width !== width || cameraFrame.height !== height) {
        cameraFrame.width = width;
        cameraFrame.height = height;
      }
      cameraFrameContext.drawImage(video, 0, 0, width, height);
      poseLandmarker.detectForVideo(cameraFrame, performance.now(), processPose);
      miniWindow.refreshPreview();
    } catch (error) {
      console.error("자세 감지 실패", error);
      stopCamera();
      poseLandmarker.close();
      poseLandmarker = undefined;
      setStatus("bad", "실행 오류");
      els.feedback.textContent = "자세 감지에 문제가 생겼어요. 카메라를 다시 시작해 주세요.";
      return;
    }
  }

  schedulePrediction();
}

function processPose(result) {
  const landmarks = result.landmarks?.[0];
  const hasPreview = cameraBackground.render(cameraFrame, landmarks ? result.segmentationMasks?.[0] : undefined);
  const quality = landmarks ? getLandmarkQuality(landmarks) :
    { level: "bad", message: "인식 불가", usable: false };
  updateRecognitionQuality(quality);
  if (!quality.usable) {
    els.score.textContent = "--";
    els.meterFill.style.width = "0%";
    badStartedAt = null;
    lastTickAt = Date.now();
    setStatus("idle", "인식 대기 중");
    els.feedback.textContent = "얼굴과 양쪽 어깨가 카메라에 잘 보이도록 위치를 조정하세요.";
    return;
  }

  if (hasPreview) drawPoseGuide(landmarks);
  const metrics = getMetrics(landmarks);
  if (!metrics) return;

  if (isCalibrating) {
    calibrationFrames.push(metrics);
    els.feedback.textContent = `기준 자세 저장 중... ${Math.min(100, Math.round(calibrationFrames.length / 45 * 100))}%`;
  } else if (baseline) {
    const score = calculateScore(metrics);
    updateUI(score, metrics);
    handleAlert(score);
    updateStats(score);
  } else {
    setStatus("idle", "기준 자세 필요");
  }
}

async function calibrate() {
  startCalibration({ auto: false });
}

function startAutoCalibration() {
  if (!webcamRunning || isCalibrating) return;
  startCalibration({ auto: true });
}

function startCalibration({ auto = false } = {}) {
  if (!webcamRunning) return;
  window.clearTimeout(autoCalibrationStart);
  if (countdownTimer) window.clearInterval(countdownTimer);
  if (autoCalibrationTimer) window.clearTimeout(autoCalibrationTimer);

  isCalibrating = true;
  calibrationFrames = [];
  els.calibrateBtn.disabled = true;
  els.calibrateBtn.textContent = auto ? "자동 설정 중..." : "기준 저장 중...";

  if (auto) {
    showAutoCalibrationOverlay();
    els.feedback.textContent = "자세를 바로잡아 주세요. 3초 후 기준자세가 자동으로 설정됩니다.";
  } else {
    hideAutoCalibrationOverlay();
    els.feedback.textContent = "정면을 바라보고, 얼굴과 양쪽 어깨가 화면 안에 들어오도록 앉아주세요.";
  }

  autoCalibrationTimer = window.setTimeout(() => finishCalibration({ auto }), 3200);
}

function showAutoCalibrationOverlay() {
  let count = 3;
  if (!els.autoCalibrateOverlay) return;
  els.autoCalibrateMessage.textContent = "자세를 바로잡아 주세요";
  els.autoCalibrateCount.textContent = String(count);
  els.autoCalibrateOverlay.classList.remove("hidden");
  countdownTimer = window.setInterval(() => {
    count -= 1;
    if (count > 0) {
      els.autoCalibrateCount.textContent = String(count);
    } else {
      els.autoCalibrateCount.textContent = "✓";
      window.clearInterval(countdownTimer);
    }
  }, 1000);
}

function hideAutoCalibrationOverlay() {
  if (countdownTimer) window.clearInterval(countdownTimer);
  if (els.autoCalibrateOverlay) els.autoCalibrateOverlay.classList.add("hidden");
}

function finishCalibration({ auto = false } = {}) {
  hideAutoCalibrationOverlay();

  if (calibrationFrames.length < 24) {
    els.feedback.textContent = auto
      ? "자동 기준자세 설정 실패: 얼굴·입·양쪽 어깨가 충분히 인식되지 않았습니다. 화면 중앙에 앉은 뒤 ‘기준 자세 다시 설정’을 눌러주세요."
      : "기준 자세 설정 실패: 얼굴·입·양쪽 어깨가 안정적으로 인식되지 않았습니다. 조명과 카메라 위치를 조정한 뒤 다시 시도하세요.";
    els.calibrateBtn.disabled = false;
    els.calibrateBtn.textContent = "기준 자세 다시 설정";
    isCalibrating = false;
    showToast("기준 자세 설정 필요", "얼굴과 양쪽 어깨가 잘 보이는 상태에서 다시 설정해 주세요.");
    return;
  }

  baseline = averageMetrics(calibrationFrames);
  try {
    localStorage.setItem("turtleneckAIBaseline", JSON.stringify(baseline));
    localStorage.removeItem("deskfitBaseline");
  } catch {
    // The newly measured baseline can still be used in this session.
  }
  isCalibrating = false;
  els.calibrateBtn.disabled = false;
  els.calibrateBtn.textContent = "기준 자세 다시 설정";
  els.feedback.textContent = "기준자세가 설정되었습니다. 이제 평소처럼 사용하세요.";
  showToast("기준 자세 설정 완료", auto ? "3초 카운트다운 기준으로 자동 설정했습니다." : "얼굴과 양쪽 어깨가 안정적으로 인식된 상태를 기준으로 저장했습니다.");
}


function getSessionElapsedMs(now = Date.now()) {
  return sessionElapsedMs + (sessionStartAt ? now - sessionStartAt : 0);
}

function getReportData() {
  const now = new Date();
  const totalSeconds = postureSeconds.good + postureSeconds.warn + postureSeconds.bad;
  const goodRatio = totalSeconds > 0 ? Math.round((postureSeconds.good / totalSeconds) * 100) : 0;
  return {
    app: "turtleneckAI",
    generatedAt: now.toISOString(),
    generatedAtKorean: formatKoreanDateTime(now),
    totalSeconds: Math.round(totalSeconds),
    sessionSeconds: Math.round(getSessionElapsedMs() / 1000),
    goodSeconds: Math.round(postureSeconds.good),
    warnSeconds: Math.round(postureSeconds.warn),
    badSeconds: Math.round(postureSeconds.bad),
    goodRatio,
    alertCount: badCount,
    insight: makeDailyInsight(goodRatio, postureSeconds)
  };
}

function formatKoreanDateTime(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

function updateReportTimestamp() {
  if (!els.reportTimestamp) return;
  els.reportTimestamp.textContent = `리포트 기준 · ${formatKoreanDateTime(new Date())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function saveReportImage() {
  const report = getReportData();
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 1200, 900);
  gradient.addColorStop(0, "#f8fbff");
  gradient.addColorStop(1, "#eef2ff");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#111827";
  ctx.font = "700 54px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText("turtleneck AI", 80, 100);
  ctx.font = "600 30px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText("오늘의 자세 리포트", 80, 158);
  ctx.fillStyle = "#6b7280";
  ctx.font = "24px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText(report.generatedAtKorean, 80, 204);
  ctx.fillText("좋은 자세를 위한 AI 습관 코치", 80, 246);

  const cards = [
    ["좋은 자세", formatDuration(report.goodSeconds), "#16a34a"],
    ["주의 자세", formatDuration(report.warnSeconds), "#f59e0b"],
    ["무너진 자세", formatDuration(report.badSeconds), "#ef4444"],
    ["좋은 자세 비율", `${report.goodRatio}%`, "#2563eb"],
    ["알림 횟수", `${report.alertCount}회`, "#111827"],
    ["총 측정 시간", formatDuration(report.totalSeconds), "#111827"]
  ];

  cards.forEach(([label, value, color], index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 80 + col * 350;
    const y = 320 + row * 180;
    roundRect(ctx, x, y, 300, 130, 30, "#ffffff");
    ctx.fillStyle = color;
    ctx.font = "700 36px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText(value, x + 28, y + 58);
    ctx.fillStyle = "#6b7280";
    ctx.font = "22px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText(label, x + 28, y + 98);
  });

  roundRect(ctx, 80, 710, 1040, 96, 26, "rgba(255,255,255,0.8)");
  ctx.fillStyle = "#374151";
  ctx.font = "24px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  wrapText(ctx, report.insight, 110, 758, 980, 34);

  canvas.toBlob(blob => {
    if (blob) downloadBlob(blob, `turtleneckAI-report-${new Date().toISOString().slice(0, 10)}.png`);
  });
}

function roundRect(ctx, x, y, width, height, radius, fillStyle) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line + word + " ";
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word + " ";
      y += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
}


function restoreBaseline() {
  try {
    const saved = localStorage.getItem("turtleneckAIBaseline") || localStorage.getItem("deskfitBaseline");
    if (saved) {
      baseline = JSON.parse(saved);
      els.calibrateBtn.textContent = "기준 자세 다시 설정";
    }
  } catch {
    // The next calibration will set a baseline.
  }
}

async function requestDesktopNotificationPermission() {
  if (!("Notification" in window)) {
    showToast("데스크톱 알림 미지원", "현재 브라우저는 OS 알림을 지원하지 않습니다.");
    updateNotificationStatus();
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      showToast("컴퓨터 알림이 켜졌어요", "컴퓨터 알림을 선택한 항목을 알려드립니다.");
    } else if (permission === "denied") {
      showToast("컴퓨터 알림이 차단됨", "브라우저 사이트 설정에서 알림 권한을 다시 허용해야 합니다.");
    }
  } catch {
    showToast("컴퓨터 알림을 켜지 못했어요", "브라우저 사이트 설정에서 알림 권한을 확인해 주세요.");
  } finally {
    updateNotificationStatus();
    focusTimer.updateDesktopStatus();
  }
}

function updateNotificationStatus() {
  if (!("Notification" in window)) {
    els.notificationStatus.textContent = "컴퓨터 알림 권한: 미지원";
    els.requestNotifyBtn.disabled = true;
    return;
  }

  const map = {
    granted: "허용됨",
    denied: "차단됨",
    default: "허용 필요"
  };
  els.notificationStatus.textContent = `컴퓨터 알림 권한: ${map[Notification.permission] || "확인 전"}`;
  els.requestNotifyBtn.disabled = Notification.permission === "granted";
}

function persistSettings() {
  try {
    localStorage.setItem("turtleneckAISettings", JSON.stringify({
      sensitivity: els.sensitivity.value,
      alertDelay: els.alertDelay.value,
      alertMode: els.alertMode.value,
      soundToggle: els.soundToggle.checked
    }));
  } catch {
    // Settings remain usable for the current session.
  }
}

function restoreSettings() {
  try {
    const saved = localStorage.getItem("turtleneckAISettings");
    if (!saved) return;
    const settings = JSON.parse(saved);
    if (settings.sensitivity) els.sensitivity.value = settings.sensitivity;
    if (settings.alertDelay) els.alertDelay.value = settings.alertDelay;
    if (settings.alertMode) els.alertMode.value = settings.alertMode;
    if (typeof settings.soundToggle === "boolean") els.soundToggle.checked = settings.soundToggle;
  } catch (error) {
    console.warn("설정 복원 실패", error);
  }
}

const cameraBackground = setupCameraBackground(els.preview, () => miniWindow.refreshPreview());
const cameraDevices = setupCameraDevices(els.cameraSelect, els.cameraDeviceStatus);
const miniWindow = setupMiniWindow({
  preview: els.preview,
  getCamera: () => ({
    active: webcamRunning,
    status: els.cameraStatusText.textContent,
    posture: baseline && !isCalibrating && els.score.textContent !== "--" &&
      ["good", "warn", "bad"].includes(els.statusPill.classList[1])
      ? classifyScore(Number(els.score.textContent)) : "idle"
  }),
  toggleTimer: () => focusTimer.toggle(),
  onWindowChange() {
    schedulePrediction();
    focusTimer.refresh();
  }
});
const focusTimer = setupFocusTimer({
  unlockAudio,
  playSound: () => softBeep(880),
  showToast,
  notifyDesktop,
  requestPermission: requestDesktopNotificationPermission,
  onRender: miniWindow.updateTimer,
  getDisplayWindow: miniWindow.frameWindow
});

els.startBtn.addEventListener("click", () => {
  if (webcamRunning) stopCamera();
  else enableCam();
});
els.cameraSelect.addEventListener("change", () => {
  if (!webcamRunning) return;
  stopCamera();
  enableCam();
});
els.calibrateBtn.addEventListener("click", calibrate);
els.requestNotifyBtn.addEventListener("click", requestDesktopNotificationPermission);
els.soundTestBtn?.addEventListener("click", testSound);
els.sensitivity.addEventListener("change", persistSettings);
els.alertDelay.addEventListener("change", persistSettings);
els.alertMode.addEventListener("change", () => {
  persistSettings();
  if ((els.alertMode.value === "desktop" || els.alertMode.value === "both") && "Notification" in window && Notification.permission === "default") {
    showToast("데스크톱 알림 권한 필요", "알림 설정의 권한 요청 버튼을 눌러주세요.");
  }
});
els.soundToggle.addEventListener("change", persistSettings);
els.saveReportBtn?.addEventListener("click", saveReportImage);
window.addEventListener("focus", updateNotificationStatus);
document.addEventListener("visibilitychange", schedulePrediction);

restoreSettings();
restoreBaseline();
updateNotificationStatus();
updateRecognitionQuality(currentRecognitionQuality);
updateReportTimestamp();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}
