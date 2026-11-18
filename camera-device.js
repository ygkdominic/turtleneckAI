const BUILT_IN_LABEL = /facetime|built[\s-]*in|integrated|macbook.*camera|내장|통합 카메라/i;
const CONTINUITY_LABEL = /iphone|continuity|desk\s*view|연속성|데스크\s*뷰/i;

const VIDEO_OPTIONS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24 },
  facingMode: "user"
};

export function setupCameraDevices(select, activeLabel, media = navigator.mediaDevices) {
  async function refresh() {
    try {
      const devices = (await media?.enumerateDevices() ?? []).filter(device =>
        device.kind === "videoinput" && device.deviceId && device.deviceId !== "default" && device.label
      );
      // Browsers may hide labels when the camera is off, so retain the last visible list.
      if (devices.length) {
        const selected = select.value;
        select.replaceChildren(select.options[0], ...devices.map(device => new Option(device.label, device.deviceId)));
        if (devices.some(device => device.deviceId === selected)) select.value = selected;
      }
      return devices;
    } catch {
      return [];
    }
  }

  async function open() {
    const selected = select.value;
    const devices = await refresh();
    const builtIn = devices.find(device => isBuiltIn(device.label));
    const preferred = selected || builtIn?.deviceId;
    if (preferred) {
      const stream = await request(preferred, !selected || isBuiltIn(devices.find(device => device.deviceId === selected)?.label ?? ""));
      await refresh();
      return stream;
    }

    const stream = await request();
    const track = stream.getVideoTracks()[0];
    const known = await refresh();
    const internal = known.find(device => isBuiltIn(device.label));
    if (internal && !isBuiltIn(track.label) && track.getSettings().deviceId !== internal.deviceId) {
      stream.getTracks().forEach(item => item.stop());
      return request(internal.deviceId, true);
    }

    if (CONTINUITY_LABEL.test(track.label)) {
      stream.getTracks().forEach(item => item.stop());
      throw new DOMException("내장 카메라를 찾지 못했어요. ‘카메라 선택’에서 사용할 카메라를 지정해 주세요.", "CameraSelectionError");
    }
    return stream;
  }

  async function request(id, requireBuiltIn = false) {
    const video = id ? { ...VIDEO_OPTIONS, deviceId: { exact: id } } : VIDEO_OPTIONS;
    const stream = await media.getUserMedia({ video, audio: false });
    const track = stream.getVideoTracks()[0];
    const actual = track.getSettings().deviceId;
    if ((id && actual && actual !== id) || (requireBuiltIn && CONTINUITY_LABEL.test(track.label))) {
      stream.getTracks().forEach(item => item.stop());
      throw new DOMException("브라우저가 선택한 카메라와 다른 장치를 열었어요. 카메라를 다시 선택해 주세요.", "CameraSelectionError");
    }
    return stream;
  }

  function showActive(track) {
    activeLabel.hidden = !track;
    activeLabel.textContent = track ? `사용 중 · ${track.label || "카메라 이름을 확인할 수 없음"}` : "";
  }

  if (!media?.getUserMedia) select.disabled = true;
  else {
    refresh();
    media.addEventListener?.("devicechange", refresh);
  }

  return { open, showActive };
}

function isBuiltIn(label) {
  return BUILT_IN_LABEL.test(label) && !CONTINUITY_LABEL.test(label) && !/\bIR\b|infrared|적외선/i.test(label);
}
