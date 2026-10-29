// Sandglass — 레벨 데이터. 격자 40×40(테두리 1셀 벽 자동), 좌표는 셀 단위(x 오른쪽, y 아래, 시작 중력 = 아래).
// 프리미티브: walls[] 벽 사각형 · drains[] 배수구 · sand[] 모래 덩어리(color 1 호박 2 청록 3 주홍) · targets[] 목표 방(color·min·strict).
// 각 레벨은 test/solver.mjs 로 검증(무입력 실패·해답·par·시드 안정·지연 허용). 주의: 모래는 바닥에 놓인 '정지' 상태로 시작하게 배치.
import { GEN_LEVELS } from './levels_gen.js';

// 손제작 10그릇 + 생성·검증 레벨(levels_gen.js)
const HAND_LEVELS = [
  { // 1. 뒤집기 — 모래시계. 두 번 돌리면(180°) 깔때기를 타고 좁은 목으로 모래가 위 방에 쏟아진다
    id: 'turn-over', name: { en: 'Turn It Over', ko: '뒤집기' }, par: 2,
    lines: [{ x1: 1, y1: 32, x2: 18, y2: 15 }, { x1: 38, y1: 32, x2: 21, y2: 15 }],
    sand: [{ x: 1, y: 33, w: 38, h: 6, color: 1 }],
    targets: [{ x: 1, y: 1, w: 38, h: 14, color: 1, min: 170 }],
  },
  { // 2. 기울이기 — 뒤집어 올린 뒤 오른쪽 위 틈으로 기울여 붓는다
    id: 'tilt', name: { en: 'Tilt', ko: '기울이기' }, par: 3,
    walls: [{ x: 19, y: 1, w: 2, h: 20 }, { x: 19, y: 27, w: 2, h: 12 }, { x: 1, y: 19, w: 18, h: 2 }],
    sand: [{ x: 1, y: 30, w: 18, h: 9, color: 1 }],
    targets: [{ x: 21, y: 1, w: 18, h: 38, color: 1, min: 120 }],
  },
  { // 3. 배수구 — 오른쪽 방 바닥 구석에 구멍. 부은 뒤 바로 위로 돌려 구멍에서 떼어낸다
    id: 'the-drain', name: { en: 'The Drain', ko: '배수구' }, par: 2,
    walls: [{ x: 19, y: 1, w: 2, h: 20 }, { x: 19, y: 27, w: 2, h: 12 }, { x: 1, y: 19, w: 18, h: 2 }],
    drains: [{ x: 37, y: 33, w: 2, h: 6 }],
    sand: [{ x: 1, y: 30, w: 18, h: 9, color: 1 }],
    targets: [{ x: 21, y: 1, w: 18, h: 16, color: 1, min: 90 }],
  },
  { // 4. 이중 목 — 세 층의 방. 한 번 뒤집으면 두 개의 목을 연달아 지난다
    id: 'double-neck', name: { en: 'Double Neck', ko: '이중 목' }, par: 4,
    lines: [{ x1: 1, y1: 35, x2: 18, y2: 18 }, { x1: 38, y1: 35, x2: 21, y2: 18 }, { x1: 1, y1: 16, x2: 10, y2: 7 }, { x1: 38, y1: 16, x2: 29, y2: 7 }],
    walls: [{ x: 12, y: 7, w: 7, h: 2 }, { x: 21, y: 7, w: 7, h: 2 }],
    sand: [{ x: 1, y: 36, w: 38, h: 3, color: 1 }],
    targets: [{ x: 1, y: 1, w: 38, h: 6, color: 1, min: 60 }],
  },
  { // 5. 세 방 — 올리고, 오른쪽으로 붓고, 다시 올려 오른쪽 위 방으로
    id: 'three-rooms', name: { en: 'Three Rooms', ko: '세 방' }, par: 4,
    walls: [{ x: 19, y: 1, w: 2, h: 20 }, { x: 19, y: 27, w: 2, h: 12 }, { x: 1, y: 19, w: 18, h: 2 }, { x: 21, y: 19, w: 14, h: 2 }],
    sand: [{ x: 1, y: 30, w: 18, h: 9, color: 1 }],
    targets: [{ x: 21, y: 1, w: 18, h: 18, color: 1, min: 100 }],
  },
  { // 6. 쌍둥이 — 두 개의 깔때기. 한 번 뒤집으면 두 색이 각자의 방으로
    id: 'twins', name: { en: 'Twins', ko: '쌍둥이' }, par: 2, strict: true,
    walls: [{ x: 19, y: 1, w: 2, h: 38 }],
    lines: [{ x1: 1, y1: 32, x2: 8, y2: 25 }, { x1: 18, y1: 32, x2: 11, y2: 25 }, { x1: 21, y1: 32, x2: 28, y2: 25 }, { x1: 38, y1: 32, x2: 31, y2: 25 }],
    sand: [{ x: 1, y: 33, w: 18, h: 6, color: 2 }, { x: 21, y: 33, w: 18, h: 6, color: 1 }],
    targets: [{ x: 1, y: 1, w: 18, h: 24, color: 2, min: 70 }, { x: 21, y: 1, w: 18, h: 24, color: 1, min: 70 }],
  },
  { // 7. 좁은 길 — 오른쪽 방 바닥 양끝에 배수구. 가운데 띠에만 모래가 남아야 한다
    id: 'narrow-pass', name: { en: 'Narrow Pass', ko: '좁은 길' }, par: 3,
    walls: [{ x: 19, y: 1, w: 2, h: 20 }, { x: 19, y: 27, w: 2, h: 12 }, { x: 1, y: 19, w: 18, h: 2 }, { x: 30, y: 10, w: 9, h: 2 }, { x: 30, y: 29, w: 9, h: 2 }],
    drains: [{ x: 37, y: 1, w: 2, h: 9 }, { x: 37, y: 31, w: 2, h: 8 }],
    sand: [{ x: 1, y: 30, w: 18, h: 9, color: 1 }],
    targets: [{ x: 21, y: 12, w: 18, h: 17, color: 1, min: 100 }],
  },
  { // 8. 두 구멍 — 오른쪽 방 위아래 구석에 배수구. 기울여 붓고 곧바로 다시 올려 가운데 띠에 가둔다
    id: 'two-holes', name: { en: 'Two Holes', ko: '두 구멍' }, par: 3,
    walls: [{ x: 19, y: 1, w: 2, h: 20 }, { x: 19, y: 27, w: 2, h: 12 }, { x: 1, y: 19, w: 18, h: 2 }, { x: 21, y: 13, w: 12, h: 2 }, { x: 21, y: 27, w: 12, h: 2 }],
    drains: [{ x: 37, y: 1, w: 2, h: 4 }, { x: 37, y: 35, w: 2, h: 4 }],
    sand: [{ x: 1, y: 30, w: 18, h: 9, color: 1 }],
    targets: [{ x: 21, y: 15, w: 18, h: 12, color: 1, min: 80 }],
  },
  { // 9. 구석 구멍 — 세 방 + 배수구: 오른쪽 아래 방 바닥 구석의 구멍을 피해 빨리 올려야 한다
    id: 'corner-hole', name: { en: 'Corner Hole', ko: '구석 구멍' }, par: 2,
    walls: [{ x: 19, y: 1, w: 2, h: 20 }, { x: 19, y: 27, w: 2, h: 12 }, { x: 1, y: 19, w: 18, h: 2 }, { x: 21, y: 19, w: 14, h: 2 }],
    drains: [{ x: 37, y: 36, w: 2, h: 3 }],
    sand: [{ x: 1, y: 30, w: 18, h: 9, color: 1 }],
    targets: [{ x: 21, y: 1, w: 18, h: 18, color: 1, min: 80 }],
  },
  { // 10. 반반 — 한 색을 두 방에 나눠 담기: 먼저 오른쪽으로 일부, 남은 것은 위로
    id: 'half-and-half', name: { en: 'Half and Half', ko: '반반' }, par: 4,
    walls: [{ x: 19, y: 1, w: 2, h: 20 }, { x: 19, y: 27, w: 2, h: 12 }, { x: 1, y: 19, w: 7, h: 2 }, { x: 12, y: 19, w: 7, h: 2 }],
    sand: [{ x: 1, y: 30, w: 18, h: 9, color: 1 }],
    targets: [{ x: 1, y: 1, w: 18, h: 18, color: 1, min: 50 }, { x: 21, y: 1, w: 18, h: 38, color: 1, min: 50 }],
  },
];

// 1.1: 손제작은 개념 튜토리얼 6개만(뒤집기 → 기울이기 → 배수구 → 두 색 → 세 방 → 나누기), 나머지는 방 미로(test/maze.mjs)
const TUTORIAL = ['turn-over', 'tilt', 'the-drain', 'twins', 'three-rooms', 'half-and-half'];
export const LEVELS = TUTORIAL.map((id) => HAND_LEVELS.find((l) => l.id === id)).concat(GEN_LEVELS);
