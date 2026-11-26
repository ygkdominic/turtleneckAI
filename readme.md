# turtleneck AI Web v0.7.6

좋은 자세를 위한 온디바이스 AI 습관 코치, turtleneckAI의 Netlify 업로드용 정적 웹앱입니다.

## v0.7.6

- 자세 색상이 점수 0~100과 감도 기준에 따라 초록→노랑→주황→짙은 빨강으로 연속 변화합니다. 약 280ms 시정수로 점수 변화를 보간하며, 낮은 점수에서는 흰 글씨로 가독성을 유지합니다. 일반 팝업과 영상 PiP에 동일하게 적용합니다.
- 팝업의 클릭이 본 화면의 사용자 동작으로 인정되지 않을 때, 실패를 반복하지 않고 본 화면의 ‘항상 위로 전환’ 버튼에서 이어서 고정할 수 있도록 했습니다. 실제 고정 전까지 체크박스는 기존 상태를 유지합니다.
- Safari 영상 PiP는 미리 준비하고, 고정 요청 전에 video.play()를 기다리지 않도록 수정했습니다. 준비 전이면 본 화면의 전환 버튼을 다시 누르도록 안내합니다.
- 일반 웹 팝업을 macOS 창으로 직접 고정하는 기능은 브라우저에 없습니다. 브라우저 PiP 지원이 필요하며, Safari 영상형 PiP 내부에서는 사용자 버튼을 표시할 수 없습니다. 본 화면에서 조작하거나 Document PiP를 지원하는 브라우저를 사용하세요.
- 검증: JS 문법, 101개 점수의 색상 연속성, 중립색 복귀, 팝업 클릭의 본 화면 전환 안내, 체크 상태 동기화 통과. 실제 macOS 브라우저 PiP 검증과 Netlify 배포는 별도입니다.

## v0.7.5

- 미니 팝업 하단에 항상 위 체크박스를 추가했습니다. 본 화면의 설정과 동기화하며, 전환이 실패하면 기존 설정으로 복구합니다.
- 하단 집중 타이머 영역이 본 화면의 자세 판정과 같은 기준으로 녹색·노란색·붉은색 그라데이션을 표시합니다. 카메라 꺼짐·인식 대기·기준 자세 설정 중에는 중립색을 사용합니다.
- Safari의 영상형 PiP도 자세 색상을 표시합니다. 브라우저 영상형 PiP 안에는 사용자 체크박스를 넣을 수 없어, 고정 해제 및 타이머 조작은 원래 화면에서 진행합니다. 팝업 안에서 양방향 전환과 타이머 조작을 하려면 Document PiP를 지원하는 Chrome/Edge를 사용하세요.
- 상단 문구와 서비스명을 수정하고 하단에 시작 시점과 협업 연락처를 추가했습니다.
- 서비스워커 캐시를 v075로 갱신했습니다.

## v0.7.1

- 카메라 선택을 추가했습니다. 자동 모드에서는 내장 카메라를 우선 사용합니다. 첫 권한 요청 전 기기 이름이 숨겨져 있으면 브라우저 기본 카메라로 권한을 확인한 뒤, 내장 카메라가 확인되는 즉시 전환합니다.
- Safari에서 권한을 다시 요청하려면 **Safari → 설정 → 웹사이트 → 카메라**에서 현재 주소를 **묻기**로 바꾼 뒤 **카메라 시작**을 누르세요.

## v0.7.0

- `미니 창 열기`를 누르면 카메라 미리보기와 하단 집중 타이머를 별도 창에서 볼 수 있습니다. 창의 가장자리를 드래그해 크기를 조절하세요.
- `항상 위`를 켜면 지원 브라우저에서 창을 고정합니다. 미니 창이 열려 있는 상태에서 이 옵션을 끄면 일반 창으로 전환합니다. Safari의 영상 방식 고정 창에서 타이머를 조작하려면 원래 페이지를 사용하세요.
- 미니 창은 원래 페이지의 카메라와 타이머를 그대로 사용합니다. 카메라를 끄면 두 창에서 영상이 사라집니다. 미니 창을 종료해도 원래 페이지의 타이머는 계속됩니다.
- 같은 영상 프레임을 분석과 미리보기에 사용하고 눈·코·입·어깨 표시를 해당 프레임에 직접 그립니다. 얼굴과 양쪽 어깨가 충분히 확인되지 않으면 자세 점수와 알림을 잠시 보류합니다.

## v0.6.0

- 카메라 배경을 원본, 블러, 회의실, 카페 중에서 고를 수 있습니다. 자세는 카메라 원본에서 측정하고, 배경은 미리보기에서 기기 내 합성합니다. 어두운 환경이나 빠르게 움직이는 경우 사람 윤곽에 실제 배경이 일부 보일 수 있습니다.
- 집중 타이머는 카메라와 별개로 작동합니다. 5·10·15·20·30·50분과 1시간 프리셋 또는 분·초 직접 입력을 지원합니다. 집중 중에는 일시정지, 계속하기, 초기화를 사용할 수 있습니다.
- 타이머 종료 시 자세를 다시 잡고 잠깐 움직이도록 안내합니다. 소리, 페이지, 컴퓨터 알림을 각각 선택할 수 있습니다. 컴퓨터 알림에는 브라우저와 운영체제의 알림 허용이 필요합니다.
- 배경과 타이머 설정을 브라우저에 저장합니다. 실행 중인 타이머는 페이지를 새로고침하거나 닫으면 초기화되며 절전이나 브라우저의 백그라운드 실행 제한 상태에서는 알림이 늦어질 수 있습니다.
- 카메라를 끄면 영상 스트림이 종료됩니다. 카메라를 다시 켜서 자세 측정을 이어갈 수 있습니다.

## v0.5.2 반영사항

- 최상단 멘트 변경: `ON-DEVICE AI HABIT COACH`
- 메인 카피 변경: `당신이 집중하는 동안, 터틀넥 AI가 당신의 자세를 지켜드립니다.`
- 카메라 시작 후 3초 카운트다운 자동 기준자세 설정
- 자동 설정 실패 시 기존처럼 수동 `기준 자세 다시 설정` 가능
- 부드러운 사운드 알림 보강: 오디오 초기화 및 `알림 소리 테스트` 버튼 추가
- 사용법 문구 변경: `이제 평소처럼 사용하세요`
- 서비스워커 캐시 버전 갱신

- 사용성 개선: `CSV 내보내기`, `URL 공유` 메뉴 삭제

## 기존 v0.4 기능 유지

- 인식 상태 표시: 좋음 / 불안정 / 인식 어려움
- 얼굴·입·양쪽 어깨가 충분히 인식될 때만 기준 저장
- 오늘 자세 요약 PNG 저장
- 한국식 날짜/시간 표시

## Netlify 업로드

이 폴더를 그대로 Netlify 배포 루트로 사용하세요. 빌드 명령은 필요 없으며 `index.html`이 시작 페이지입니다. 이전 `index-22.html` 주소로 접근하면 시작 페이지로 이동합니다.

- index.html
- styles.css
- app.js
- camera-background.js
- camera-device.js
- focus-timer.js
- mini-window.js
- mini-window.css
- backgrounds/ (회의실·카페 이미지)
- manifest.webmanifest
- service-worker.js
- index-22.html

## 테스트 권장

로컬에서 확인하려면 이 폴더에서 `python3 -m http.server 8000`을 실행한 뒤 브라우저로 `http://localhost:8000`을 여세요. Netlify에서는 HTTPS 주소를 사용하세요. 카메라 모델을 처음 가져오려면 인터넷 연결이 필요합니다.

1. 카메라를 켠 뒤 3초 카운트다운과 기준 자세가 설정되는지 확인하세요.
2. 카메라 배경을 차례로 바꾸면서 사람과 자세 점수가 계속 표시되는지 확인하세요.
3. 집중 시간을 5초로 직접 설정하고 시작, 일시정지, 계속하기, 초기화와 종료 알림을 확인하세요.
4. 컴퓨터 알림을 선택하고 권한을 허용한 뒤 다른 탭으로 이동하여 종료 알림을 확인하세요.
5. 소리가 들리지 않으면 `알림 소리 테스트` 버튼과 기기 음량을 확인하세요.
6. 타이머를 실행한 상태에서 미니 창을 열고 크기와 `항상 위`를 변경하세요. 두 창의 카운트다운과 카메라 미리보기를 확인하세요.
7. Safari에서 얼굴을 화면 좌우로 옮기거나 브라우저 폭을 바꿔 인식선이 계속 얼굴과 어깨 위에 그려지는지 확인하세요.

## 주의

- 카메라 영상은 저장되지 않습니다.
- 의료 진단/치료 목적이 아닌 자세 습관 형성 보조 서비스입니다.

## 배경 이미지

회의실과 카페 사진은 기본 이미지 생성 도구에서 만들었습니다. 배포용 JPEG는 `backgrounds/`에 있습니다.

<details>
<summary>이미지 생성에 사용한 프롬프트</summary>

- 회의실 — `Use case: photorealistic-natural. Asset type: webcam virtual background for a posture coaching web app. Generate a landscape 16:9 photograph of an unoccupied modern meeting room, seen from sitting eye level with a quiet, softly lit wall behind the center, a glass partition and subtle daylight on the sides, a conference table and neutral fabric chairs toward the bottom. Slightly soft depth of field so a person composited in the foreground reads naturally, muted cool gray and oak tones, realistic architecture. No people, signage, text, graphics, or watermark.`
- 카페 — `Use case: photorealistic-natural. Asset type: webcam virtual background for a posture coaching web app. Generate a landscape 16:9 photograph of an unoccupied neighborhood cafe, seen from sitting eye level, with a warm plaster wall, soft window light from the side, simple wooden tables, and a coffee counter in the distance. Keep the center visually quiet for a seated person composited in the foreground. Slightly soft depth of field, restrained warm oak and cream tones, realistic architecture. No people, signage, text, graphics, or watermark.`

</details>


## v0.5.2 디자인 보정
- 카메라 하단의 현재 자세 점수 / 알림 설정 / 오늘 자세 요약 카드를 동일한 3열 그리드 폭으로 정렬했습니다.
- 세 카드의 높이와 내부 여백을 맞춰 상업용 베타 화면처럼 균형감 있게 보이도록 조정했습니다.
- 오늘 리포트 저장 버튼을 알림 소리 테스트 버튼과 같은 하단 CTA 위치/크기로 정렬했습니다.
- 오늘 자세 요약의 내부 통계 그리드를 2열 구조로 정리해 가독성을 개선했습니다.
