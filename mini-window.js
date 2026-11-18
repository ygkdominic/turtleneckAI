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
  let size = { width: WIDTH, height: HEIGHT };

  pin.disabled = !canPin;
  try {
    pin.checked = canPin && localStorage.getItem(PIN_SETTING) === "true";
  } catch {
    // Window controls still work without saved preferences.
  }

  function message(text = "") {
    status.textContent = text;
    status.hidden = !text;
  }

  function syncControls() {
    button.textContent = view ? "미니 창 닫기" : "미니 창 열기";
    button.disabled = opening;
    pin.disabled = opening || !canPin;
  }

  function replaceView(next, closePrevious = true) {
    const previous = view;
    view = next;
    if (previous && closePrevious) previous.close();
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
    view?.renderCamera(getCamera());
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
      doc.title = "turtleneckAI 미니 창";
      doc.documentElement.lang = "ko";
      const stylesheet = doc.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = new URL("./mini-window.css?v=0.7.0", location.href);
      doc.head.append(stylesheet);
      doc.body.append(doc.importNode(template.content, true));

      const canvas = doc.querySelector("canvas");
      const context = canvas.getContext("2d");
      const off = doc.querySelector(".mini-camera-off");
      const posture = doc.querySelector(".mini-posture");
      const time = doc.querySelector(".mini-time");
      const state = doc.querySelector(".mini-timer-state");
      const action = doc.querySelector(".mini-timer-action");
      action.addEventListener("click", toggleTimer);

      const opened = {
        pinned,
        window: target,
        close: () => target.close(),
        updateTimer(next) {
          time.textContent = next.time;
          state.textContent = next.label;
          state.dataset.state = next.state;
          action.textContent = next.action;
          action.disabled = !next.canStart;
        },
        renderCamera(camera) {
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
      doc.addEventListener("visibilitychange", onWindowChange);
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

  async function openVideoPip() {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 358;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(12);
    const video = document.createElement("video");
    video.className = "video-source";
    video.muted = true;
    video.playsInline = true;
    video.disableRemotePlayback = true;
    video.setAttribute("aria-hidden", "true");
    document.body.append(video);
    video.srcObject = stream;

    function render() {
      drawVideoMiniWindow(context, preview, getCamera(), timer);
    }

    const opened = {
      pinned: true,
      close() {
        if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
        else if (video.webkitPresentationMode === PIP) video.webkitSetPresentationMode("inline");
        for (const track of stream.getTracks()) track.stop();
        video.srcObject = null;
        video.remove();
      },
      renderCamera: render,
      updateTimer: render
    };

    try {
      const playing = video.play();
      render();
      await withTimeout(playing);
      if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        await withTimeout(video.requestPictureInPicture());
        video.addEventListener("leavepictureinpicture", () => {
          if (view === opened) replaceView(undefined);
        }, { once: true });
      } else if (video.webkitSupportsPresentationMode?.(PIP)) {
        await withTimeout(new Promise(resolve => {
          video.addEventListener("webkitpresentationmodechanged", () => {
            if (video.webkitPresentationMode === PIP) resolve();
            else if (view === opened) replaceView(undefined);
          });
          video.webkitSetPresentationMode(PIP);
        }));
      } else {
        throw new Error("Video PiP unavailable");
      }
      return opened;
    } catch {
      opened.close();
      throw new Error("이 브라우저에서 고정 창을 열지 못했어요. ‘항상 위’를 끄면 일반 창을 열 수 있어요.");
    }
  }

  async function openPreferred() {
    const pinned = pin.checked;
    opening = true;
    syncControls();
    message();
    try {
      const next = pinned && !documentPip?.requestWindow
        ? await openVideoPip()
        : await openWindow(pinned);
      replaceView(next);
      if (timer) next.updateTimer(timer);
      refreshPreview();
    } catch (error) {
      if (view) pin.checked = view.pinned;
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
    if (view) replaceView(undefined);
    else openPreferred();
  });
  pin.addEventListener("change", async () => {
    if (view) await openPreferred();
    try {
      localStorage.setItem(PIN_SETTING, String(pin.checked));
    } catch {
      // Retain the current choice until the page closes.
    }
  });
  window.addEventListener("pagehide", () => {
    if (view) replaceView(undefined);
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

  context.fillStyle = "#f8fafc";
  context.fillRect(0, videoHeight, width, height - videoHeight);
  context.fillStyle = timer?.state === "complete" ? "#166534" : "#475569";
  context.fillText(timer?.label ?? "시작 대기", width / 2, videoHeight + 24);
  context.fillStyle = "#111827";
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
