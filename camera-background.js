const SCENES = {
  meeting: "./backgrounds/meeting-room.jpg",
  cafe: "./backgrounds/cafe.jpg"
};
const MODES = ["original", "blur", ...Object.keys(SCENES)];
const SETTINGS_KEY = "turtleneckAIBackground";
const MASK_SAMPLE_SIZE = 256;
const MASK_SMOOTHING_MS = 120;
const MASK_MAX_GAP_MS = 200;
const MASK_BLACK = [0, 0, 0, 255];
const MASK_WHITE = [255, 255, 255, 255];

export function setupCameraBackground(preview, onPreviewCleared) {
  const wrap = preview.parentElement;
  const status = document.querySelector("#backgroundStatus");
  const buttons = document.querySelectorAll("[data-background-option]");
  const context = preview.getContext("2d");
  const sceneCanvas = document.createElement("canvas");
  const sceneContext = sceneCanvas.getContext("2d");
  const blurCanvas = document.createElement("canvas");
  const blurContext = blurCanvas.getContext("2d");
  const scenes = new Map();
  let mode = "original";
  let active = false;
  let renderer;
  let blurMask;
  let blurSmoothingFailed = false;
  let modelGL;
  let renderedScene;
  let effectFailed = false;

  function setStatus(message = "") {
    if (status.textContent === message) return;
    status.textContent = message;
    status.hidden = !message;
  }

  function select(next) {
    mode = next;
    effectFailed = false;
    blurSmoothingFailed = false;
    blurMask?.reset();
    wrap.dataset.background = mode;
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.backgroundOption === mode));
    }

    if (SCENES[mode] && !scenes.has(mode)) {
      const image = new Image();
      scenes.set(mode, image);
      image.addEventListener("error", () => {
        scenes.delete(next);
        if (mode === next && active) {
          setStatus("배경 이미지를 불러오지 못했어요. 배경을 다시 선택해 주세요.");
        }
      }, { once: true });
      image.src = SCENES[mode];
    }
    context?.clearRect(0, 0, preview.width, preview.height);
    setStatus();
    if (active) onPreviewCleared();
  }

  function render(frame, mask) {
    if (!active || !context) return false;
    const { width, height } = frame;
    if (preview.width !== width || preview.height !== height) {
      preview.width = width;
      preview.height = height;
    }

    context.clearRect(0, 0, width, height);
    if (mode === "original") {
      context.drawImage(frame, 0, 0);
      return true;
    }
    if (!sceneContext || !blurContext || effectFailed) {
      setStatus("배경 효과를 표시할 수 없어 미리보기를 가렸어요.");
      return false;
    }
    try {
      let backdrop;
      if (mode === "blur") {
        // Downsample before enlarging so the effect also works without Canvas filters.
        const scale = 24 / Math.max(width, height);
        const blurWidth = Math.max(1, Math.round(width * scale));
        const blurHeight = Math.max(1, Math.round(height * scale));
        if (blurCanvas.width !== blurWidth || blurCanvas.height !== blurHeight) {
          blurCanvas.width = blurWidth;
          blurCanvas.height = blurHeight;
        }
        blurContext.drawImage(frame, 0, 0, blurWidth, blurHeight);
        backdrop = blurCanvas;
        setStatus();
      } else {
        const scene = scenes.get(mode);
        if (scene?.naturalWidth) {
          if (renderedScene !== scene || sceneCanvas.width !== width || sceneCanvas.height !== height) {
            sceneCanvas.width = width;
            sceneCanvas.height = height;
            drawCover(sceneContext, scene, width, height);
            renderedScene = scene;
          }
          backdrop = sceneCanvas;
          setStatus();
        } else {
          setStatus(scene ? "배경 이미지를 불러오는 중이에요." : "배경 이미지를 불러오지 못했어요. 배경을 다시 선택해 주세요.");
        }
      }

      if (backdrop) {
        if (mask && renderer) {
          // Sample the mask in the model's WebGL context without a float texture readback.
          if (modelGL) {
            modelGL.bindFramebuffer(modelGL.FRAMEBUFFER, null);
            modelGL.viewport(0, 0, modelGL.drawingBufferWidth, modelGL.drawingBufferHeight);
          }
          if (blurMask && !blurSmoothingFailed) {
            let matte;
            try {
              matte = blurMask.update(mask, width, height, performance.now());
            } catch (error) {
              console.warn("배경 윤곽 보정 실패", error);
              blurSmoothingFailed = true;
              blurMask.reset();
            }
            if (matte) {
              drawMaskedFrame(context, frame, backdrop, matte);
              return true;
            }
          }
        } else {
          blurMask?.reset();
        }

        context.imageSmoothingQuality = "high";
        context.drawImage(backdrop, 0, 0, width, height);
        if (mask && renderer) {
          renderer.drawConfidenceMask(mask, backdrop, frame);
          return true;
        }
      }
    } catch (error) {
      console.warn("배경 합성 실패", error);
      effectFailed = true;
      context.clearRect(0, 0, width, height);
      setStatus("배경 효과를 표시할 수 없어 미리보기를 가렸어요.");
    }
    return false;
  }

  for (const button of buttons) {
    button.addEventListener("click", () => {
      select(button.dataset.backgroundOption);
      try {
        localStorage.setItem(SETTINGS_KEY, mode);
      } catch {
        // The current selection still applies without browser storage.
      }
    });
  }

  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (MODES.includes(saved)) select(saved);
  } catch {
    // Keep the default when browser storage is unavailable.
  }

  return {
    render,
    setRenderer(DrawingUtils, canvas) {
      if (!context) return;
      renderer?.close();
      blurMask?.close();
      modelGL = canvas.getContext("webgl2");
      renderer = new DrawingUtils(context, modelGL ?? undefined);
      blurMask = createBlurMask(DrawingUtils, modelGL);
      blurSmoothingFailed = false;
    },
    setActive(isActive) {
      active = isActive;
      effectFailed = false;
      blurSmoothingFailed = false;
      if (!active) {
        renderer?.close();
        blurMask?.close();
        // Resizing clears all temporary video pixels.
        for (const canvas of [preview, blurCanvas]) {
          canvas.width = canvas.height = 1;
        }
        setStatus();
      }
    }
  };
}

function createBlurMask(DrawingUtils, modelGL) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const drawing = new DrawingUtils(context, modelGL ?? undefined);
  let previous;
  let horizontal;
  let lastFrameTime;

  return {
    update(mask, frameWidth, frameHeight, now) {
      const scale = Math.min(1, MASK_SAMPLE_SIZE / Math.max(frameWidth, frameHeight));
      const width = Math.max(1, Math.round(frameWidth * scale));
      const height = Math.max(1, Math.round(frameHeight * scale));
      if (!previous || canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        previous = new Float32Array(width * height);
        horizontal = new Float32Array(width * height);
        lastFrameTime = undefined;
      }
      const elapsed = now - lastFrameTime;
      const weight = elapsed < MASK_MAX_GAP_MS ? 1 - Math.exp(-elapsed / MASK_SMOOTHING_MS) : 1;
      const fastWeight = 1 - (1 - weight) ** 3;

      context.clearRect(0, 0, width, height);
      drawing.drawConfidenceMask(mask, MASK_BLACK, MASK_WHITE);
      const image = context.getImageData(0, 0, width, height);
      const pixels = image.data;
      for (let i = 0, pixel = 0; i < previous.length; i += 1, pixel += 4) {
        const current = pixels[pixel];
        const difference = current - previous[i];
        // Early changes near the edge get averaged; large changes follow motion faster.
        const motion = Math.max(0, Math.min(1, (Math.abs(difference) - 64) / 128));
        const smoothed = previous[i] + difference * (weight + motion * (fastWeight - weight));
        previous[i] = smoothed;
        // Fade uncertain edges and clear areas the current frame identifies as background.
        pixels[pixel + 3] = (Math.min(smoothed, current * 1.6) - 24) * (255 / 200);
      }
      // Separable 3-tap feathering works in Safari without Canvas filter support.
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          horizontal[i] = (pixels[(y * width + Math.max(0, x - 1)) * 4 + 3] +
            2 * pixels[i * 4 + 3] + pixels[(y * width + Math.min(width - 1, x + 1)) * 4 + 3]) / 4;
        }
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          pixels[(y * width + x) * 4 + 3] = (horizontal[Math.max(0, y - 1) * width + x] +
            2 * horizontal[y * width + x] + horizontal[Math.min(height - 1, y + 1) * width + x]) / 4;
        }
      }
      context.putImageData(image, 0, 0);
      lastFrameTime = now;
      return canvas;
    },
    reset() {
      lastFrameTime = undefined;
    },
    close() {
      drawing.close();
      canvas.width = canvas.height = 1;
      previous = undefined;
      horizontal = undefined;
      lastFrameTime = undefined;
    }
  };
}

function drawMaskedFrame(context, frame, backdrop, matte) {
  const { width, height } = frame;
  context.save();
  try {
    context.imageSmoothingQuality = "high";
    context.drawImage(frame, 0, 0);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(matte, 0, 0, width, height);
    context.globalCompositeOperation = "destination-over";
    context.drawImage(backdrop, 0, 0, width, height);
  } finally {
    context.restore();
  }
}

function drawCover(context, image, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const imageWidth = image.naturalWidth * scale;
  const imageHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight);
}
