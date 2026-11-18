const SETTINGS_KEY = "turtleneckAIFocusSettings";
const COMPLETE_TITLE = "집중 시간이 끝났어요";
const COMPLETE_TIP = "어깨 힘을 풀고 자세를 다시 잡아보세요. 잠깐 일어나 움직여도 좋아요.";

export function setupFocusTimer({ unlockAudio, playSound, showToast, notifyDesktop, requestPermission, onRender, getDisplayWindow }) {
  const time = document.querySelector("#focusTime");
  const stateLabel = document.querySelector("#focusState");
  const progress = document.querySelector("#focusProgress");
  const durations = document.querySelector("#focusDurations");
  const presets = [...durations.querySelectorAll("[data-focus-minutes]")];
  const custom = document.querySelector("#focusCustom");
  const minutes = document.querySelector("#focusMinutes");
  const seconds = document.querySelector("#focusSeconds");
  const inputError = document.querySelector("#focusInputError");
  const sound = document.querySelector("#focusSound");
  const page = document.querySelector("#focusPage");
  const desktop = document.querySelector("#focusDesktop");
  const desktopHelp = document.querySelector("#focusDesktopHelp");
  const desktopStatus = document.querySelector("#focusDesktopStatus");
  const notifyButton = document.querySelector("#focusNotifyBtn");
  const start = document.querySelector("#focusStart");
  const reset = document.querySelector("#focusReset");
  const reminder = document.querySelector("#focusReminder");
  const pageTitle = document.title;

  let selection = "30";
  let state = "idle";
  let remainingMs = 0;
  let deadline = 0;
  let cancelTick;
  let alarmId;

  const labels = {
    idle: ["시작 대기", "집중 시작"],
    running: ["집중 중", "일시정지"],
    paused: ["일시정지", "계속하기"],
    complete: ["집중 완료", "다시 시작"]
  };

  function selectedSeconds() {
    if (selection !== "custom") return Number(selection) * 60;
    if (!minutes.validity.valid || !seconds.validity.valid) return 0;
    return Number(minutes.value) * 60 + Number(seconds.value);
  }

  function render() {
    const total = selectedSeconds();
    const locked = state === "running" || state === "paused";
    const remaining = state === "idle" ? total : Math.ceil(remainingMs / 1000);
    const formatted = total ? formatClock(remaining) : "--:--";
    const [status, action] = labels[state];

    time.textContent = formatted;
    stateLabel.textContent = status;
    stateLabel.dataset.state = state;
    progress.max = total || 1;
    progress.value = total - remaining;
    document.title = locked ? `${formatted} · ${pageTitle}` : pageTitle;
    durations.disabled = locked;
    start.textContent = action;
    start.disabled = !total;
    reset.disabled = state === "idle";
    onRender({ time: formatted, state, label: status, action, canStart: Boolean(total) });
  }

  function tick() {
    cancelTick?.();
    cancelTick = undefined;
    if (state !== "running") return;
    remainingMs = Math.max(0, deadline - Date.now());
    if (remainingMs > 0) {
      render();
      const display = getDisplayWindow();
      const host = display && !display.closed ? display : window;
      const id = host.setTimeout(tick, remainingMs % 1000 || 1000);
      cancelTick = () => {
        if (!host.closed) host.clearTimeout(id);
      };
      return;
    }

    clearTimeout(alarmId);
    state = "complete";
    render();
    reminder.textContent = COMPLETE_TIP;
    if (sound.checked) playSound();
    if (page.checked) showToast(COMPLETE_TITLE, COMPLETE_TIP, { priority: true });
    if (desktop.checked) {
      notifyDesktop(COMPLETE_TITLE, COMPLETE_TIP, "turtleneckai-focus-alert");
    }
  }

  function changeDuration() {
    custom.hidden = selection !== "custom";
    for (const preset of presets) {
      preset.setAttribute("aria-pressed", String(preset.dataset.focusMinutes === selection));
    }
    const invalid = !selectedSeconds();
    inputError.hidden = !invalid;
    inputError.textContent = invalid ? "1초부터 1,439분 59초까지 입력하세요." : "";
    for (const input of [minutes, seconds]) {
      input.setAttribute("aria-invalid", String(invalid));
    }
    resetTimer();
  }

  function resetTimer() {
    cancelTick?.();
    cancelTick = undefined;
    clearTimeout(alarmId);
    state = "idle";
    remainingMs = 0;
    reminder.textContent = "";
    render();
  }

  function updateDesktopStatus() {
    const permission = window.Notification?.permission;
    desktopHelp.hidden = !desktop.checked || permission === "granted";
    notifyButton.hidden = permission !== "default";
    const messages = {
      default: "컴퓨터 알림을 받으려면 권한을 허용하세요.",
      denied: "브라우저 사이트 설정에서 컴퓨터 알림을 허용하세요."
    };
    desktopStatus.textContent = desktopHelp.hidden ? "" :
      (messages[permission] || "이 브라우저에서는 컴퓨터 알림을 사용할 수 없어요.");
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        selection,
        minutes: minutes.value,
        seconds: seconds.value,
        sound: sound.checked,
        page: page.checked,
        desktop: desktop.checked
      }));
    } catch {
      // The timer still works when browser storage is unavailable.
    }
  }

  function restoreSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (!settings) return;
      if (presets.some(button => button.dataset.focusMinutes === settings.selection)) {
        selection = settings.selection;
      }
      if (typeof settings.minutes === "string") minutes.value = settings.minutes;
      if (typeof settings.seconds === "string") seconds.value = settings.seconds;
      for (const [key, input] of Object.entries({ sound, page, desktop })) {
        if (typeof settings[key] === "boolean") input.checked = settings[key];
      }
    } catch {
      // Keep the defaults if the saved preferences cannot be read.
    }
  }

  function toggle() {
    if (state === "running") {
      const timeLeft = deadline - Date.now();
      if (timeLeft <= 0) {
        tick();
        return;
      }
      remainingMs = timeLeft;
      cancelTick?.();
      cancelTick = undefined;
      clearTimeout(alarmId);
      state = "paused";
      render();
      return;
    }

    if (!selectedSeconds()) return;
    if (sound.checked) unlockAudio();
    if (state !== "paused") remainingMs = selectedSeconds() * 1000;
    state = "running";
    reminder.textContent = "";
    deadline = Date.now() + remainingMs;
    // An independent deadline avoids relying on repeated display updates in background tabs.
    alarmId = setTimeout(tick, remainingMs);
    tick();
  }

  start.addEventListener("click", toggle);
  reset.addEventListener("click", resetTimer);
  durations.addEventListener("click", event => {
    const button = event.target.closest("[data-focus-minutes]");
    if (!button || durations.disabled || selection === button.dataset.focusMinutes) return;
    selection = button.dataset.focusMinutes;
    changeDuration();
    saveSettings();
  });
  custom.addEventListener("input", () => {
    changeDuration();
    saveSettings();
  });
  for (const input of [sound, page, desktop]) {
    input.addEventListener("change", () => {
      if (input === sound && sound.checked) unlockAudio();
      if (input === desktop) updateDesktopStatus();
      saveSettings();
    });
  }
  notifyButton.addEventListener("click", async () => {
    await requestPermission();
    updateDesktopStatus();
  });
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pageshow", tick);
  window.addEventListener("focus", updateDesktopStatus);

  restoreSettings();
  changeDuration();
  updateDesktopStatus();
  return { updateDesktopStatus, toggle, refresh: tick };
}

function formatClock(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours ? `${hours}:${clock}` : clock;
}
