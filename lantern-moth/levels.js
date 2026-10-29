// Lantern Moth — 레벨 데이터 (회색 박스 10밤). 좌표 540×960, 플레이 영역 x 20~520 / y 130~920.
// 전제: 나방은 "가장 가까워 보이는 불"로 간다(체감 거리 = (d+30)/lumen, 집 1.0 · 등불 1.0 · 기름등 1.3 · 처마등 0.7 · 촛불 0.6).
// 집 등불은 어디서나 보이므로 기본 경로 = 시작→집 직선. 레벨 = 그 직선을 위험하게 만들고, 등불로 우회로를 주는 것.
// 각 레벨은 test/solver.mjs 로 검증(무입력 실패 · 해답·par · 모호 구간 · 시드 8개 안정), test/map.mjs 로 지도 확인.
// kind: lamp(청사초롱, 토글) · oil(기름등, 켜면 oil 초 뒤 소진·끄기 불가) · fixed(처마 등, 항상·3.5s 뒤 치명) · candle(촛불, 항상·1.3s 뒤 치명) · home(창가 등불)
import { GEN_LEVELS } from './levels_gen.js';

// 손으로 만든 튜토리얼·핵심 10밤 + 생성·검증 레벨(levels_gen.js)
const HAND_LEVELS = [
  { // 1. 빛으로 간다 — 아무것도 안 해도 집에 도착
    id: 'first-light', name: { en: 'First Light', ko: '첫 불빛' }, par: 0,
    start: { x: 270, y: 870 },
    lamps: [{ kind: 'home', x: 270, y: 190 }],
  },
  { // 2. 촛불 — 직선 길목의 촛불. 등불을 켜 왼쪽으로 끌어낸 뒤, 꺼서 놓아준다.
    id: 'candle', name: { en: 'The Candle', ko: '촛불' }, par: 2, wake: 2.0,
    start: { x: 270, y: 870 },
    lamps: [
      { kind: 'home', x: 270, y: 190 },
      { kind: 'candle', x: 350, y: 420 },
      { kind: 'lamp', x: 100, y: 640 },
    ],
  },
  { // 3. 거미줄 — 직선과 오른쪽 길이 막혀 있다. 두 번 갈아타기.
    id: 'webs', name: { en: 'Spider Silk', ko: '거미줄' }, par: 3,
    start: { x: 270, y: 870 },
    lamps: [
      { kind: 'home', x: 270, y: 190 },
      { kind: 'lamp', x: 420, y: 560 },
      { kind: 'lamp', x: 150, y: 360 },
    ],
    webs: [{ x: 230, y: 560, r: 55 }, { x: 350, y: 400, r: 40 }],
  },
  { // 4. 기름등 — 켜면 스스로 꺼진다. 한 번만 켜면 됨(4초면 도착·맴돌이 후 소진).
    id: 'oil', name: { en: 'Oil Lamp', ko: '기름등' }, par: 1,
    start: { x: 270, y: 870 },
    lamps: [
      { kind: 'home', x: 270, y: 190 },
      { kind: 'candle', x: 330, y: 520 },
      { kind: 'oil', x: 80, y: 460, oil: 4.0 },
    ],
  },
  { // 5. 처마 등 — 끌 수 없는 큰 불. 잡히기 전에 왼쪽 등불로 먼저 가로챈다.
    id: 'eave', name: { en: 'The Eave Light', ko: '처마 등' }, par: 2,
    start: { x: 270, y: 870 },
    lamps: [
      { kind: 'home', x: 200, y: 190 },
      { kind: 'fixed', x: 400, y: 500 },
      { kind: 'lamp', x: 80, y: 520 },
    ],
  },
  { // 6. 밤바람 — 띠를 지나면 오른쪽으로 떠밀려 촛불에 걸린다. 왼쪽 아래 등불로 먼저 당겨 왼쪽에서 건넌다.
    id: 'wind', name: { en: 'Night Wind', ko: '밤바람' }, par: 2,
    start: { x: 270, y: 870 },
    lamps: [
      { kind: 'home', x: 270, y: 190 },
      { kind: 'candle', x: 470, y: 330 },
      { kind: 'lamp', x: 80, y: 660 },
    ],
    winds: [{ x: 20, y: 380, w: 500, h: 220, fx: 170, fy: 0 }],
  },
  { // 7. 쌍촛불 — 가운데는 어느 쪽 촛불에든 잡힌다. 왼쪽 벽을 따라 크게 돌아간다(두 번 갈아타기).
    id: 'twin-candles', name: { en: 'Twin Candles', ko: '쌍촛불' }, par: 3,
    start: { x: 270, y: 870 },
    lamps: [
      { kind: 'home', x: 270, y: 190 },
      { kind: 'candle', x: 260, y: 500 },
      { kind: 'candle', x: 420, y: 500 },
      { kind: 'lamp', x: 80, y: 640 },
      { kind: 'lamp', x: 80, y: 330 },
    ],
  },
  { // 8. 두 처마 — 좌우 처마 등 사이로 중앙 릴레이
    id: 'two-eaves', name: { en: 'Two Eaves', ko: '두 처마' }, par: 4,
    start: { x: 270, y: 870 },
    lamps: [
      { kind: 'home', x: 270, y: 180 },
      { kind: 'fixed', x: 70, y: 600 },
      { kind: 'fixed', x: 470, y: 400 },
      { kind: 'lamp', x: 300, y: 660 },
      { kind: 'lamp', x: 200, y: 440 },
      { kind: 'lamp', x: 330, y: 300 },
    ],
  },
  { // 9. 돌풍 — 아래 띠는 오른쪽 촛불 쪽으로 분다. 왼쪽 아래 등불에서 출발해야 바람이 가운데로 데려다 준다(위 띠는 왼쪽으로).
    id: 'gusts', name: { en: 'Gusts', ko: '돌풍' }, par: 2,
    start: { x: 270, y: 870 },
    lamps: [
      { kind: 'home', x: 270, y: 190 },
      { kind: 'candle', x: 460, y: 620 },
      { kind: 'candle', x: 80, y: 330 },
      { kind: 'lamp', x: 70, y: 720 },
      { kind: 'lamp', x: 450, y: 450 },
    ],
    winds: [{ x: 20, y: 560, w: 500, h: 120, fx: 220, fy: 0 }, { x: 20, y: 270, w: 500, h: 100, fx: -240, fy: 0 }],
  },
  { // 10. 촛불 정원 — 조합: 왼쪽 벽을 타고 두 번 갈아탄 뒤 기름등으로 건너뛴다. 처마등은 왼쪽 위 직행을 막고, 거미줄은 아래 등불→기름등 직행을 막는다.
    id: 'candle-garden', name: { en: 'Candle Garden', ko: '촛불 정원' }, par: 3,
    start: { x: 200, y: 870 },
    lamps: [
      { kind: 'home', x: 440, y: 180 },
      { kind: 'candle', x: 300, y: 560 },
      { kind: 'candle', x: 470, y: 470 },
      { kind: 'fixed', x: 120, y: 200 },
      { kind: 'lamp', x: 80, y: 640 },
      { kind: 'lamp', x: 60, y: 400 },
      { kind: 'oil', x: 340, y: 330, oil: 2.4 },
    ],
    webs: [{ x: 190, y: 485, r: 40 }],
  },
];

// 1.1: 손제작은 개념 튜토리얼 6개(빛 → 촛불 → 거미줄 → 기름등 → 처마등 → 바람), 나머지는 등불 미로(test/lampmaze.mjs)
// 1.1b: 1번 밤 = 촛불(아무것도 안 하면 길목 촛불에 끌려 탐 → 첫 판부터 '구해야 한다'), 무입력 클리어였던 first-light 제외
const TUTORIAL = ['candle', 'webs', 'oil', 'eave', 'wind', 'twin-candles'];
export const LEVELS = TUTORIAL.map((id) => HAND_LEVELS.find((l) => l.id === id)).concat(GEN_LEVELS);
