const PIN_SETTING = "turtleneckAIMiniWindowPinned";
const WIDTH = 300;
const HEIGHT = 238;
const PIP = "picture-in-picture";

export function setupMiniWindow({ preview, getCamera, toggleTimer, onWindowChange }) {
  const button = document.querySelector("#miniWindowBtn");
  const pin = document.querySelector("#miniWindowPinned");
  const status = document.querySelector("#miniWindowStatus");
  const template = document.querySelector("#miniWindowTemplate");
  const documentPip = window.documentPictureInPicture;
  const videoPip = window.HTMLCanvasElement.prototype.captureStream &&
    (document.pictureInPictureEnabled || typeof window.HTMLVideoElement.prototype.webkitSetPresentationMode === "function");
  const canPin = Boolean(documentPip?.requestWindow || videoPip);
  let view;
  let timer;
  let opening = false;
  let pendingPin = false;
  let preparedVideo;
  const colorAnimator = createPostureAnimator();
  let size = { width: WIDTH, height: HEIGHT };

  pin.disabled = !canPin;
  try {
    // HTML PiP preferences cannot be carried across to Safari's video-only mode.
    pin.checked = Boolean(documentPip?.requestWindow) && localStorage.getItem(PIN_SETTING) === "true";
  } catch {
    // Window controls still work without saved preferences.
  }

  function message(text = "") {
    status.textContent = text;
    status.hidden = !text;
    view?.showMessage?.(text);
  }

  function syncControls() {
    button.textContent = pendingPin ? "항상 위로 전환" : view ? "미니 창 닫기" : "미니 창 열기";
    button.disabled = opening;
    pin.disabled = opening || !canPin;
    view?.syncPin?.(pin.checked, opening || !canPin);
  }

  function replaceView(next, closePrevious = true) {
    const previous = view;
    view = next;
    if (previous && closePrevious) previous.close();
    if (!next && preparedVideo) preparedVideo.close();
    syncControls();
    onWindowChange();
  }

  function reportClosed(target) {
    if (view !== target) return;
    replaceView(undefined, false);
    message(canPin ? "" : "이 브라우저에서는 일반 미니 창을 사용할 수 있어요.");
  }

  function updateTimer(next) {
    timer = next;
    view?.updateTimer(next);
  }

  function refreshPreview() {
    const camera = getCamera();
    camera.palette = colorAnimator.update(camera);
    view?.renderCamera(camera);
    preparedVideo?.renderCamera(camera);
  }

  function openPopup() {
    const left = (screen.availLeft ?? 0) + Math.max(0, screen.availWidth - size.width - 24);
    const top = (screen.availTop ?? 0) + Math.max(0, screen.availHeight - size.height - 72);
    const popup = window.open("", "_blank", `popup,width=${size.width},height=${size.height},left=${left},top=${top}`);
    if (!popup) throw new Error("팝업을 허용한 뒤 미니 창을 다시 열어 주세요.");
    return popup;
  }

  async function openWindow(pinned) {
    const target = pinned
      ? await documentPip.requestWindow({ ...size, preferInitialWindowPlacement: true })
      : openPopup();
    try {
      const doc = target.document;
      doc.title = "turtleneck AI 미니 창";
      doc.documentElement.lang = "ko";
      const stylesheet = doc.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = new URL("./mini-window.css?v=0.7.8", location.href);
      doc.head.append(stylesheet);
      doc.body.append(doc.importNode(template.content, true));

      const canvas = doc.querySelector("canvas");
      const context = canvas.getContext("2d");
      const off = doc.querySelector(".mini-camera-off");
      const posture = doc.querySelector(".mini-posture");
      const time = doc.querySelector(".mini-time");
      const state = doc.querySelector(".mini-timer-state");
      const action = doc.querySelector(".mini-timer-action");
      const popupPin = doc.querySelector(".mini-pin-input");
      const footer = doc.querySelector(".mini-timer");
      const popupMessage = doc.querySelector(".mini-message");
      popupPin.checked = pinned;
      popupPin.disabled = !canPin;
      popupPin.title = canPin ? "다른 창 위에 고정" : "이 브라우저는 항상 위를 지원하지 않습니다.";
      popupPin.addEventListener("change", () => changePinned(popupPin.checked, true));
      action.addEventListener("click", toggleTimer);

      const opened = {
        pinned,
        window: target,
        close: () => target.close(),
        syncPin(checked, disabled) {
          popupPin.checked = checked;
          popupPin.disabled = disabled;
        },
        showMessage(text) {
          popupMessage.textContent = text;
          popupMessage.hidden = !text;
        },
        updateTimer(next) {
          time.textContent = next.time;
          state.textContent = next.label;
          state.dataset.state = next.state;
          action.textContent = next.action;
          action.disabled = !next.canStart;
        },
        renderCamera(camera) {
          const palette = camera.palette ?? posturePalette(camera);
          // Apply the complete gradient too: an older cached stylesheet must not hide it.
          footer.style.background = `linear-gradient(120deg, ${palette.start}, ${palette.end})`;
          footer.style.color = palette.ink;
          footer.style.setProperty("--posture-start", palette.start);
          footer.style.setProperty("--posture-end", palette.end);
          footer.style.setProperty("--posture-ink", palette.ink);
          off.hidden = camera.active;
          canvas.hidden = !camera.active;
          posture.hidden = !camera.active;
          posture.textContent = camera.status;
          if (camera.active) {
            if (canvas.width !== preview.width || canvas.height !== preview.height) {
              canvas.width = preview.width;
              canvas.height = preview.height;
            }
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(preview, 0, 0);
          } else if (canvas.width !== 1 || canvas.height !== 1) {
            canvas.width = canvas.height = 1;
          }
        }
      };
      target.addEventListener("pagehide", () => reportClosed(opened), { once: true });
      const visibilityChanged = () => { onWindowChange(); refreshPreview(); };
      doc.addEventListener("visibilitychange", visibilityChanged);
      target.addEventListener("pagehide", () => doc.removeEventListener("visibilitychange", visibilityChanged), { once: true });
      target.addEventListener("resize", () => {
        if (target.innerWidth && target.innerHeight) {
          size = {
            width: Math.min(600, Math.max(230, target.innerWidth)),
            height: Math.min(480, Math.max(175, target.innerHeight))
          };
        }
      });
      return opened;
    } catch (error) {
      target.close();
      throw error;
    }
  }

  function prepareVideoPip() {
    if (preparedVideo) return preparedVideo;

    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 358;
    const context = canvas.getContext("2d");
    // Keep stream dimensions fixed; Safari PiP is sensitive to source resizing.
    const stream = canvas.captureStream(15);
    const video = document.createElement("video");
    video.className = "video-source";
    // Keep the Safari media element renderable rather than fully transparent.
    video.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.autoplay = true;
    video.width = 480;
    video.height = 358;
    video.disableRemotePlayback = true;
    video.setAttribute("aria-hidden", "true");
    document.body.append(video);
    video.srcObject = stream;

    function render(camera = getCamera()) {
      drawVideoMiniWindow(context, preview, camera, timer);
      stream.getVideoTracks()[0]?.requestFrame?.();
    }

    const opened = {
      pinned: true,
      video,
      ready: false,
      close() {
        if (preparedVideo === opened) preparedVideo = undefined;
        if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
        else if (video.webkitPresentationMode === PIP) video.webkitSetPresentationMode("inline");
        for (const track of stream.getTracks()) track.stop();
        video.srcObject = null;
        video.remove();
      },
      renderCamera: render,
      updateTimer: () => render()
    };

    preparedVideo = opened;
    render();
    video.addEventListener("loadeddata", () => { opened.ready = true; }, { once: true });
    video.play().then(() => { opened.ready = video.readyState >= 2; }).catch(() => {});
    return opened;
  }

  async function openVideoPip() {
    const opened = prepareVideoPip();
    const { video } = opened;
    if (!opened.ready && video.readyState < 2) {
      const error = new Error("고정 영상을 준비하고 있어요. 본 화면의 ‘항상 위로 전환’을 한 번 더 눌러 주세요.");
      error.name = "PinGestureRequired";
      throw error;
    }
    try {
      // Request PiP directly in the click handler, before awaiting playback.
      if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        const request = video.requestPictureInPicture();
        await withTimeout(request);
        video.addEventListener("leavepictureinpicture", () => {
          if (view === opened) replaceView(undefined);
        }, { once: true });
      } else if (video.webkitSupportsPresentationMode?.(PIP)) {
        const entered = new Promise(resolve => {
          function changed() {
            if (video.webkitPresentationMode === PIP) resolve();
            else if (view === opened) replaceView(undefined);
          }
          video.addEventListener("webkitpresentationmodechanged", changed);
          video.webkitSetPresentationMode(PIP);
          if (video.webkitPresentationMode === PIP) resolve();
        });
        await withTimeout(entered);
      } else {
        throw new Error("이 브라우저에서는 영상 고정을 지원하지 않습니다. Chrome에서 항상 위를 사용해 주세요.");
      }
      preparedVideo = undefined;
      return opened;
    } catch (error) {
      opened.close();
      throw error;
    }
  }

  function requestMainWindowGesture(text) {
    pendingPin = true;
    pin.checked = view?.pinned ?? false;
    message(text || "브라우저가 본 화면의 직접 클릭을 요구합니다. 본 화면의 ‘항상 위로 전환’을 눌러 주세요.");
    syncControls();
    window.focus();
    button.focus();
  }

  async function openPreferred() {
    const pinned = pin.checked;
    pendingPin = false;
    opening = true;
    syncControls();
    message();
    try {
      const next = pinned && !documentPip?.requestWindow
        ? await openVideoPip()
        : await openWindow(pinned);
      replaceView(next);
      try { localStorage.setItem(PIN_SETTING, String(next.pinned)); } catch { /* Optional preference. */ }
      if (timer) next.updateTimer(timer);
      refreshPreview();
      if (!pinned && !documentPip?.requestWindow) {
        // An optional video fallback must never break the fully interactive popup.
        try { if (videoPip) prepareVideoPip(); } catch { /* Ordinary popup remains usable. */ }
        message("Safari 등 HTML 고정 창 미지원 브라우저에서는 일반 미니 창으로 실행합니다. 항상 위는 영상형 PiP이며, 타이머 조작은 본 화면에서 가능합니다.");
      }
      if (pinned && !documentPip?.requestWindow) {
        message("영상 고정 중입니다. 타이머 조작과 고정 해제는 본 화면에서 할 수 있어요.");
      }
    } catch (error) {
      pin.checked = view?.pinned ?? false;
      if (pinned && ["NotAllowedError", "PinGestureRequired"].includes(error.name)) {
        requestMainWindowGesture(error.name === "PinGestureRequired" ? error.message : undefined);
        return;
      }
      const hint = pinned
        ? "고정 창을 열지 못했어요. ‘항상 위’를 끄고 일반 창을 열 수 있어요."
        : "팝업을 허용한 뒤 미니 창을 다시 열어 주세요.";
      message(error.message?.startsWith("이 브라우저") ? error.message : hint);
    } finally {
      opening = false;
      syncControls();
    }
  }

  button.addEventListener("click", () => {
    if (pendingPin) {
      pin.checked = true;
      openPreferred();
    } else if (view) replaceView(undefined);
    else openPreferred();
  });
  async function changePinned(checked, fromPopup = false) {
    if (opening) return;
    pendingPin = false;
    if (checked && fromPopup && window.navigator.userActivation?.isActive !== true) {
      if (!documentPip?.requestWindow && videoPip) { try { prepareVideoPip(); } catch { /* Keep popup. */ } }
      requestMainWindowGesture();
      return;
    }
    pin.checked = checked;
    if (view) await openPreferred();
    try {
      localStorage.setItem(PIN_SETTING, String(pin.checked));
    } catch {
      // Retain the current choice until the page closes.
    }
  }
  pin.addEventListener("change", () => changePinned(pin.checked));
  window.addEventListener("pagehide", () => {
    if (view) replaceView(undefined);
    preparedVideo?.close();
  });
  if (!canPin) message("이 브라우저에서는 일반 미니 창을 사용할 수 있어요.");

  return {
    updateTimer,
    refreshPreview,
    isOpen: () => Boolean(view),
    frameWindow: () => view?.window
  };
}

function drawVideoMiniWindow(context, preview, camera, timer) {
  const { width, height } = context.canvas;
  const videoHeight = 270;
  context.fillStyle = "#0f172a";
  context.fillRect(0, 0, width, height);
  if (camera.active) {
    const scale = Math.max(width / preview.width, videoHeight / preview.height);
    const imageWidth = preview.width * scale;
    const imageHeight = preview.height * scale;
    context.save();
    context.beginPath();
    context.rect(0, 0, width, videoHeight);
    context.clip();
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(preview, (width - imageWidth) / 2, (videoHeight - imageHeight) / 2, imageWidth, imageHeight);
    context.restore();
  }

  context.textAlign = "center";
  context.fillStyle = "#e2e8f0";
  context.font = "600 20px -apple-system, sans-serif";
  if (!camera.active) context.fillText("카메라 꺼짐", width / 2, videoHeight / 2);
  if (camera.active) {
    context.fillStyle = "#0f172acc";
    context.fillRect(0, videoHeight - 37, width, 37);
    context.fillStyle = "#f8fafc";
    context.fillText(camera.status, width / 2, videoHeight - 12);
  }

  const palette = camera.palette ?? posturePalette(camera);
  const gradient = context.createLinearGradient(0, videoHeight, width, height);
  gradient.addColorStop(0, palette.start);
  gradient.addColorStop(1, palette.end);
  context.fillStyle = gradient;
  context.fillRect(0, videoHeight, width, height - videoHeight);
  context.fillStyle = palette.ink;
  context.fillText(timer?.label ?? "시작 대기", width / 2, videoHeight + 24);
  context.fillStyle = palette.ink;
  context.font = "700 44px -apple-system, sans-serif";
  context.fillText(timer?.time ?? "30:00", width / 2, height - 14);
}

function withTimeout(promise) {
  let timeout;
  const expiry = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("PiP timeout")), 2400);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timeout));
}

// Color follows the score continuously; thresholds match the selected sensitivity.
export function posturePalette(camera, smoothedScore = resolvedPostureScore(camera)) {
  if (!camera.active || resolvedPostureState(camera) === "idle" || !Number.isFinite(smoothedScore)) {
    return { start: "#f1f5f9", end: "#e2e8f0", ink: "#172033" };
  }
  const warn = camera.thresholds?.warnThreshold ?? 75;
  const bad = camera.thresholds?.badThreshold ?? 50;
  const stops = [
    [0, [153, 27, 27], [69, 10, 10]],
    [Math.max(0, bad - 15), [220, 38, 38], [127, 29, 29]],
    [bad, [251, 146, 60], [234, 88, 12]],
    [warn, [253, 224, 71], [250, 204, 21]],
    [100, [134, 239, 172], [34, 197, 94]]
  ];
  const score = Math.max(0, Math.min(100, smoothedScore));
  const upper = Math.max(1, stops.findIndex(stop => score <= stop[0]));
  const left = stops[upper - 1], right = stops[upper];
  const t = (score - left[0]) / (right[0] - left[0]);
  const mix = index => left[index].map((c, i) => Math.round(c + (right[index][i] - c) * t));
  const rgb = values => `rgb(${values.join(", ")})`;
  // Blend ink as well so the dark red remains readable without a sudden jump.
  const light = Math.max(0, Math.min(1, (score - (bad - 12)) / 10));
  const ink = [255, 255, 255].map((c, i) => Math.round(c + ([23, 32, 51][i] - c) * light));
  return { start: rgb(mix(1)), end: rgb(mix(2)), ink: rgb(ink) };
}

// Accept earlier camera payloads too, so mixed cached versions keep their colors.
function resolvedPostureState(camera) {
  if (["good", "warn", "bad", "idle"].includes(camera.posture)) return camera.posture;
  if (camera.status === "좋은 자세") return "good";
  if (camera.status === "주의 자세") return "warn";
  if (camera.status === "무너진 자세") return "bad";
  return "idle";
}
function resolvedPostureScore(camera) {
  if (typeof camera.score === "number" && Number.isFinite(camera.score)) return camera.score;
  return { good: 100, warn: 65, bad: 25 }[resolvedPostureState(camera)] ?? null;
}

function createPostureAnimator() {
  let score;
  let lastAt;
  return {
    update(camera) {
      const now = performance.now();
      const targetScore = resolvedPostureScore(camera);
      if (!camera.active || resolvedPostureState(camera) === "idle" || !Number.isFinite(targetScore)) {
        score = undefined;
        lastAt = now;
        return posturePalette(camera);
      }
      const elapsed = Math.max(0, Math.min(1000, now - (lastAt ?? now)));
      const alpha = 1 - Math.exp(-elapsed / 280);
      score = score === undefined ? targetScore : score + (targetScore - score) * alpha;
      lastAt = now;
      return posturePalette(camera, score);
    }
  };
}
