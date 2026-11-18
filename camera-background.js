const SCENES = {
  meeting: "./backgrounds/meeting-room.jpg",
  cafe: "./backgrounds/cafe.jpg"
};
const MODES = ["original", "blur", ...Object.keys(SCENES)];
const SETTINGS_KEY = "turtleneckAIBackground";

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
        context.imageSmoothingQuality = "high";
        context.drawImage(backdrop, 0, 0, width, height);
        if (mask && renderer) {
          // Sample the mask in the model's WebGL context without reading it into JavaScript.
          if (modelGL) {
            modelGL.bindFramebuffer(modelGL.FRAMEBUFFER, null);
            modelGL.viewport(0, 0, modelGL.drawingBufferWidth, modelGL.drawingBufferHeight);
          }
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
      modelGL = canvas.getContext("webgl2");
      renderer = new DrawingUtils(context, modelGL ?? undefined);
    },
    setActive(isActive) {
      active = isActive;
      effectFailed = false;
      if (!active) {
        renderer?.close();
        // Resizing clears all temporary video pixels.
        for (const canvas of [preview, blurCanvas]) {
          canvas.width = canvas.height = 1;
        }
        setStatus();
      }
    }
  };
}

function drawCover(context, image, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const imageWidth = image.naturalWidth * scale;
  const imageHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight);
}
