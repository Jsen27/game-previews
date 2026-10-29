// game-15-sandglass : Sandglass
// -----------------------------------------------------------------------------
// 규칙 한 문장: "유리그릇을 돌려서 모래를 표시된 방까지 채워라." 조작은 좌/우 90° 회전뿐.
//
// 장르: 낙하 모래 물리 + 회전 퍼즐(원탭 두 개). 모래 물리·판정은 전부 ./sim.js(순수 모듈, Node 솔버와 공유),
// 이 파일은 렌더·입력·연출·광고 흐름만 담당한다. 레벨 ./levels.js, 힌트 ./hints.js. 설계 = 게임 루트 DESIGN.md, 아트 = STYLE_GUIDE.md.
//
// 포털 빌드: 광고는 shared/gd-flow.js(GDFlow.playAd) 로만.
//   - 프리롤 = PLAY 버튼 pointerup 직후, 미드롤 = Next/Retry/Home 버튼마다(빈도는 GD SDK, 자체 쿨다운 없음).
//   - 광고 중 씬 정지 + 완전 음소거, 광고 후 "TAP TO CONTINUE" 는 GDFlow 가 보장.
//   - BGM: shared/music.js(SONGS.sandglass) + 음악/효과음 토글 분리(GD 필수).
import { GDFlow } from './shared/gd-flow.js';
import { createMusic, SONGS } from './shared/music.js';
import { clamp, loadJSON, saveJSON, initCloudStorage } from './shared/utils.js';
// CrazyGames Data 모듈(진행 저장·로그인 시 클라우드 동기화) 준비 — 세이브/언어를 읽는 어떤 코드보다 먼저. 실패·4초 초과면 localStorage.
await initCloudStorage();
import { SIM, CELL, GRAV, createSim, step, rotate, countIn, remaining, isSand, cloneSim, buildGrid } from './sim.js';
import { LEVELS } from './levels.js';
import { HINTS } from './hints.js'; // 솔버 par 해답(회전 순서) — test/hints.mjs 가 생성
// 1.2: 장(10그릇씩) — 벽 재질(색)과 장 이름. 장의 첫 그릇에 제목 카드
const CHAPTERS = [
  { from: 0, wall: 0xa87a32, wallDark: 0x5c3f16, edge: 'rgba(255,230,170,0.35)', frame: 0xffffff, glass: 'rgba(255,240,210,0.07)', name: { en: 'The Workshop', ko: '공방', ja: '工房', zh: '工坊', es: 'El taller', pt: 'A oficina', fr: "L'atelier", de: 'Die Werkstatt', it: 'La bottega', tr: 'Atölye', ru: 'Мастерская' } },
  { from: 10, wall: 0x9a5a36, wallDark: 0x4e2a18, edge: 'rgba(255,200,150,0.35)', frame: 0xffc9a0, glass: 'rgba(255,190,140,0.09)', name: { en: 'The Copper Still', ko: '구리 증류기', ja: '銅の蒸留器', zh: '铜蒸馏器', es: 'El alambique de cobre', pt: 'O alambique de cobre', fr: "L'alambic de cuivre", de: 'Die Kupferdestille', it: "L'alambicco di rame", tr: 'Bakır İmbik', ru: 'Медный перегонный куб' } },
  { from: 20, wall: 0x7f98a6, wallDark: 0x3a4a54, edge: 'rgba(230,245,255,0.4)', frame: 0xcfe3f0, glass: 'rgba(200,235,255,0.10)', name: { en: 'The Glass Cabinet', ko: '유리 진열장', ja: 'ガラスの棚', zh: '玻璃柜', es: 'La vitrina', pt: 'A vitrine', fr: 'La vitrine', de: 'Die Glasvitrine', it: 'La vetrina', tr: 'Cam Dolap', ru: 'Стеклянный шкаф' } },
  { from: 30, wall: 0x4e4360, wallDark: 0x221c30, edge: 'rgba(230,184,74,0.45)', frame: 0xc9b0ff, glass: 'rgba(170,140,230,0.10)', name: { en: 'The Obsidian Vault', ko: '흑요석 금고', ja: '黒曜石の金庫', zh: '黑曜石密室', es: 'La cámara de obsidiana', pt: 'O cofre de obsidiana', fr: "La chambre d'obsidienne", de: 'Das Obsidiangewölbe', it: 'La cripta di ossidiana', tr: 'Obsidyen Kasa', ru: 'Обсидиановое хранилище' } },
  // 1.2e: 41~60 — 루비 유리(장미창)·은청색(천문대)
  { from: 40, wall: 0x8e2f3a, wallDark: 0x47141b, edge: 'rgba(255,190,200,0.4)', frame: 0xffb8c0, glass: 'rgba(255,150,170,0.09)', name: { en: 'The Rose Window', ko: '장미창', ja: '薔薇窓', zh: '玫瑰窗', es: 'El rosetón', pt: 'A rosácea', fr: 'La rosace', de: 'Die Rosette', it: 'Il rosone', tr: 'Gül Pencere', ru: 'Окно-роза' } },
  { from: 50, wall: 0x6f8aa6, wallDark: 0x2f3f52, edge: 'rgba(220,240,255,0.45)', frame: 0xdbe8ff, glass: 'rgba(190,220,255,0.10)', name: { en: 'The Observatory', ko: '천문대', ja: '天文台', zh: '天文台', es: 'El observatorio', pt: 'O observatório', fr: "L'observatoire", de: 'Das Observatorium', it: "L'osservatorio", tr: 'Gözlemevi', ru: 'Обсерватория' } },
];
const chapterOf = (i) => { let c = 0; CHAPTERS.forEach((ch, k) => { if (i >= ch.from) c = k; }); return c; };


const QA_HOOKS = /(?:^|[?&])qa=1(?:&|$)/.test(location.search);

// =============================================================================
// CONFIG
// =============================================================================
const CONFIG = {
  W: 540, H: 960,
  SAVE_KEY: 'sandglass', LANG_KEY: 'sandglass-lang',
  HUD_H: 110,
  VESSEL: 432,            // 그릇 한 변(px) = N × CELL_PX
  VESSEL_Y: 520,          // 그릇 중심 y
  ROT_MS: 280,            // 회전 트윈
  VSCALE: 0.94,           // 1.1b: 그릇+액자 배율(액자 573px 이 540 화면에서 잘리지 않게)
  FAIL_RESTART_MS: 1200,
  SFX_VOLUME: 0.55,
  HINT_EVERY: 3, HINT_AFTER_FAILS: 2,
};
const W = CONFIG.W, H = CONFIG.H, N = SIM.N, CELL_PX = CONFIG.VESSEL / N;
const FONT = "'Montserrat', system-ui, sans-serif";
const FONT_D = "'Cinzel', 'Montserrat', serif";
const ADD = Phaser.BlendModes.ADD;
const DEPTH = { BG: 0, VESSEL: 10, FX: 40, HUD: 70, OVERLAY: 100, MODAL: 110, TOAST: 130 };
const PREVIEW_MAX = 6;   // 1.2e: 15번 그릇부터의 미리보기 예산(그릇마다 리셋, 회전이 정지할 때마다 +1 회복)
const HOLD_MS = 150;     // 1.2e: 회전 버튼을 이만큼 누르고 있으면 '정지 결과 미리보기'(짧은 탭은 즉시 회전)
const WALL_E = 3;        // 1.2e: 벽 셀을 사방 3px 넓혀 그린다(시뮬 무관) — 1셀 파이프가 폰에서 실처럼 보이던 문제
const MAX_GW = 1720;     // 1.2e: 가로 iframe 에서 논리 폭을 비율에 맞춰 넓힌다(세로 기둥 대신 양옆 공방 + 다이얼)
const PAL = {
  bg0: 0x1a120e, bg1: 0x2b1d14, wood: 0x3b2718, candle: 0xffb466,
  glass: 0xdceff2, brass: 0xc9933a, brassDark: 0x7a5520, wall: 0xa87a32, wallDark: 0x5c3f16,
  sand: [null, [0xe8b04b, 0xc98c2e, 0xf7d27a], [0x3ebfb0, 0x2a8f84, 0x7ee0d4], [0xe0603c, 0xb4452a, 0xf39a7a]],
  target: 0xf7d27a, targetMet: 0xffe9a8, drain: 0x0b0806, drainRim: 0x6b4fa0,
  text: 0xf4e6cf, textDim: 0xb59e7e, gold: 0xe6b84a, danger: 0xe0603c, ink: 0x1a120e,
};
const css = (h) => '#' + h.toString(16).padStart(6, '0');

// =============================================================================
// i18n (11개 언어)
// =============================================================================
const STRINGS = {
  en: { title: 'SANDGLASS', tagline: 'Two taps. Turn the glass. Let the sand find its way.', play: 'PLAY', vessel: 'Vessel {n}', turns: 'Turns', par: 'Par', cleared: 'Vessel {n} filled', next: 'NEXT', retry: 'RETRY', home: 'HOME', mixed: 'Mixed!', lost: 'Too much sand lost', timeout: 'The sand settled short', howTo: 'Tap the left or right side to turn the glass a quarter turn. Sand falls, slides and pours. Fill the marked chambers with the right sand — fewer turns, more stars.', allDone: 'Every vessel is filled.', shelf: 'SHELF', back: 'BACK', undo: 'Undo', chapter: 'Chapter {n}', hint: 'Hint', hintGot: '+1 hint', newBest: 'Fewest turns!', lostSand: 'lost', needMore: 'need', previews: 'Previews', noPreview: 'No previews left', tipDrain: 'Drain — sand that falls in is gone', tipSieve: 'Sieve — only this colour passes', holdTip: 'Hold a turn button to preview where the sand will settle', previewTip: 'Previews are limited from here on — each turn earns one back' },
  ko: { title: 'SANDGLASS', tagline: '두 번의 탭. 그릇을 돌리면 모래가 길을 찾는다.', play: '시작', vessel: '{n}번째 그릇', turns: '회전', par: '기준', cleared: '{n}번째 그릇 완성', next: '다음', retry: '다시', home: '홈', mixed: '섞였어요!', lost: '모래를 너무 흘렸어요', timeout: '모래가 멈췄어요', howTo: '화면 왼쪽·오른쪽을 탭하면 그릇이 90° 돌아요. 모래는 떨어지고, 미끄러지고, 쏟아져요. 표시된 방을 알맞은 모래로 채우세요 — 적게 돌릴수록 별이 많아요.', allDone: '모든 그릇을 채웠어요.', shelf: '선반', back: '뒤로', undo: '되돌리기', chapter: '{n}장', hint: '힌트', hintGot: '힌트 +1', newBest: '최소 회전!', lostSand: '유실', needMore: '필요', previews: '미리보기', noPreview: '미리보기를 다 썼어요', tipDrain: '배수구 — 빠진 모래는 사라져요', tipSieve: '체 — 이 색 모래만 지나가요', holdTip: '회전 버튼을 길게 누르면 모래가 멈출 자리가 보여요', previewTip: '여기부터 미리보기는 제한돼요 — 회전할 때마다 1회 회복' },
  ja: { title: 'SANDGLASS', tagline: '2回のタップ。器を回せば、砂が道を見つける。', play: 'プレイ', vessel: '器 {n}', turns: '回転', par: '基準', cleared: '器 {n} 完成', next: '次へ', retry: 'リトライ', home: 'ホーム', mixed: '混ざった！', lost: '砂を失いすぎた', timeout: '砂が止まった', howTo: '画面の左右をタップすると器が90°回ります。砂は落ち、滑り、注がれます。印の部屋を正しい砂で満たしましょう。回転が少ないほど星が増えます。', allDone: 'すべての器が満ちました。', shelf: '棚', back: '戻る', undo: '戻す', chapter: '第{n}章', hint: 'ヒント', hintGot: 'ヒント +1', newBest: '最少回転！', lostSand: '損失', needMore: '必要', previews: 'プレビュー', noPreview: 'プレビューを使い切りました', tipDrain: '排水口 — 落ちた砂は消えます', tipSieve: 'ふるい — この色の砂だけ通ります', holdTip: '回転ボタンを長押しすると砂の止まる場所が見えます', previewTip: 'ここからプレビューは回数制限 — 回転ごとに1回回復' },
  zh: { title: 'SANDGLASS', tagline: '两次点击。转动容器，让沙子找到路。', play: '开始', vessel: '容器 {n}', turns: '旋转', par: '标准', cleared: '容器 {n} 已填满', next: '下一关', retry: '重试', home: '主页', mixed: '混在一起了！', lost: '沙子流失太多', timeout: '沙子停住了', howTo: '点击屏幕左侧或右侧，容器转动90°。沙子会下落、滑动、倾泻。用正确的沙子填满标记的房间——旋转越少，星星越多。', allDone: '所有容器都已填满。', shelf: '架子', back: '返回', undo: '撤销', chapter: '第{n}章', hint: '提示', hintGot: '提示 +1', newBest: '最少旋转！', lostSand: '流失', needMore: '需要', previews: '预览', noPreview: '预览次数已用完', tipDrain: '排水口——掉进去的沙子会消失', tipSieve: '筛网——只有这种颜色的沙子能通过', holdTip: '长按旋转按钮可预览沙子停下的位置', previewTip: '从这里开始预览次数有限——每次旋转恢复一次' },
  es: { title: 'SANDGLASS', tagline: 'Dos toques. Gira el vaso. Deja que la arena encuentre su camino.', play: 'JUGAR', vessel: 'Vasija {n}', turns: 'Giros', par: 'Par', cleared: 'Vasija {n} llena', next: 'SIGUIENTE', retry: 'REINTENTAR', home: 'INICIO', mixed: '¡Se mezcló!', lost: 'Perdiste demasiada arena', timeout: 'La arena se detuvo', howTo: 'Toca el lado izquierdo o derecho para girar el vaso un cuarto de vuelta. La arena cae, resbala y se vierte. Llena las cámaras marcadas con la arena correcta: menos giros, más estrellas.', allDone: 'Todas las vasijas están llenas.', shelf: 'ESTANTE', back: 'VOLVER', undo: 'Deshacer', chapter: 'Capítulo {n}', hint: 'Pista', hintGot: '+1 pista', newBest: '¡Mínimos giros!', lostSand: 'perdida', needMore: 'falta', previews: 'Vistas previas', noPreview: 'Sin vistas previas', tipDrain: 'Desagüe: la arena que cae se pierde', tipSieve: 'Tamiz: solo pasa este color', holdTip: 'Mantén pulsado un botón de giro para ver dónde se asentará la arena', previewTip: 'Desde aquí las vistas previas son limitadas: cada giro devuelve una' },
  pt: { title: 'SANDGLASS', tagline: 'Dois toques. Gire o vaso. Deixe a areia achar o caminho.', play: 'JOGAR', vessel: 'Vaso {n}', turns: 'Giros', par: 'Par', cleared: 'Vaso {n} cheio', next: 'PRÓXIMO', retry: 'TENTAR DE NOVO', home: 'INÍCIO', mixed: 'Misturou!', lost: 'Perdeu areia demais', timeout: 'A areia parou', howTo: 'Toque no lado esquerdo ou direito para girar o vaso um quarto de volta. A areia cai, escorrega e despeja. Encha as câmaras marcadas com a areia certa: menos giros, mais estrelas.', allDone: 'Todos os vasos estão cheios.', shelf: 'PRATELEIRA', back: 'VOLTAR', undo: 'Desfazer', chapter: 'Capítulo {n}', hint: 'Dica', hintGot: '+1 dica', newBest: 'Menos giros!', lostSand: 'perdida', needMore: 'falta', previews: 'Prévias', noPreview: 'Sem prévias', tipDrain: 'Ralo: a areia que cai se perde', tipSieve: 'Peneira: só esta cor passa', holdTip: 'Segure um botão de giro para ver onde a areia vai parar', previewTip: 'Daqui em diante as prévias são limitadas: cada giro devolve uma' },
  fr: { title: 'SANDGLASS', tagline: 'Deux touches. Tournez le verre. Laissez le sable trouver son chemin.', play: 'JOUER', vessel: 'Fiole {n}', turns: 'Tours', par: 'Par', cleared: 'Fiole {n} remplie', next: 'SUIVANT', retry: 'REJOUER', home: 'ACCUEIL', mixed: 'Mélangé !', lost: 'Trop de sable perdu', timeout: 'Le sable s’est arrêté', howTo: 'Touchez le côté gauche ou droit pour tourner le verre d’un quart de tour. Le sable tombe, glisse et se déverse. Remplissez les chambres marquées avec le bon sable : moins de tours, plus d’étoiles.', allDone: 'Toutes les fioles sont remplies.', shelf: 'ÉTAGÈRE', back: 'RETOUR', undo: 'Annuler', chapter: 'Chapitre {n}', hint: 'Indice', hintGot: '+1 indice', newBest: 'Minimum de tours !', lostSand: 'perdu', needMore: 'manque', previews: 'Aperçus', noPreview: 'Plus d\'aperçus', tipDrain: 'Bonde : le sable qui y tombe est perdu', tipSieve: 'Tamis : seule cette couleur passe', holdTip: 'Maintenez un bouton de rotation pour voir où le sable va se poser', previewTip: 'À partir d\'ici les aperçus sont limités : chaque tour en rend un' },
  de: { title: 'SANDGLASS', tagline: 'Zwei Tipps. Dreh das Glas. Lass den Sand seinen Weg finden.', play: 'SPIELEN', vessel: 'Gefäß {n}', turns: 'Drehungen', par: 'Par', cleared: 'Gefäß {n} gefüllt', next: 'WEITER', retry: 'NOCHMAL', home: 'START', mixed: 'Vermischt!', lost: 'Zu viel Sand verloren', timeout: 'Der Sand kam zur Ruhe', howTo: 'Tippe links oder rechts, um das Glas um eine Vierteldrehung zu drehen. Sand fällt, rutscht und rinnt. Fülle die markierten Kammern mit dem richtigen Sand – weniger Drehungen, mehr Sterne.', allDone: 'Alle Gefäße sind gefüllt.', shelf: 'REGAL', back: 'ZURÜCK', undo: 'Zurück', chapter: 'Kapitel {n}', hint: 'Tipp', hintGot: '+1 Tipp', newBest: 'Wenigste Drehungen!', lostSand: 'verloren', needMore: 'fehlt', previews: 'Vorschauen', noPreview: 'Keine Vorschau mehr', tipDrain: 'Abfluss – hineinfallender Sand ist verloren', tipSieve: 'Sieb – nur diese Farbe kommt durch', holdTip: 'Drehknopf gedrückt halten zeigt, wo der Sand liegen bleibt', previewTip: 'Ab hier sind Vorschauen begrenzt – jede Drehung gibt eine zurück' },
  it: { title: 'SANDGLASS', tagline: 'Due tocchi. Gira il vetro. Lascia che la sabbia trovi la via.', play: 'GIOCA', vessel: 'Ampolla {n}', turns: 'Giri', par: 'Par', cleared: 'Ampolla {n} piena', next: 'AVANTI', retry: 'RIPROVA', home: 'HOME', mixed: 'Mescolata!', lost: 'Troppa sabbia persa', timeout: 'La sabbia si è fermata', howTo: 'Tocca il lato sinistro o destro per girare il vetro di un quarto. La sabbia cade, scivola e si versa. Riempi le camere segnate con la sabbia giusta: meno giri, più stelle.', allDone: 'Tutte le ampolle sono piene.', shelf: 'SCAFFALE', back: 'INDIETRO', undo: 'Annulla', chapter: 'Capitolo {n}', hint: 'Aiuto', hintGot: '+1 aiuto', newBest: 'Meno giri!', lostSand: 'persa', needMore: 'manca', previews: 'Anteprime', noPreview: 'Anteprime finite', tipDrain: 'Scarico: la sabbia che vi cade è persa', tipSieve: 'Setaccio: passa solo questo colore', holdTip: 'Tieni premuto un pulsante di rotazione per vedere dove si fermerà la sabbia', previewTip: 'Da qui le anteprime sono limitate: ogni giro ne restituisce una' },
  tr: { title: 'SANDGLASS', tagline: 'İki dokunuş. Camı çevir. Kum yolunu bulsun.', play: 'OYNA', vessel: 'Kap {n}', turns: 'Dönüş', par: 'Par', cleared: 'Kap {n} doldu', next: 'SONRAKİ', retry: 'TEKRAR', home: 'ANA SAYFA', mixed: 'Karıştı!', lost: 'Çok fazla kum kaybedildi', timeout: 'Kum durdu', howTo: 'Camı çeyrek tur çevirmek için sol veya sağ tarafa dokun. Kum düşer, kayar ve dökülür. İşaretli odaları doğru kumla doldur: az dönüş, çok yıldız.', allDone: 'Tüm kaplar doldu.', shelf: 'RAF', back: 'GERİ', undo: 'Geri al', chapter: 'Bölüm {n}', hint: 'İpucu', hintGot: '+1 ipucu', newBest: 'En az dönüş!', lostSand: 'kayıp', needMore: 'gerekli', previews: 'Önizleme', noPreview: 'Önizleme kalmadı', tipDrain: 'Gider — düşen kum kaybolur', tipSieve: 'Elek — yalnızca bu renk geçer', holdTip: 'Kumun nerede duracağını görmek için döndürme düğmesini basılı tut', previewTip: 'Buradan itibaren önizleme sınırlı — her dönüş bir tane geri verir' },
  ru: { title: 'SANDGLASS', tagline: 'Два касания. Поверни сосуд. Пусть песок найдёт путь.', play: 'ИГРАТЬ', vessel: 'Сосуд {n}', turns: 'Повороты', par: 'Пар', cleared: 'Сосуд {n} заполнен', next: 'ДАЛЕЕ', retry: 'ЗАНОВО', home: 'ДОМОЙ', mixed: 'Смешалось!', lost: 'Слишком много песка потеряно', timeout: 'Песок остановился', howTo: 'Нажмите слева или справа, чтобы повернуть сосуд на четверть оборота. Песок падает, скользит и сыплется. Заполните отмеченные камеры нужным песком: меньше поворотов — больше звёзд.', allDone: 'Все сосуды заполнены.', shelf: 'ПОЛКА', back: 'НАЗАД', undo: 'Отмена', chapter: 'Глава {n}', hint: 'Подсказка', hintGot: '+1 подсказка', newBest: 'Минимум поворотов!', lostSand: 'потеряно', needMore: 'нужно', previews: 'Предпросмотр', noPreview: 'Предпросмотры закончились', tipDrain: 'Слив — попавший песок пропадает', tipSieve: 'Сито — проходит только этот цвет', holdTip: 'Удерживайте кнопку поворота, чтобы увидеть, где ляжет песок', previewTip: 'Отсюда предпросмотры ограничены — каждый поворот возвращает один' },
};
const LANGS = ['en', 'ko', 'ja', 'zh', 'es', 'pt', 'fr', 'de', 'it', 'tr', 'ru'];
const LANG_NAMES = { en: 'English', ko: '한국어', ja: '日本語', zh: '中文', es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', it: 'Italiano', tr: 'Türkçe', ru: 'Русский' };
let currentLang = (function () {
  const s = loadJSON(CONFIG.LANG_KEY, null);
  if (s && STRINGS[s]) return s;
  const nav = ((typeof navigator !== 'undefined' && navigator.language) || 'en').slice(0, 2).toLowerCase();
  return STRINGS[nav] ? nav : 'en';
})();
// ⚠️ 메서드 안에서 const t 로 가리지 말 것(TDZ 함정)
function t(key, params) {
  const table = STRINGS[currentLang] || STRINGS.en;
  let s = table[key]; if (s == null) s = STRINGS.en[key]; if (s == null) s = key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
}
function levelName(lv) { return (lv.name && (lv.name[currentLang] || lv.name.en)) || lv.id; }

// =============================================================================
// SFX (절차적 Web Audio) — 유리·황동·모래
// =============================================================================
const SFX = {
  ctx: null, master: null, _userMuted: false, _adMuted: false, _unlocked: false, _flow: null, _flowGain: null,
  _ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = CONFIG.SFX_VOLUME; const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 10; comp.attack.value = 0.003; comp.release.value = 0.16; this.master.connect(comp); comp.connect(this.ctx.destination); } catch (e) { this.ctx = null; }
    return this.ctx;
  },
  unlock() { const c = this._ensure(); if (!c) return; if (c.state === 'suspended') c.resume(); if (!this._unlocked) { try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0); this._unlocked = true; } catch (e) {} } },
  setUserMuted(m) { this._userMuted = !!m; this._applyFlow(); }, setAdMuted(m) { this._adMuted = !!m; this._applyFlow(); },
  _on() { return this.ctx && !this._userMuted && !this._adMuted; },
  _tone(o) { if (!this._on()) return; const c = this.ctx, t0 = c.currentTime + (o.delay || 0), dur = o.dur || 0.12, vol = o.vol == null ? 0.3 : o.vol, atk = o.attack || 0.006; const osc = c.createOscillator(), g = c.createGain(); osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.freq, t0); if (o.sweepTo) osc.frequency.exponentialRampToValueAtTime(o.sweepTo, t0 + dur); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + atk); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); osc.connect(g); g.connect(this.master); osc.start(t0); osc.stop(t0 + dur + 0.03); },
  _bell(freq, dur, vol, delay) { this._tone({ freq, type: 'sine', dur, vol, delay, attack: 0.004 }); this._tone({ freq: freq * 2.76, type: 'sine', dur: dur * 0.5, vol: vol * 0.22, delay, attack: 0.003 }); },
  _noise(dur, vol, delay, lp, hp) { if (!this._on()) return; const c = this.ctx, t0 = c.currentTime + (delay || 0), n = Math.floor(c.sampleRate * dur); const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n); const src = c.createBufferSource(); src.buffer = buf; const g = c.createGain(); g.gain.value = vol == null ? 0.15 : vol; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 2200; let last = f; if (hp) { const h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; f.connect(h); last = h; } src.connect(f); last.connect(g); g.connect(this.master); src.start(t0); },
  // 모래 흐름(지속 노이즈) — 이동 셀 수에 비례해 볼륨 조절
  flow(level) {
    const c = this._ensure(); if (!c) return;
    if (!this._flow) {
      const n = Math.floor(c.sampleRate * 2); const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 0.7; const g = c.createGain(); g.gain.value = 0; src.connect(f); f.connect(g); g.connect(this.master); src.start(); this._flow = src; this._flowGain = g;
    }
    this._flowTarget = clamp(level, 0, 1) * 0.16; this._applyFlow();
  },
  _applyFlow() { if (!this._flowGain) return; const v = this._on() ? (this._flowTarget || 0) : 0; this._flowGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.06); },
  turn() { this._noise(0.16, 0.14, 0, 1400, 300); this._tone({ freq: 180, sweepTo: 120, type: 'triangle', dur: 0.14, vol: 0.12 }); this._tone({ freq: 2400, type: 'sine', dur: 0.05, vol: 0.03, delay: 0.1 }); },
  settle() { this._bell(1320, 0.14, 0.05, 0); },
  drain() { this._noise(0.08, 0.05, 0, 900); },
  win() { [587, 740, 880, 1175].forEach((f, i) => this._bell(f, 0.5, 0.11, i * 0.11)); this._noise(0.6, 0.04, 0.2, 4000, 1500); },
  fail() { this._tone({ freq: 220, sweepTo: 90, type: 'sawtooth', dur: 0.4, vol: 0.1 }); this._noise(0.3, 0.1, 0, 1200); },
  button() { this._tone({ freq: 620, type: 'sine', dur: 0.05, vol: 0.1 }); },
  star(i) { this._bell(1046 * Math.pow(2, i / 12 * 3), 0.3, 0.09, 0); },
};
const MUSIC = createMusic({ getCtx: () => SFX._ensure(), song: SONGS.sandglass });

// =============================================================================
// 씬
// =============================================================================
class Game extends Phaser.Scene {
  constructor() { super('game'); }

  preload() {
    // 생성 아트(있으면 사용, 없으면 절차적 폴백 — _tex())
    this.load.image('img_bg', './assets/bg.jpg');
    this.load.image('img_frame', './assets/sprites/frame.png');
    this.load.image('img_hourglass', './assets/sprites/hourglass.png'); // 1.1b: 별·선반 아이콘
    this.load.on('loaderror', () => {});
  }

  create() {
    this.save = this._loadSave();
    SFX.setUserMuted(!!this.save.mute);
    MUSIC.setMute(!!this.save.musicMute); this.game.sound.mute = !!this.save.musicMute;
    this.state = 'title'; this.sim = null; this.levelIdx = 0; this.attempt = 0;
    this.groups = { title: [], hud: [], win: [], shelf: [] };
    this._buildTextures();
    this._buildBg();
    this._buildVessel();
    this._buildHUD();
    this._buildTitle();
    this._buildWin();
    this._buildShelf();
    this._buildInput();
    this._showTitle();
    if (QA_HOOKS) { window.__game = this.game; window.__SFX = SFX; window.__MUSIC = MUSIC; window.__GDFlow = GDFlow; window.__scene = this; }
  }

  _tex(k) { return this.textures.exists('img_' + k) ? 'img_' + k : k; }

  // ---------------------------------------------------------------------------
  // 세이브
  // ---------------------------------------------------------------------------
  _loadSave() {
    const m = loadJSON(CONFIG.SAVE_KEY, {}) || {};
    const int = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(0, n) : d; };
    const stars = (m.stars && typeof m.stars === 'object' && !Array.isArray(m.stars)) ? m.stars : {};
    const clean = {}; for (const k of Object.keys(stars)) clean[k] = clamp(int(stars[k], 0), 0, 3);
    return { unlocked: clamp(int(m.unlocked, 0), 0, LEVELS.length - 1), stars: clean, mute: !!m.mute, musicMute: !!m.musicMute, seenHow: !!m.seenHow, hints: clamp(int(m.hints, 0), 0, 99), hintBank: clamp(int(m.hintBank, 0), 0, 99), seenHold: !!m.seenHold, seenDrain: !!m.seenDrain, seenSieve: !!m.seenSieve, seenBudget: !!m.seenBudget };
  }
  _save() { saveJSON(CONFIG.SAVE_KEY, this.save); }
  _cleared() { return LEVELS.filter((l) => this.save.stars[l.id]).length; } // 현재 레벨 id 만(이전 버전 세이브 무시)

  // ---------------------------------------------------------------------------
  // 텍스처(절차적)
  // ---------------------------------------------------------------------------
  _makeCanvas(key, w, h, draw) { if (this.textures.exists(key)) return; const tex = this.textures.createCanvas(key, w, h); draw(tex.getContext(), w, h); tex.refresh(); }
  _buildTextures() {
    this._makeCanvas('glow', 256, 256, (ctx, w, h) => { const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.5)'); g.addColorStop(0.7, 'rgba(255,255,255,0.1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
    this._makeCanvas('dot', 16, 16, (ctx) => { const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 16); });
    // 배경: 어두운 서재 + 촛불빛 워시 + 선반 실루엣
    this._makeCanvas('bg', 540, 960, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, css(PAL.bg0)); g.addColorStop(1, css(PAL.bg1)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const r = ctx.createRadialGradient(w / 2, h * 0.55, 20, w / 2, h * 0.55, 520); r.addColorStop(0, 'rgba(255,180,102,0.16)'); r.addColorStop(1, 'rgba(255,180,102,0)'); ctx.fillStyle = r; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#120c09'; ctx.fillRect(0, 0, w, 70); ctx.fillRect(0, h - 60, w, 60);
      ctx.fillStyle = '#2a1b12'; for (let i = 0; i < 6; i++) { const x = 20 + i * 90, hh = 60 + (i * 37) % 50; ctx.fillRect(x, 70 - hh + 60, 40 + (i * 13) % 30, hh - 60); }
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, h - 62, w, 4);
    });
    // 그릇 프레임(황동 + 유리) 절차 폴백
    const V = CONFIG.VESSEL, P = 26; // 패딩(테두리 두께 포함)
    this._makeCanvas('frame', V + P * 2, V + P * 2, (ctx, w, h) => {
      const rr = (x, y, ww, hh, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + ww, y, x + ww, y + hh, r); ctx.arcTo(x + ww, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + ww, y, r); ctx.closePath(); };
      // 바깥 그림자
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 24; ctx.fillStyle = '#2a1a0c'; rr(10, 10, w - 20, h - 20, 34); ctx.fill(); ctx.shadowBlur = 0;
      // 황동 테두리
      const bg = ctx.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#e2b45a'); bg.addColorStop(0.5, '#8d6324'); bg.addColorStop(1, '#d8a84a');
      ctx.fillStyle = bg; rr(10, 10, w - 20, h - 20, 34); ctx.fill();
      ctx.fillStyle = '#4a3214'; rr(P - 4, P - 4, V + 8, V + 8, 18); ctx.fill();
      // 유리(안쪽은 투명 — 모래가 비침)
      ctx.clearRect(P, P, V, V);
      ctx.fillStyle = 'rgba(220,239,242,0.07)'; ctx.fillRect(P, P, V, V);
      const hl = ctx.createLinearGradient(P, P, P + V, P + V); hl.addColorStop(0, 'rgba(255,255,255,0.22)'); hl.addColorStop(0.18, 'rgba(255,255,255,0.04)'); hl.addColorStop(0.5, 'rgba(255,255,255,0)'); hl.addColorStop(0.82, 'rgba(255,255,255,0.03)'); hl.addColorStop(1, 'rgba(255,255,255,0.14)');
      ctx.fillStyle = hl; ctx.fillRect(P, P, V, V);
      // 리벳
      for (const [x, y] of [[22, 22], [w - 22, 22], [22, h - 22], [w - 22, h - 22]]) { const rg = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 7); rg.addColorStop(0, '#ffe4a8'); rg.addColorStop(1, '#6a4a1a'); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); }
    });
    // 모래 노이즈 오버레이(알갱이 느낌)
    this._makeCanvas('grain', 128, 128, (ctx, w, h) => { const img = ctx.createImageData(w, h); for (let i = 0; i < img.data.length; i += 4) { const v = 200 + Math.random() * 55; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255; } ctx.putImageData(img, 0, 0); });
  }
  _buildBg() {
    // 1.2e: 가로 iframe — 양옆에 공방 배경을 넓게 깔고(어둡게) 기둥 가장자리는 부드럽게
    // 1.2f: 양옆은 같은 배경을 좌우 반전해 이어 붙인다(장면이 계속되는 느낌 — '흐린 띠' 지적)
    this.sideL = this.add.image(0, H / 2, this._tex('bg')).setOrigin(1, 0.5).setFlipX(true).setDisplaySize(W, H).setDepth(DEPTH.BG - 2).setTint(0xa09080).setVisible(false);
    this.sideR = this.add.image(W, H / 2, this._tex('bg')).setOrigin(0, 0.5).setFlipX(true).setDisplaySize(W, H).setDepth(DEPTH.BG - 2).setTint(0xa09080).setVisible(false);
    this.sideDim = this.add.rectangle(W / 2, H / 2, W, H, 0x120b07, 0.3).setDepth(DEPTH.BG - 1.5).setVisible(false);
    this._makeCanvas('edgefade', 48, 8, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(10,6,4,0.55)'); g.addColorStop(1, 'rgba(10,6,4,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
    this.edgeL = this.add.image(0, H / 2, 'edgefade').setOrigin(0, 0.5).setDisplaySize(48, H).setDepth(DEPTH.BG + 0.5).setVisible(false);
    this.edgeR = this.add.image(W, H / 2, 'edgefade').setOrigin(1, 0.5).setDisplaySize(48, H).setFlipX(true).setDepth(DEPTH.BG + 0.5).setVisible(false);
    this.bg = this.add.image(W / 2, H / 2, this._tex('bg')).setDisplaySize(W, H).setDepth(DEPTH.BG);
    this.vignette = this.add.image(W / 2, H / 2, 'glow').setDisplaySize(W * 1.9, H * 1.6).setTint(0x000000).setAlpha(0).setDepth(DEPTH.BG + 1);
  }
  // 1.2e: 가로 iframe 이면 논리 폭을 부모 비율에 맞춰 넓히고(FIT 이 꽉 채움) 카메라를 밀어 540 기둥을 가운데 둔다.
  //       회전 다이얼·되돌리기·힌트·미리보기는 그릇 양옆으로 — 데스크톱에서 "세로 기둥만 쓰는 게임"으로 보이지 않게
  _layoutTick(time) {
    if (time - (this._layoutT || 0) < 250) return; this._layoutT = time;
    const ps = this.scale.parentSize; if (!ps || !ps.width || !ps.height) return;
    const want = Math.max(W, Math.min(MAX_GW, Math.round(H * ps.width / ps.height / 2) * 2));
    if (Math.abs(want - this.scale.gameSize.width) < 4) return;
    this.scale.setGameSize(want, H); this._applyLayout();
  }
  _applyLayout() {
    const gw = this.scale.gameSize.width; const land = gw >= W + 120; this.landscape = land;
    this.cameras.main.setScroll(-(gw - W) / 2, 0);
    const wide = gw > W + 2; // 1.2j: 조금만 넓어도(2:3 등) 양옆 배경을 깐다 — 검은 띠 방지. 조작부 재배치는 land 일 때만
    this.sideL.setVisible(wide); this.sideR.setVisible(wide); this.sideDim.setVisible(wide).setSize(gw + 8, H).setPosition(W / 2, H / 2);
    this.edgeL.setVisible(wide); this.edgeR.setVisible(wide);
    const Y = CONFIG.VESSEL_Y; const px = Math.min(300, gw / 2 - 86);
    if (land && px > 240) {
      this.btnL.moveTo(W / 2 - px, Y - 40); this.btnR.moveTo(W / 2 + px, Y - 40);
      this.btnUndo.moveTo(W / 2 - px, Y + 36); this.hintBtn.moveTo(W / 2 - px, Y + 86); this.previewBtn.moveTo(W / 2 + px, Y + 36);
    } else { for (const b of [this.btnL, this.btnR, this.btnUndo, this.hintBtn, this.previewBtn]) b.moveTo(b.homeX, b.homeY); }
    if (this.howHint) this.howHint.setY(land && px > 240 ? H - 120 : H - 200);
  }

  // ---------------------------------------------------------------------------
  // 그릇(컨테이너) — 벽 텍스처 · 모래 캔버스 · 목표/배수구 오버레이 · 프레임
  // ---------------------------------------------------------------------------
  _buildVessel() {
    const V = CONFIG.VESSEL;
    this.vessel = this.add.container(W / 2, CONFIG.VESSEL_Y).setDepth(DEPTH.VESSEL);
    this.sandTex = this.textures.createCanvas('sandtex', V, V); this.sandCtx = this.sandTex.getContext();
    this.wallTex = this.textures.createCanvas('walltex', V, V); this.wallCtx = this.wallTex.getContext();
    this.wallImg = this.add.image(0, 0, 'walltex');
    this.sandImg = this.add.image(0, 0, 'sandtex');
    this.grainImg = this.add.image(0, 0, 'grain').setDisplaySize(V, V).setAlpha(0.14).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.targetGfx = this.add.graphics();
    // 1.2d: 유리 반사광 — 왼쪽 위에서 오른쪽 아래로 가는 두 줄의 옅은 사선 + 모서리 하이라이트(모래 위에 얹혀 '유리판 뒤의 모래'로 읽힘)
    this.sheenTex = this.textures.createCanvas('sheentex', V, V); const sc = this.sheenTex.getContext();
    const band = (x0, w, a) => { const g = sc.createLinearGradient(x0, 0, x0 + w, V); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,250,240,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)'); sc.fillStyle = g; sc.beginPath(); sc.moveTo(x0, 0); sc.lineTo(x0 + w, 0); sc.lineTo(x0 + w - V, V); sc.lineTo(x0 - V, V); sc.closePath(); sc.fill(); };
    band(V * 0.55, V * 0.22, 0.09); band(V * 0.86, V * 0.08, 0.07);
    const eg = sc.createLinearGradient(0, 0, V * 0.25, V * 0.25); eg.addColorStop(0, 'rgba(255,255,255,0.10)'); eg.addColorStop(1, 'rgba(255,255,255,0)'); sc.fillStyle = eg; sc.fillRect(0, 0, V, V);
    this.sheenTex.refresh(); this.sheenImg = this.add.image(0, 0, 'sheentex');
    // 1.2e: 정지 결과 미리보기(유령 모래) 캔버스 — 회전 버튼을 누르고 있는 동안만 보인다
    this.ghostTex = this.textures.createCanvas('ghosttex', V, V); this.ghostCtx = this.ghostTex.getContext();
    this.ghostImg = this.add.image(0, 0, 'ghosttex').setVisible(false);
    // 1.2e: 배수구 소용돌이(돌아가는 스프라이트) — 정적 보라 테두리는 폰에서 '구멍'으로 안 읽혔음
    this._makeCanvas('swirl', 96, 96, (ctx) => {
      const cx = 48, cy = 48; const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 46); g.addColorStop(0, '#000000'); g.addColorStop(0.45, '#120a1f'); g.addColorStop(0.8, 'rgba(110,80,170,0.55)'); g.addColorStop(1, 'rgba(110,80,170,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 46, 0, Math.PI * 2); ctx.fill();
      ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) { ctx.beginPath(); for (let a = 0; a <= 3.0; a += 0.12) { const rr = 42 - a * 12, ang = a * 1.9 + k * 2.094; const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr; if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.strokeStyle = 'rgba(205,180,255,0.9)'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.fillStyle = '#05030a'; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
    });
    this.drainSprs = [];
    this.frameImg = this.add.image(0, 0, this._tex('frame'));
    // 생성 프레임(sprites/frame.png 640²): 안쪽 구멍 491.6×485.8 → 격자 432 가 구멍보다 8px 작게 들어가도록 스케일(가장자리 가림)
    if (this.frameImg.texture.key === 'img_frame') this.frameImg.setDisplaySize(573, 580).setPosition(-2, -1);
    this.vessel.add([this.wallImg, this.sandImg, this.grainImg, this.ghostImg, this.targetGfx, this.sheenImg, this.frameImg]);
    this.vessel.setVisible(false);
    this.visAngle = 0;
    // 모래 색 팔레트(셀 해시로 3단 명암)
    this._sandCss = PAL.sand.map((arr) => (arr ? arr.map(css) : null));
    const mix = (a, b, t) => { const ca = Phaser.Display.Color.IntegerToColor(a), cb = Phaser.Display.Color.IntegerToColor(b); return css(Phaser.Display.Color.GetColor(Math.round(ca.red + (cb.red - ca.red) * t), Math.round(ca.green + (cb.green - ca.green) * t), Math.round(ca.blue + (cb.blue - ca.blue) * t))); };
    this._sandTones = PAL.sand.map((arr) => (arr ? [css(arr[0]), mix(arr[0], arr[1], 0.5), css(arr[1]), mix(arr[1], arr[2], 0.5), css(arr[2]), mix(arr[0], 0xffffff, 0.45)] : null));
    this._goldTones = ['#f3cf5a', '#e2b43a', '#ffe27a', '#c9962a', '#fff0b0', '#fffbe0']; // 1.2b: 클리어 시 목표 방 모래가 금으로
  }
  _drawWalls() {
    const ctx = this.wallCtx, V = CONFIG.VESSEL, g = this.sim.grid, cs = CELL_PX;
    const wp = this.state === 'title' ? CHAPTERS[0] : CHAPTERS[chapterOf(this.levelIdx)]; // 1.2: 장별 벽 재질
    ctx.clearRect(0, 0, V, V);
    // 1.2d: 유리 너머로 공방 배경이 흐릿하게 비친다(배경을 아주 작게 그렸다가 키워 블러) → 빈 방이 "검은 회로도"가 아니라 유리 그릇으로 읽히게
    const bgSrc = this.textures.exists('img_bg') ? this.textures.get('img_bg').getSourceImage() : null;
    if (bgSrc && bgSrc.width) {
      const sx = bgSrc.width / W, sy = bgSrc.height / H, vx = (W / 2 - V / 2) * sx, vy = (CONFIG.VESSEL_Y - V / 2) * sy;
      if (!this._bgBlur) { const c = document.createElement('canvas'); c.width = 24; c.height = 24; this._bgBlur = c; }
      const bc = this._bgBlur.getContext('2d'); bc.imageSmoothingEnabled = true; bc.drawImage(bgSrc, vx, vy, V * sx, V * sy, 0, 0, 24, 24);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.globalAlpha = 0.85; ctx.drawImage(this._bgBlur, -V * 0.08, -V * 0.08, V * 1.16, V * 1.16); ctx.globalAlpha = 1;
    }
    // 1.2b: 방 안쪽은 유리 음영(가장자리로 갈수록 어둡게)
    const rg = ctx.createRadialGradient(V / 2, V / 2, V * 0.1, V / 2, V / 2, V * 0.75);
    rg.addColorStop(0, (wp.glass || 'rgba(255,240,210,0.07)').replace(/0\.\d+\)$/, '0.20)')); rg.addColorStop(1, 'rgba(0,0,0,0.22)'); // 1.2i: 장별 유리 색을 2배로 ctx.fillStyle = rg; ctx.fillRect(0, 0, V, V);
    ctx.fillStyle = 'rgba(8,6,10,0.10)'; ctx.fillRect(0, 0, V, V); // 모래·목표 대비 유지용 어둠
    if (this.frameImg && this.frameImg.setTint) this.frameImg.setTint(wp.frame || 0xffffff); // 장별 액자 색조
    const isW = (x, y) => x >= 0 && y >= 0 && x < N && y < N && g[y * N + x] === CELL.WALL;
    // 1.2h: 유리 칸 — 벽이 아닌 셀의 연결 영역(방)마다 bbox 에 유리 상자 음영(왼쪽 위 하이라이트 → 투명, 안쪽 1px 테두리, 오른쪽 아래 어둠) → '회로도'가 아니라 유리 상자 묶음으로
    { const seen = new Uint8Array(N * N); const stack = [];
      for (let y0 = 1; y0 < N - 1; y0++) for (let x0 = 1; x0 < N - 1; x0++) {
        const i0 = y0 * N + x0; if (seen[i0] || g[i0] === CELL.WALL) continue;
        let bx0 = x0, by0 = y0, bx1 = x0, by1 = y0, n = 0; stack.push(i0); seen[i0] = 1;
        while (stack.length) { const i = stack.pop(); const x = i % N, y = (i / N) | 0; n++; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; for (const j of [i - 1, i + 1, i - N, i + N]) { if (j < 0 || j >= N * N || seen[j] || g[j] === CELL.WALL) continue; const jx = j % N; if (Math.abs(jx - x) > 1) continue; seen[j] = 1; stack.push(j); } }
        if (n < 6) continue;
        const px = bx0 * cs, py = by0 * cs, pw = (bx1 - bx0 + 1) * cs, ph = (by1 - by0 + 1) * cs;
        const gl = ctx.createLinearGradient(px, py, px + pw * 0.7, py + ph * 0.7); gl.addColorStop(0, 'rgba(255,255,255,0.11)'); gl.addColorStop(0.55, 'rgba(255,255,255,0.02)'); gl.addColorStop(1, 'rgba(0,0,0,0.10)');
        ctx.fillStyle = gl; ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3);
      } }
    const dark = css(wp.wallDark), mid = css(wp.wall);
    const lite = wp.edge;
    // 1.2e: 1차 — 벽 셀을 사방 WALL_E 만큼 넓힌 어두운 바탕(파이프 두께 10.8 → 16.8px). 모래 층이 위라 빈칸 쪽으로만 넓어 보인다
    //       (1px 어두운 윤곽 + 2px 중간색 테 + 가운데 기존 그라데이션 — 반투명 하이라이트가 겹치면 점선처럼 보여서 셀끼리 겹치지 않게)
    ctx.fillStyle = dark;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y * N + x] === CELL.WALL) ctx.fillRect(x * cs - WALL_E, y * cs - WALL_E, cs + WALL_E * 2, cs + WALL_E * 2);
    ctx.fillStyle = mid;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y * N + x] === CELL.WALL) ctx.fillRect(x * cs - WALL_E + 1, y * cs - WALL_E + 1, cs + WALL_E * 2 - 2, cs + WALL_E * 2 - 2);
    ctx.save();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = g[y * N + x];
      if (c === CELL.WALL) {
        const px = x * cs, py = y * cs;
        // 파이프: 세로 이웃이면 세로 그라데이션(왼쪽 밝음), 가로 이웃이면 가로(위 밝음). 둘 다면 마디(짙게)
        const vert = isW(x, y - 1) || isW(x, y + 1), horz = isW(x - 1, y) || isW(x + 1, y);
        // 45° 선(2셀 두께)은 세로 이웃이 1개뿐이고 긴 직선 런이 없다 → 대각선 셀로 판정(구슬 줄 방지)
        const diagN = isW(x - 1, y - 1) || isW(x + 1, y + 1) || isW(x - 1, y + 1) || isW(x + 1, y - 1);
        const longRun = (isW(x, y - 1) && isW(x, y - 2)) || (isW(x, y + 1) && isW(x, y + 2)) || (isW(x - 1, y) && isW(x - 2, y)) || (isW(x + 1, y) && isW(x + 2, y));
        const diag = diagN && !longRun;
        if (diag) { ctx.fillStyle = mid; ctx.fillRect(px - 0.3, py - 0.3, cs + 1.2, cs + 1.2); continue; } // 45° 선: 셀마다 그라데이션을 넣으면 톱니처럼 보여서 평평하게(경사 삼각형과 이어짐)
        let gr;
        if (vert && !horz) { gr = ctx.createLinearGradient(px, 0, px + cs, 0); }
        else if (horz && !vert) { gr = ctx.createLinearGradient(0, py, 0, py + cs); }
        else { gr = ctx.createLinearGradient(px, py, px + cs, py + cs); }
        gr.addColorStop(0, dark); gr.addColorStop(0.22, lite); gr.addColorStop(0.5, mid); gr.addColorStop(1, dark);
        ctx.fillStyle = gr; ctx.fillRect(px, py, cs + 0.6, cs + 0.6);
        // 끝단(틈 옆): 파이프 입구를 둥근 마디로
        const thick = vert && horz && diagN; // 1.2d: 두 칸 이상 두께의 벽판 — 마디·끝단 없이 매끈하게(이전엔 셀마다 끝단 구슬이 찍혔음)
        const endL = !isW(x - 1, y) && horz && !vert, endR = !isW(x + 1, y) && horz && !vert, endT = !isW(x, y - 1) && vert && !horz, endB = !isW(x, y + 1) && vert && !horz;
        if (thick) { // 매끈한 벽판: 바탕색 + 바깥쪽 모서리에만 밝은/어두운 빗면
          ctx.fillStyle = mid; ctx.fillRect(px, py, cs + 0.6, cs + 0.6);
          ctx.fillStyle = lite; if (!isW(x, y - 1)) ctx.fillRect(px, py, cs + 0.6, 2.2); if (!isW(x - 1, y)) ctx.fillRect(px, py, 2.2, cs + 0.6);
          ctx.fillStyle = dark; if (!isW(x, y + 1)) ctx.fillRect(px, py + cs - 2, cs + 0.6, 2.6); if (!isW(x + 1, y)) ctx.fillRect(px + cs - 2, py, 2.6, cs + 0.6);
          continue;
        }
        else if (endL || endR || endT || endB) { ctx.fillStyle = dark; ctx.fillRect(px, py, cs + 0.6, cs + 0.6); ctx.fillStyle = lite; ctx.beginPath(); ctx.arc(px + cs / 2, py + cs / 2, cs * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = mid; ctx.beginPath(); ctx.arc(px + cs / 2, py + cs / 2, cs * 0.3, 0, Math.PI * 2); ctx.fill(); }
        else if (vert && horz) { ctx.fillStyle = dark; ctx.fillRect(px + 1, py + 1, cs - 2, cs - 2); ctx.fillStyle = lite; ctx.fillRect(px + cs * 0.3, py + cs * 0.3, cs * 0.4, cs * 0.4); }
      } else if (c === CELL.DRAIN) {
        ctx.fillStyle = css(PAL.drain); ctx.fillRect(x * cs, y * cs, cs + 0.6, cs + 0.6);
      }
    }
    ctx.restore(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 1.2f: 45° 벽(깔때기 선)의 계단도 삼각형으로 메운다 — 빈 칸의 직교 이웃 둘 + 대각 이웃이 벽이면 그 모서리 절반(모래 층 아래라 모래가 있으면 가려짐)
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      if (g[y * N + x] === CELL.WALL) continue;
      const px = x * cs, py = y * cs;
      for (const [dx, dy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        if (!(isW(x + dx, y) && isW(x, y + dy) && isW(x + dx, y + dy))) continue;
        const cx = dx < 0 ? px : px + cs, cy = dy < 0 ? py : py + cs;
        ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(dx < 0 ? px + cs : px, cy); ctx.lineTo(cx, dy < 0 ? py + cs : py); ctx.closePath(); ctx.fill();
        ctx.fillStyle = mid; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(dx < 0 ? px + cs - 2 : px + 2, cy); ctx.lineTo(cx, dy < 0 ? py + cs - 2 : py + 2); ctx.closePath(); ctx.fill();
      }
    }
    // 1.2c: 체(한 색만 통과) — 통과 색의 고운 그물. 가장자리에 작은 황동 못
    const sv = this.sim.sieve;
    if (sv) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const col = sv[y * N + x]; if (!col) continue;
      const c0 = PAL.sand[col];
      // 그물은 틈 셀 + 양옆 빈 셀까지 3칸 폭으로(시뮬 무관, 모래 아래 레이어) — 1셀 그물은 폰에서 안 보였음
      const horiz = sv[y * N + x - 1] || sv[y * N + x + 1]; // 가로 틈이면 위아래로, 세로 틈이면 좌우로 넓힘
      for (let k = -1; k <= 1; k++) {
        const xx = horiz ? x : x + k, yy = horiz ? y + k : y; if (k !== 0 && g[yy * N + xx] !== CELL.EMPTY) continue;
        const px = xx * cs, py = yy * cs; const a = k === 0 ? 1 : 0.55;
        ctx.fillStyle = `rgba(0,0,0,${0.35 * a})`; ctx.fillRect(px, py, cs + 0.6, cs + 0.6);
        ctx.strokeStyle = css(c0[2]); ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9 * a;
        for (let q = 2; q < cs; q += 3.5) { ctx.beginPath(); ctx.moveTo(px + q, py); ctx.lineTo(px + q, py + cs); ctx.stroke(); ctx.beginPath(); ctx.moveTo(px, py + q); ctx.lineTo(px + cs, py + q); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      const px = x * cs, py = y * cs;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => g[(y + dy) * N + x + dx] === CELL.WALL);
      ctx.fillStyle = css(PAL.brass); for (const [dx, dy] of nb) ctx.fillRect(px + cs / 2 - 1.5 + dx * cs * 0.32, py + cs / 2 - 1.5 + dy * cs * 0.32, 3, 3);
    }
    // 배수구 림(보라) — 사각형 단위로
    // 1.1: 배수구 = 보라빛 테가 도는 검은 소용돌이(작은 사각 테두리는 "구멍"으로 안 읽혔음)
    // 1.2e: 배수구 = 캔버스에 검은 구멍(1.5배) + 그 위에 돌아가는 소용돌이 스프라이트(_syncDrains)
    for (const d of this.sim.level.drains || []) {
      const cx = (d.x + d.w / 2) * cs, cy = (d.y + d.h / 2) * cs, R = Math.max(d.w, d.h) * cs * 1.5;
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      gr.addColorStop(0, '#000000'); gr.addColorStop(0.55, '#0a0612'); gr.addColorStop(0.85, 'rgba(90,60,150,0.6)'); gr.addColorStop(1, 'rgba(90,60,150,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    }
    this.wallTex.refresh();
    this._syncDrains();
  }
  // 배수구 소용돌이 스프라이트를 현재 레벨에 맞게 다시 만든다(그릇 컨테이너 안, 액자 아래)
  _syncDrains() {
    for (const s of this.drainSprs || []) s.destroy(); this.drainSprs = [];
    if (!this.sim) return;
    const cs = CELL_PX, V = CONFIG.VESSEL;
    for (const d of this.sim.level.drains || []) {
      const cx = (d.x + d.w / 2) * cs - V / 2, cy = (d.y + d.h / 2) * cs - V / 2, D = Math.max(d.w, d.h) * cs * 2.9;
      const sp = this.add.image(cx, cy, 'swirl').setDisplaySize(D, D).setAlpha(0.95);
      this.vessel.add(sp); this.vessel.moveBelow(sp, this.frameImg); this.drainSprs.push(sp);
    }
  }
  _drawSand(time) {
    const ctx = this.sandCtx, V = CONFIG.VESSEL, g = this.sim.grid, cs = CELL_PX;
    ctx.clearRect(0, 0, V, V);
    // 1.1b: 셀 하나를 3×3 알갱이로(명암 5단 + 셀 해시로 고정 → 깜빡임 없음). 중력 반대편이 비어 있으면 그 면을 밝게(더미 윤곽)
    // 1.2e: 정지 중엔 time 에 따라 알갱이 몇 개가 반짝인다(대기 반짝임 — 정지 화면이 죽어 보이지 않게)
    const q = cs / 3; const [gx, gy] = GRAV[this.sim.g]; const sparkT = time == null ? -1 : Math.floor(time / 110);
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const c = g[y * N + x];
      if (c < CELL.SAND1 || c > CELL.SAND3) continue;
      let pal = this._sandTones[c - 1]; let hh = (x * 73856093) ^ (y * 19349663);
      if (this._goldT > 0 && this._goldMask && this._goldMask[y * N + x] && (hh >>> 4) % 100 < this._goldT * 100) pal = this._goldTones;
      const px = x * cs, py = y * cs;
      for (let k = 0; k < 9; k++) { hh = (hh * 1103515245 + 12345) & 0x7fffffff; ctx.fillStyle = pal[(hh >> 8) % 5]; ctx.fillRect(px + (k % 3) * q, py + ((k / 3) | 0) * q, q + 0.45, q + 0.45); }
      if (((hh >> 5) % 5) === 0) { const sk = (hh >> 9) % 9; ctx.fillStyle = pal[5]; ctx.fillRect(px + (sk % 3) * q + q * 0.3, py + ((sk / 3) | 0) * q + q * 0.3, q * 0.45, q * 0.45); } // 1.2i: 발광 알갱이(5셀에 1개)
      if (sparkT >= 0 && (((hh ^ (sparkT * 2654435761)) >>> 0) % 48) === 0) { ctx.fillStyle = '#fffaf0'; const sk = ((hh >> 3) % 9); ctx.fillRect(px + (sk % 3) * q, py + ((sk / 3) | 0) * q, q + 0.45, q + 0.45); }
      const up = g[(y - gy) * N + (x - gx)];
      if (up === CELL.EMPTY) { // 표면: 위쪽(중력 반대) 가장자리를 밝게(1.2h: 더 두껍게 — 더미에 림라이트)
        ctx.fillStyle = pal[5];
        if (gy !== 0) ctx.fillRect(px, gy > 0 ? py : py + cs - q * 1.1, cs, q * 1.1); else ctx.fillRect(gx > 0 ? px : px + cs - q * 1.1, py, q * 1.1, cs);
      }
      const dn = g[(y + gy) * N + (x + gx)];
      if (dn === CELL.WALL) { ctx.fillStyle = 'rgba(40,20,0,0.22)'; if (gy !== 0) ctx.fillRect(px, gy > 0 ? py + cs - q : py, cs, q); else ctx.fillRect(gx > 0 ? px + cs - q : px, py, q, cs); } // 바닥 쪽은 그늘
    }
    // 1.2f: 45° 경사의 계단을 삼각형으로 메운다 — 빈 칸의 직교 이웃 둘 + 대각 이웃이 같은 색 모래면 그 모서리 절반을 채움('레고 계단' 지적, 시뮬 무관)
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      if (g[y * N + x] !== CELL.EMPTY) continue;
      const px = x * cs, py = y * cs;
      for (const [dx, dy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
        const a = g[y * N + x + dx], b = g[(y + dy) * N + x], d = g[(y + dy) * N + x + dx];
        if (!isSand(a) || a !== b || a !== d) continue;
        const pal = (this._goldT > 0 && this._goldMask && this._goldMask[(y + dy) * N + x]) ? this._goldTones : this._sandTones[a - 1]; ctx.fillStyle = pal[1];
        const cx = dx < 0 ? px : px + cs, cy = dy < 0 ? py : py + cs;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(dx < 0 ? px + cs : px, cy); ctx.lineTo(cx, dy < 0 ? py + cs : py); ctx.closePath(); ctx.fill();
      }
    }
    this.sandTex.refresh();
  }
  _drawTargets(time) {
    const g = this.targetGfx; g.clear();
    if (!this.sim) return;
    const cs = CELL_PX, V = CONFIG.VESSEL;
    for (const tg of this.sim.level.targets || []) {
      const have = countIn(this.sim, tg, tg.color); const met = have >= tg.min;
      const col = met ? PAL.targetMet : PAL.sand[tg.color][2];
      const x0 = tg.x * cs - V / 2, y0 = tg.y * cs - V / 2, w = tg.w * cs, h = tg.h * cs;
      // 1.1: 목표 방은 그 색으로 옅게 채워 한눈에(미로에선 방이 많아 점선만으론 안 보였음) + 진한 점선 테두리
      g.fillStyle(PAL.sand[tg.color][1], met ? 0.1 : 0.14 + Math.sin((time || 0) / 420) * 0.04); g.fillRect(x0, y0, w, h);
      // 1.1b: 아직 덜 찬 목표 방엔 그 색 빗금(어두운 그릇 안에서도 '여기로'가 보이게)
      if (!met) { g.lineStyle(2, PAL.sand[tg.color][0], 0.22); const step = 16; for (let k = -h; k < w; k += step) { const ax = x0 + Math.max(0, k), ay = y0 + Math.max(0, -k); const len = Math.min(w - Math.max(0, k), h - Math.max(0, -k)); if (len > 0) g.lineBetween(ax, ay, ax + len, ay + len); } }
      g.lineStyle(2.5, col, met ? 0.95 : 0.85);
      const dash = 8, gap = 6, per = dash + gap; const off = ((time || 0) / 40) % per;
      const edges = [[x0, y0, x0 + w, y0], [x0 + w, y0, x0 + w, y0 + h], [x0 + w, y0 + h, x0, y0 + h], [x0, y0 + h, x0, y0]];
      for (const [ax, ay, bx, by] of edges) { const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L; for (let p = off; p < L; p += per) { const e = Math.min(L, p + dash); g.lineBetween(ax + ux * p, ay + uy * p, ax + ux * e, ay + uy * e); } }
      if (met) { g.fillStyle(col, 0.08 + Math.sin((time || 0) / 200) * 0.03); g.fillRect(x0, y0, w, h); }
    }
    // 1.2e: 체 그물 반짝임 — 통과 색으로 틈 테두리가 숨 쉬듯 밝아진다(정적 그물은 폰에서 벽과 구분이 안 됐음)
    for (const r of this.sim.level.sieves || []) {
      const c0 = PAL.sand[r.color || 1]; const a = 0.35 + (Math.sin((time || 0) / 230) + 1) * 0.3;
      const x0 = r.x * cs - V / 2, y0 = r.y * cs - V / 2, w = r.w * cs, h = r.h * cs; const horiz = r.w >= r.h;
      g.lineStyle(2.5, c0[2], a); g.strokeRect(x0 - (horiz ? 0 : cs), y0 - (horiz ? cs : 0), w + (horiz ? 0 : cs * 2), h + (horiz ? cs * 2 : 0));
      g.fillStyle(c0[2], a * 0.25); g.fillRect(x0, y0, w, h);
    }
  }
  // 목표 게이지(HUD 쪽, 그릇 회전과 무관하게 읽히도록 화면 좌표)
  _refreshGauges() {
    if (!this.sim) return;
    const parts = [];
    (this.sim.level.targets || []).forEach((tg, i) => { const have = countIn(this.sim, tg, tg.color); parts.push({ have, min: tg.min, color: tg.color, met: have >= tg.min }); });
    this.gaugeGfx.clear();
    const n = parts.length, bw = Math.min(160, (W - 60) / n - 10), bh = 14, y = CONFIG.HUD_H + 10;
    parts.forEach((p, i) => {
      const x = W / 2 - (n * (bw + 10) - 10) / 2 + i * (bw + 10);
      this.gaugeGfx.fillStyle(0x000000, 0.45); this.gaugeGfx.fillRoundedRect(x, y, bw, bh, 7);
      const f = clamp(p.have / p.min, 0, 1);
      this.gaugeGfx.fillStyle(p.met ? PAL.targetMet : PAL.sand[p.color][0], 1); if (f > 0) this.gaugeGfx.fillRoundedRect(x + 2, y + 2, Math.max(6, (bw - 4) * f), bh - 4, 5);
      this.gaugeGfx.lineStyle(1.5, p.met ? PAL.targetMet : PAL.sand[p.color][2], 0.9); this.gaugeGfx.strokeRoundedRect(x, y, bw, bh, 7);
      let txt = this.gaugeTxts[i];
      if (!txt) { txt = this.gaugeTxts[i] = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '12px', color: css(PAL.text), fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH.HUD + 1); this.groups.hud.push(txt); }
      txt.setPosition(x + bw / 2, y + bh / 2 + 1).setText(`${p.have}/${p.min}`).setVisible(true);
    });
    for (let i = parts.length; i < this.gaugeTxts.length; i++) this.gaugeTxts[i].setVisible(false);
    // 유실 표시
    const lost = this.sim.lost.slice(2).reduce((a, b) => a + b, 0);
    this.lostTxt.setText(lost ? `${t('lostSand')} ${lost}` : '').setVisible(this.state === 'playing' && lost > 0);
  }

  // ---------------------------------------------------------------------------
  // 공용 UI
  // ---------------------------------------------------------------------------
  _fitText(txt, maxW) { const base = txt._base || parseInt(txt.style.fontSize, 10) || 22; let s = base; txt.setFontSize(s); while (txt.width > maxW && s > 9) { s -= 1; txt.setFontSize(s); } }
  _button(x, y, w, h, label, onClick, opts = {}) {
    const c = this.add.container(x, y).setDepth(opts.depth || DEPTH.HUD);
    const g = this.add.graphics();
    const tint = opts.tint == null ? PAL.gold : opts.tint; const gold = tint === PAL.gold;
    g.fillStyle(0x000000, 0.45); g.fillRoundedRect(-w / 2 + 2, -h / 2 + 6, w, h, 14);
    if (gold) {
      g.fillGradientStyle(0xf0c35a, 0xf0c35a, 0xb0801f, 0xb0801f, 1); g.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
      g.fillStyle(0xffffff, 0.18); g.fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h * 0.42, 10);
      g.lineStyle(2, 0x4a3010, 0.9); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
      g.lineStyle(1, 0xfff0c0, 0.5); g.strokeRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 11);
    } else {
      g.fillGradientStyle(0x3a2a1d, 0x3a2a1d, 0x1f1510, 0x1f1510, 1); g.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
      g.lineStyle(2, PAL.brass, 0.7); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
      g.fillStyle(0xffffff, 0.06); g.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h * 0.4, 10);
    }
    const txt = this.add.text(0, 0, label, { fontFamily: opts.font || FONT, fontSize: (opts.fontSize || 26) + 'px', color: opts.color || css(PAL.ink), fontStyle: 'bold' }).setOrigin(0.5);
    txt._base = opts.fontSize || 26; this._fitText(txt, w - 20);
    c.add([g, txt]); c.txt = txt;
    const z = this.add.zone(x, y, w, h).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth((opts.depth || DEPTH.HUD) + 1);
    z.on('pointerdown', () => { if (!c.visible || GDFlow.isBlocking()) return; this.tweens.add({ targets: c, scaleX: 0.95, scaleY: 0.95, duration: 60, yoyo: true }); });
    z.on('pointerup', () => { if (!c.visible || GDFlow.isBlocking()) return; SFX.button(); onClick(); });
    c.zone = z; c.c = c; c.setVis = (v) => { c.setVisible(v); z.setVisible(v); if (v) z.setInteractive(); else z.disableInteractive(); };
    c.moveTo = (nx, ny) => { c.setPosition(nx, ny); z.setPosition(nx, ny); }; c.homeX = x; c.homeY = y; // 1.2e: 가로 배치용
    if (opts.group) this.groups[opts.group].push(c);
    return c;
  }
  _iconButton(x, y, kind, onClick, group) {
    const c = this.add.container(x, y).setDepth(DEPTH.HUD);
    const g = this.add.graphics(); g.fillStyle(0x000000, 0.4); g.fillCircle(0, 0, 24); g.lineStyle(2, PAL.brass, 0.7); g.strokeCircle(0, 0, 24);
    const ic = this.add.graphics(); this._drawIcon(ic, kind); c.add([g, ic]); c.icon = ic; c.kind = kind;
    const z = this.add.zone(x, y, 56, 56).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(DEPTH.HUD + 1);
    z.on('pointerup', () => { if (!c.visible || GDFlow.isBlocking()) return; SFX.button(); onClick(); });
    c.zone = z; c.c = c; c.setVis = (v) => { c.setVisible(v); z.setVisible(v); if (v) z.setInteractive(); else z.disableInteractive(); };
    if (group) this.groups[group].push(c);
    return c;
  }
  _drawIcon(g, kind) {
    g.clear(); g.lineStyle(2.5, PAL.text, 1); g.fillStyle(PAL.text, 1);
    if (kind === 'home') { g.beginPath(); g.moveTo(-11, 1); g.lineTo(0, -10); g.lineTo(11, 1); g.strokePath(); g.strokeRect(-7, 1, 14, 10); }
    else if (kind === 'retry') { g.beginPath(); g.arc(0, 0, 9, -2.2, 2.6, false); g.strokePath(); g.fillTriangle(10, -4, 3, -1, 8, -11); }
    else if (kind === 'music' || kind === 'musicOff') { g.fillCircle(-5, 6, 4); g.fillCircle(6, 3, 4); g.lineBetween(-1, 6, -1, -9); g.lineBetween(10, 3, 10, -12); g.lineBetween(-1, -9, 10, -12); if (kind === 'musicOff') { g.lineStyle(3, PAL.danger, 1); g.lineBetween(-12, 12, 12, -12); } }
    else if (kind === 'sound' || kind === 'soundOff') { g.fillTriangle(-10, -4, -3, -4, 4, -11); g.fillRect(-10, -4, 7, 8); g.fillTriangle(-3, 4, 4, 11, -10, 4); g.beginPath(); g.arc(4, 0, 7, -1, 1, false); g.strokePath(); if (kind === 'soundOff') { g.lineStyle(3, PAL.danger, 1); g.lineBetween(-12, 12, 12, -12); } }
    else if (kind === 'lang') { g.strokeCircle(0, 0, 10); g.lineBetween(-10, 0, 10, 0); g.lineBetween(0, -10, 0, 10); g.strokeEllipse(0, 0, 10, 20); }
  }
  _toast(msg, color, y, plate) {
    // plate === 'tip' : 작은 본문 폰트의 안내 문구(오래 보임). 그 외 plate = 큰 명판(실패 사유 등)
    const tip = plate === 'tip';
    const tx = this.add.text(W / 2, y || H * 0.5, msg, { fontFamily: tip ? FONT : FONT_D, fontSize: tip ? '17px' : plate ? '34px' : '36px', color: color || css(PAL.text), align: 'center', wordWrap: { width: W - 60 }, ...(plate ? { backgroundColor: 'rgba(18,10,6,0.88)', padding: { x: tip ? 16 : 22, y: tip ? 9 : 10 } } : {}) }).setOrigin(0.5).setDepth(DEPTH.TOAST).setShadow(0, 3, 'rgba(0,0,0,0.7)', 8).setAlpha(0);
    this.tweens.add({ targets: tx, alpha: 1, y: tx.y - 12, duration: 180, ease: 'Quad.Out' });
    this.tweens.add({ targets: tx, alpha: 0, delay: tip ? 2600 : 950, duration: 300, onComplete: () => tx.destroy() });
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  _buildHUD() {
    const bar = this.add.graphics().setDepth(DEPTH.HUD - 1);
    bar.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.6, 0.6, 0, 0); bar.fillRect(0, 0, W, CONFIG.HUD_H + 30);
    this.groups.hud.push(bar);
    this.hudNight = this.add.text(W / 2, 32, '', { fontFamily: FONT, fontSize: '15px', color: css(PAL.gold), fontStyle: 'bold', letterSpacing: 3 }).setOrigin(0.5).setDepth(DEPTH.HUD);
    this.hudName = this.add.text(W / 2, 62, '', { fontFamily: FONT_D, fontSize: '30px', color: css(PAL.text) }).setOrigin(0.5).setDepth(DEPTH.HUD);
    this.hudTurns = this.add.text(W / 2, 94, '', { fontFamily: FONT, fontSize: '15px', color: css(PAL.textDim) }).setOrigin(0.5).setDepth(DEPTH.HUD);
    this.gaugeGfx = this.add.graphics().setDepth(DEPTH.HUD); this.gaugeTxts = [];
    this.lostTxt = this.add.text(W - 24, CONFIG.HUD_H + 46, '', { fontFamily: FONT, fontSize: '13px', color: css(PAL.danger), fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(DEPTH.HUD); // 1.2e: 음악 버튼과 겹치지 않게 게이지 아래로
    this.groups.hud.push(this.hudNight, this.hudName, this.hudTurns, this.gaugeGfx, this.lostTxt);
    this.btnHome = this._iconButton(40, 48, 'home', () => this._goHome(), 'hud');
    this.btnRetry = this._iconButton(W - 40, 48, 'retry', () => this._retryByButton(), 'hud');
    this.btnMusic = this._iconButton(W - 40, 108, this.save.musicMute ? 'musicOff' : 'music', () => this._toggleMusic(), 'hud');
    this.btnSound = this._iconButton(40, 108, this.save.mute ? 'soundOff' : 'sound', () => this._toggleSound(), 'hud');
    // 회전 버튼(큰 황동 다이얼 느낌) + 힌트
    // 1.2e: 회전 버튼은 누르고 있으면 미리보기, 떼면 회전(_pressStart/_pressEnd). onClick 은 쓰지 않는다
    this.btnL = this._button(110, H - 92, 150, 76, '↺', () => {}, { tint: 0x2a1f16, color: css(PAL.gold), group: 'hud', fontSize: 44 });
    this.btnR = this._button(W - 110, H - 92, 150, 76, '↻', () => {}, { tint: 0x2a1f16, color: css(PAL.gold), group: 'hud', fontSize: 44 });
    for (const [b, dir] of [[this.btnL, -1], [this.btnR, 1]]) { b.zone.removeAllListeners('pointerup'); b.zone.on('pointerdown', (p) => this._pressStart(dir, p)); b.dir = dir; }
    // 1.1: 되돌리기(정지 상태 스냅샷) — 생각하는 퍼즐에서 "처음부터 다시"의 노가다를 없앤다
    this.btnUndo = this._button(W / 2, H - 120, 124, 44, t('undo'), () => this._undo(), { tint: 0x2a1f16, color: css(PAL.text), group: 'hud', fontSize: 17 });
    this.hintBtn = this._button(W / 2, H - 66, 124, 44, '', () => this._onHintButton(), { tint: 0x1b3a37, color: css(PAL.text), group: 'hud', fontSize: 17 });
    // 1.2e: 미리보기 예산 표시/충전(힌트 토큰 또는 보상형 광고)
    this.previewBtn = this._button(W / 2, H - 44, 124, 42, '', () => this._onPreviewRefill(), { tint: 0x2a2238, color: css(PAL.text), group: 'hud', fontSize: 14 });
    this.hintArrows = [];
  }
  _refreshPreviewBtn() {
    if (!this.previewBtn) return;
    const n = this.previewsLeft == null ? PREVIEW_MAX : this.previewsLeft;
    this.previewBtn.txt.setText(`◉ ${t('previews')} ${n === Infinity ? '∞' : n}`); this._fitText(this.previewBtn.txt, 110);
    this.previewBtn.setVis(false); this.previewBtn.setAlpha(n > 0 ? 1 : 0.8); // 1.2g: 무제한이라 숨김
  }
  async _onPreviewRefill() {
    if (this.state !== 'playing' || (this.previewsLeft || 0) > 0) { this._toast(t('holdTip'), css(PAL.textDim), H * 0.78, 'tip'); return; }
    if (this.save.hints > 0) { this.save.hints--; this._save(); this.previewsLeft = PREVIEW_MAX; this._refreshPreviewBtn(); this._refreshHintBtn(); SFX.settle(); return; }
    const prev = this.state; this.state = 'loading';
    const ok = await GDFlow.playAd('rewarded'); // SDK_REWARDED_WATCH_COMPLETE 일 때만 true
    if (this.state === 'loading') this.state = prev;
    if (ok && this.state === 'playing') { this.previewsLeft = PREVIEW_MAX; SFX.settle(); }
    this._refreshPreviewBtn();
  }
  _toggleMusic() { this.save.musicMute = !this.save.musicMute; MUSIC.setMute(this.save.musicMute); this.game.sound.mute = this.save.musicMute; this._save(); this._refreshAudioIcons(); }
  _toggleSound() { this.save.mute = !this.save.mute; SFX.setUserMuted(this.save.mute); this._save(); this._refreshAudioIcons(); }
  _refreshAudioIcons() {
    for (const b of [this.btnMusic, this.titleMusic]) if (b) this._drawIcon(b.icon, this.save.musicMute ? 'musicOff' : 'music');
    for (const b of [this.btnSound, this.titleMute]) if (b) this._drawIcon(b.icon, this.save.mute ? 'soundOff' : 'sound');
  }
  _setGroup(name, v) { for (const o of this.groups[name]) { if (o.setVis) o.setVis(v); else o.setVisible(v); } }
  _refreshHud() {
    if (!this.sim) return;
    const lv = LEVELS[this.levelIdx];
    this.hudNight.setText(t('vessel', { n: this.levelIdx + 1 }).toUpperCase());
    this.hudName.setText(levelName(lv)); this._fitText(this.hudName, W - 140);
    this.hudTurns.setText(`${t('turns')} ${this.sim.rot}  ·  ${t('par')} ${lv.par}`);
    this._refreshGauges();
  }
  _refreshHintBtn() {
    if (!this.hintBtn) return;
    const n = this.save.hints;
    this.hintBtn.txt.setText(`✦ ${t('hint')}${n > 0 ? ` (${n})` : ''}`); this._fitText(this.hintBtn.txt, 100);
    this.hintBtn.setVis(this.state === 'playing' && !!this.sim && (HINTS[LEVELS[this.levelIdx].id] || []).length > 0 && !this.hintActive);
    this._refreshPreviewBtn();
  }
  async _onHintButton() {
    if (this.state !== 'playing' || this.hintActive) return;
    if (this.save.hints > 0) { this.save.hints--; this._save(); this._showHintSeq(); return; }
    const prev = this.state; this.state = 'loading';
    const ok = await GDFlow.playAd('rewarded'); // SDK_REWARDED_WATCH_COMPLETE 일 때만 true
    if (this.state === 'loading') this.state = prev;
    if (ok && this.state === 'playing') this._showHintSeq(); else this._refreshHintBtn();
  }
  // 힌트 = 솔버 par 해답의 회전 순서. 그릇을 처음 상태로 되돌린 뒤 그릇 위에 화살표 줄로 보여주고, 따라 둔 만큼 흐리게.
  _showHintSeq() {
    const seq = HINTS[LEVELS[this.levelIdx].id] || [];
    this._rewindAll();
    this.hintActive = true; this.hintLevel = this.levelIdx; this._refreshHintBtn();
    this._destroyHintArrows();
    const perRow = 8, gap = 44, rows = Math.ceil(seq.length / perRow);
    seq.forEach((d, i) => {
      const row = Math.floor(i / perRow), inRow = Math.min(perRow, seq.length - row * perRow), col = i % perRow;
      const x = W / 2 + (col - (inRow - 1) / 2) * gap, y = 182 + (row - (rows - 1) / 2) * 40;
      const a = this.add.text(x, y, d > 0 ? '↻' : '↺', { fontFamily: FONT_D, fontSize: '32px', color: css(PAL.gold) }).setOrigin(0.5).setDepth(DEPTH.HUD).setShadow(0, 2, 'rgba(0,0,0,0.7)', 6).setAlpha(0);
      this.tweens.add({ targets: a, alpha: 1, delay: i * 40, duration: 220 });
      this.hintArrows.push(a);
    });
    this.time.delayedCall(seq.length * 40 + 240, () => this._refreshHintSteps());
  }
  _destroyHintArrows() { for (const a of this.hintArrows || []) a.destroy(); this.hintArrows = []; }
  _refreshHintSteps() {
    if (!this.hintActive || !this.hintArrows.length) return;
    const seq = HINTS[LEVELS[this.levelIdx].id] || [];
    const done = this.history.map((h) => h.dir);
    const onPath = done.every((d, i) => seq[i] === d);
    this.hintArrows.forEach((a, i) => {
      this.tweens.killTweensOf(a);
      a.setScale(1).setColor(onPath ? css(PAL.gold) : css(PAL.danger)).setAlpha(onPath && i < done.length ? 0.22 : 1);
      if (onPath && i === done.length) this.tweens.add({ targets: a, scaleX: 1.25, scaleY: 1.25, duration: 360, yoyo: true, repeat: -1 });
    });
    if (!onPath) this.tweens.add({ targets: this.btnUndo, scaleX: 1.08, scaleY: 1.08, duration: 180, yoyo: true, repeat: 1 });
  }
  _clearHint() { this.hintActive = false; this._destroyHintArrows(); }

  // ---------------------------------------------------------------------------
  // 타이틀 — 장식: 1번 그릇의 실제 시뮬이 3초마다 저절로 돈다
  // ---------------------------------------------------------------------------
  _buildTitle() {
    const dim = this.add.rectangle(W / 2, H / 2, W * 4, H, 0x000000, 0.2).setDepth(DEPTH.OVERLAY - 1); // 1.2e: 가로 배치의 양옆까지 덮게 넓게
    this.titleLogo = this.add.text(W / 2, 200, t('title'), { fontFamily: FONT_D, fontSize: '64px', color: css(PAL.text), align: 'center', letterSpacing: 6 }).setOrigin(0.5).setDepth(DEPTH.OVERLAY).setShadow(0, 6, 'rgba(0,0,0,0.6)', 14);
    this.titleLogo._base = 64; this._fitText(this.titleLogo, W - 40);
    this.titleTag = this.add.text(W / 2, 262, t('tagline'), { fontFamily: FONT, fontSize: '19px', color: css(PAL.textDim), align: 'center', wordWrap: { width: W - 80 } }).setOrigin(0.5).setDepth(DEPTH.OVERLAY);
    this.playBtn = this._button(W / 2, 700, 300, 92, t('play'), () => this._startFromTitle(), { tint: PAL.gold, group: 'title', fontSize: 34, font: FONT_D, depth: DEPTH.OVERLAY });
    this.shelfBtn = this._button(W / 2, 788, 220, 58, t('shelf'), () => this._openShelf(), { tint: 0x2a1f16, color: css(PAL.text), group: 'title', fontSize: 20, depth: DEPTH.OVERLAY });
    this.titleProgress = this.add.text(W / 2, 640, '', { fontFamily: FONT, fontSize: '18px', color: css(PAL.gold), fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH.OVERLAY);
    this.titleHow = this.add.text(W / 2, 880, t('howTo'), { fontFamily: FONT, fontSize: '16px', color: css(PAL.textDim), align: 'center', wordWrap: { width: W - 90 } }).setOrigin(0.5).setDepth(DEPTH.OVERLAY);
    this.titleMusic = this._iconButton(W - 40, 48, this.save.musicMute ? 'musicOff' : 'music', () => this._toggleMusic(), 'title');
    this.titleMute = this._iconButton(W - 100, 48, this.save.mute ? 'soundOff' : 'sound', () => this._toggleSound(), 'title');
    this.titleLang = this._iconButton(40, 48, 'lang', () => this._cycleLang(), 'title');
    this.tLangTxt = this.add.text(76, 48, LANG_NAMES[currentLang], { fontFamily: FONT, fontSize: '15px', color: css(PAL.textDim) }).setOrigin(0, 0.5).setDepth(DEPTH.OVERLAY);
    this.groups.title.push(dim, this.titleLogo, this.titleTag, this.titleProgress, this.titleHow, this.tLangTxt);
  }
  _cycleLang() {
    currentLang = LANGS[(LANGS.indexOf(currentLang) + 1) % LANGS.length];
    saveJSON(CONFIG.LANG_KEY, currentLang);
    this.titleLogo.setText(t('title')); this._fitText(this.titleLogo, W - 40); this.titleTag.setText(t('tagline')); this.titleHow.setText(t('howTo'));
    this.playBtn.txt.setText(t('play')); this._fitText(this.playBtn.txt, 280); this.shelfBtn.txt.setText(t('shelf')); this._fitText(this.shelfBtn.txt, 200);
    this.tLangTxt.setText(LANG_NAMES[currentLang]); this._refreshTitleProgress();
    if (this.btnUndo) { this.btnUndo.txt.setText(t('undo')); this._fitText(this.btnUndo.txt, 104); }
    this._refreshPreviewBtn();
  }
  _refreshTitleProgress() {
    const cleared = this._cleared(); const stars = LEVELS.reduce((a, l) => a + (this.save.stars[l.id] || 0), 0);
    this.titleProgress.setText(cleared ? `${cleared}/${LEVELS.length}   ★ ${stars}` : '');
  }
  // 그릇 각도 트윈만 따로 관리(scale 트윈은 건드리지 않음) — 빠른 재시작·홈에서 각도가 남던 버그
  _spinTo(angle) { if (this._angTween) this._angTween.stop(); this._angTween = this.tweens.add({ targets: this.vessel, angle, duration: CONFIG.ROT_MS, ease: 'Back.Out' }); }
  _resetVessel(scale, x, y) {
    if (this._angTween) { this._angTween.stop(); this._angTween = null; }
    this.tweens.killTweensOf(this.vessel);
    this.visAngle = 0; this.vessel.setVisible(true).setAngle(0).setScale(scale).setPosition(x, y);
  }
  // 레벨을 떠날 때 걸려 있는 지연 호출(승리 패널·실패 후 되돌리기) 제거 — 홈/재시작 직후 패널이 뜨던 소프트락
  _fxTimer(ms, fn) { const tm = this.time.delayedCall(ms, () => { this._fxTimers = (this._fxTimers || []).filter((x) => x !== tm); fn(); }); (this._fxTimers = this._fxTimers || []).push(tm); return tm; }
  _cancelTimers() {
    for (const tm of this._fxTimers || []) tm.remove(false); this._fxTimers = [];
    if (this._winTimer) { this._winTimer.remove(false); this._winTimer = null; }
    if (this._introTimer) { this._introTimer.remove(false); this._introTimer = null; }
    if (this._chapterObjs) { for (const o of this._chapterObjs) { this.tweens.killTweensOf(o); o.destroy(); } this._chapterObjs = null; }
    if (this._failTimer) { this._failTimer.remove(false); this._failTimer = null; }
  }
  _showTitle() {
    this._cancelTimers(); this._hideHowHint(); this._clearHint(); this._goldT = 0; this._goldMask = null; this._press = null; this._clearPreview();
    for (const tx of this.gaugeTxts || []) tx.setVisible(false);
    this.state = 'title';
    this._setGroup('title', true); this._setGroup('hud', false); this._setGroup('win', false); this._setGroup('shelf', false);
    this._refreshTitleProgress();
    // 장식용 시뮬(1번 그릇) — 작게, 자동 회전
    this._loadSim(0, 7);
    this._resetVessel(0.62, W / 2, 470);
    this._titleTimer = 0;
  }
  async _startFromTitle() {
    if (this.state !== 'title') return;
    SFX.unlock(); MUSIC.start();
    this.state = 'loading';
    await GDFlow.playAd('interstitial'); // 프리롤(GD 필수)
    this._setGroup('title', false); this._setGroup('hud', true);
    this.levelIdx = Math.min(this.save.unlocked, LEVELS.length - 1); this.attempt = 0;
    this._startLevel();
  }

  // ---------------------------------------------------------------------------
  // 클리어 패널
  // ---------------------------------------------------------------------------
  _buildWin() {
    const dim = this.add.rectangle(W / 2, H / 2, W * 4, H, 0x000000, 0.55).setDepth(DEPTH.MODAL - 1).setInteractive();
    // 1.1b: 연금술 공방의 황동 명판(호두나무 판 + 두꺼운 황동 테 + 리벳). 별 = 모래시계 셋(얻으면 뒤집히며 빛남). 버튼 전부 패널 안
    const PX = W / 2 - 205, PY = 268, PW = 410, PH = 446;
    const panel = this.add.graphics().setDepth(DEPTH.MODAL);
    panel.fillStyle(0x000000, 0.5); panel.fillRoundedRect(PX + 6, PY + 12, PW, PH, 14);
    panel.fillStyle(0x8a6a2a, 1); panel.fillRoundedRect(PX - 6, PY - 6, PW + 12, PH + 12, 16);
    panel.fillGradientStyle(0xd9b25a, 0xd9b25a, 0x7a5520, 0x7a5520, 1); panel.fillRoundedRect(PX - 3, PY - 3, PW + 6, PH + 6, 14);
    panel.fillGradientStyle(0x4a3220, 0x4a3220, 0x24170e, 0x24170e, 1); panel.fillRoundedRect(PX + 6, PY + 6, PW - 12, PH - 12, 10);
    panel.lineStyle(1, 0xf0d58a, 0.35); panel.strokeRoundedRect(PX + 14, PY + 14, PW - 28, PH - 28, 8);
    for (const [cx, cy] of [[PX + 16, PY + 16], [PX + PW - 16, PY + 16], [PX + 16, PY + PH - 16], [PX + PW - 16, PY + PH - 16]]) { panel.fillStyle(0x6b4a1a, 1); panel.fillCircle(cx, cy, 7); panel.fillStyle(0xf0d58a, 1); panel.fillCircle(cx - 1.5, cy - 1.5, 4); }
    this.winTitle = this.add.text(W / 2, PY + 66, '', { fontFamily: FONT_D, fontSize: '32px', color: css(PAL.gold), align: 'center', wordWrap: { width: PW - 70 } }).setOrigin(0.5).setDepth(DEPTH.MODAL + 1).setShadow(0, 2, 'rgba(0,0,0,0.8)', 4);
    this.winStars = [0, 1, 2].map((i) => { const im = this.add.image(W / 2 - 84 + i * 84, PY + 158, this.textures.exists('img_hourglass') ? 'img_hourglass' : 'glow').setDepth(DEPTH.MODAL + 1); const sc = 84 / im.height; im.setScale(sc); im._bs = sc; return im; });
    this.winTaps = this.add.text(W / 2, PY + 232, '', { fontFamily: FONT, fontSize: '18px', color: css(PAL.textDim) }).setOrigin(0.5).setDepth(DEPTH.MODAL + 1);
    this.winNext = this._button(W / 2, PY + 302, 250, 66, t('next'), () => this._nextByButton(), { tint: PAL.gold, group: 'win', fontSize: 28, font: FONT_D, depth: DEPTH.MODAL + 1 });
    this.winHome = this._button(W / 2 - 92, PY + 380, 150, 48, t('home'), () => this._goHome(), { tint: 0x2a1f16, color: css(PAL.text), group: 'win', fontSize: 18, depth: DEPTH.MODAL + 1 });
    this.winRetry = this._button(W / 2 + 92, PY + 380, 150, 48, t('retry'), () => this._retryByButton(), { tint: 0x2a1f16, color: css(PAL.text), group: 'win', fontSize: 18, depth: DEPTH.MODAL + 1 });
    this.groups.win.push(dim, panel, this.winTitle, ...this.winStars, this.winTaps);
  }

  // ---------------------------------------------------------------------------
  // 선반(레벨 선택) — 5열, 페이지당 30
  // ---------------------------------------------------------------------------
  _buildShelf() {
    const dim = this.add.rectangle(W / 2, H / 2, W * 4, H, 0x0a0705, 0.93).setDepth(DEPTH.MODAL - 1).setInteractive();
    this.shelfTitle = this.add.text(W / 2, 70, '', { fontFamily: FONT_D, fontSize: '40px', color: css(PAL.text) }).setOrigin(0.5).setDepth(DEPTH.MODAL + 1);
    this.shelfBack = this._button(W / 2, H - 70, 200, 60, t('back'), () => this._closeShelf(), { tint: 0x2a1f16, color: css(PAL.text), group: 'shelf', fontSize: 22, depth: DEPTH.MODAL + 1 });
    this.shelfPrev = this._button(70, H - 70, 70, 60, '‹', () => this._shelfPage(-1), { tint: 0x2a1f16, color: css(PAL.text), group: 'shelf', fontSize: 34, depth: DEPTH.MODAL + 1 });
    this.shelfNext = this._button(W - 70, H - 70, 70, 60, '›', () => this._shelfPage(1), { tint: 0x2a1f16, color: css(PAL.text), group: 'shelf', fontSize: 34, depth: DEPTH.MODAL + 1 });
    this.shelfPageTxt = this.add.text(W / 2, H - 118, '', { fontFamily: FONT, fontSize: '15px', color: css(PAL.textDim) }).setOrigin(0.5).setDepth(DEPTH.MODAL + 1);
    this.shelfCells = this.add.container(0, 0).setDepth(DEPTH.MODAL + 1);
    this.shelfZone = this.add.zone(W / 2, 480, W, 660).setOrigin(0.5).setDepth(DEPTH.MODAL + 2).setInteractive();
    this.shelfZone.on('pointerup', (p) => this._onShelfTap(p.worldX, p.worldY)); // 1.2e: 가로 배치(카메라 스크롤)에서도 맞게 world 좌표
    this.groups.shelf.push(dim, this.shelfTitle, this.shelfCells, this.shelfZone, this.shelfPageTxt);
    this.shelfPageIdx = 0;
  }
  _cellPos(i) { const col = i % 5, row = Math.floor(i / 5) % 6; return { x: 70 + col * 100, y: 170 + row * 100 }; }
  _shelfPage(d) { const pages = Math.ceil(LEVELS.length / 30); this.shelfPageIdx = clamp(this.shelfPageIdx + d, 0, pages - 1); this._refreshShelf(); }
  _refreshShelf() {
    this.shelfTitle.setText(t('shelf')); this.shelfBack.txt.setText(t('back'));
    const pages = Math.ceil(LEVELS.length / 30);
    this.shelfPrev.setVis(pages > 1 && this.shelfPageIdx > 0); this.shelfNext.setVis(pages > 1 && this.shelfPageIdx < pages - 1);
    this.shelfPageTxt.setText(pages > 1 ? `${this.shelfPageIdx * 30 + 1}–${Math.min(LEVELS.length, this.shelfPageIdx * 30 + 30)} / ${LEVELS.length}` : '');
    this.shelfCells.removeAll(true);
    const first = this.shelfPageIdx * 30;
    for (let i = first; i < Math.min(LEVELS.length, first + 30); i++) {
      const lv = LEVELS[i]; const p = this._cellPos(i - first); const unlocked = i <= this.save.unlocked; const st = this.save.stars[lv.id] || 0;
      // 1.1b: 연금술사의 선반 — 그릇(=레벨)마다 모래시계. 채운 그릇은 빛나고, 아직이면 흐린 유리, 잠긴 건 그림자. 별 = 작은 모래시계
      const g = this.add.graphics();
      if ((i - first) % 5 === 0) { const py = p.y + 40; g.fillStyle(0x000000, 0.35); g.fillRect(14, py + 6, W - 28, 8); g.fillGradientStyle(0x6b4a2a, 0x6b4a2a, 0x3a2614, 0x3a2614, 1); g.fillRect(14, py - 4, W - 28, 12); g.fillStyle(0xd9b25a, 0.9); g.fillRect(26, py - 4, 10, 16); g.fillRect(W - 36, py - 4, 10, 16); }
      // 1.2g: 선반 아이콘 = 그 그릇의 실제 모습(벽·모래·목표 방을 56px 로) — 모래시계 아이콘은 다른 게임을 약속했다
      const hg = this.add.image(p.x, p.y - 4, this._vesselIcon(lv, i)).setDisplaySize(60, 60);
      if (!unlocked) hg.setTint(0x4a3a30).setAlpha(0.55); else if (!st) hg.setTint(0xb0a090).setAlpha(0.9);
      const glow = this.add.image(p.x, p.y - 4, 'glow').setDisplaySize(90, 90).setTint(PAL.gold).setBlendMode(ADD).setAlpha(st === 3 ? 0.32 : st ? 0.18 : 0);
      const num = this.add.text(p.x, p.y - 4, String(i + 1), { fontFamily: FONT_D, fontSize: '22px', color: unlocked ? '#fff3d6' : '#5a4a3a' }).setOrigin(0.5).setStroke('#1a0f08', 5);
      const dots = [];
      if (unlocked) for (let k = 0; k < 3; k++) { const d = this.add.image(p.x - 14 + k * 14, p.y + 30, this.textures.exists('img_hourglass') ? 'img_hourglass' : 'glow'); d.setScale(13 / d.height); if (k >= st) d.setTint(0x4a4038).setAlpha(0.6); dots.push(d); }
      const stars = this.add.container(0, 0, dots);
      this.shelfCells.add([glow, hg]);
      this.shelfCells.add([g, num, stars]);
    }
  }
  _vesselIcon(lv, i) {
    const key = 'icon_' + lv.id; if (this.textures.exists(key)) return key;
    const S_ = 56, c = S_ / N, wp = CHAPTERS[chapterOf(i)], g = buildGrid(lv);
    this._makeCanvas(key, S_, S_, (ctx) => {
      ctx.fillStyle = '#1a130e'; ctx.fillRect(0, 0, S_, S_);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = g[y * N + x]; if (v === CELL.WALL) ctx.fillStyle = css(wp.wall); else if (isSand(v)) ctx.fillStyle = css(PAL.sand[v - 1][0]); else if (v === CELL.DRAIN) ctx.fillStyle = css(PAL.drainRim); else continue; ctx.fillRect(x * c, y * c, c + 0.35, c + 0.35); }
      for (const tg of lv.targets || []) { ctx.strokeStyle = css(PAL.sand[tg.color][2]); ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.strokeRect(tg.x * c + 0.5, tg.y * c + 0.5, tg.w * c - 1, tg.h * c - 1); }
      ctx.setLineDash([]); ctx.strokeStyle = '#d9b25a'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, S_ - 3, S_ - 3);
    });
    return key;
  }
  _openShelf() { if (this.state !== 'title') return; this.state = 'shelf'; this.shelfPageIdx = Math.floor(Math.min(this.save.unlocked, LEVELS.length - 1) / 30); this._setGroup('title', false); this.vessel.setVisible(false); this._setGroup('shelf', true); this._refreshShelf(); }
  _closeShelf() { if (this.state !== 'shelf') return; this._setGroup('shelf', false); this._showTitle(); }
  async _onShelfTap(x, y) {
    if (this.state !== 'shelf' || GDFlow.isBlocking()) return;
    const first = this.shelfPageIdx * 30;
    for (let i = first; i < Math.min(LEVELS.length, first + 30); i++) {
      const p = this._cellPos(i - first);
      if (Math.abs(x - p.x) <= 42 && Math.abs(y - p.y) <= 42) {
        SFX.button(); if (i > this.save.unlocked) return;
        SFX.unlock(); MUSIC.start(); this.state = 'loading';
        await GDFlow.playAd('interstitial');
        this._setGroup('shelf', false); this._setGroup('hud', true);
        this.levelIdx = i; this.attempt = 0; this._startLevel(); return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 레벨
  // ---------------------------------------------------------------------------
  _loadSim(idx, seed) {
    this.sim = createSim(LEVELS[idx], { seed });
    this._evIdx = 0; this._drawWalls(); this._drawSand(); this._drawTargets(0);
  }
  _startLevel() {
    const lv = LEVELS[this.levelIdx];
    this.attempt++;
    // 1.1: 시드 고정(레벨마다 같은 물리) — 같은 수 = 같은 결과. 솔버 그래프(test/graph.mjs, seed 1)와 일치
    this._cancelTimers(); this._goldT = 0; this._goldMask = null; 
    this._loadSim(this.levelIdx, 1);
    this.history = []; this.queued = 0; this._press = null; this._clearPreview(); this._hurry = false;
    this.previewsLeft = Infinity; // 1.2g: 무제한(예산은 두 평가에서 '소프트 페이월' — 충전 코드는 유지)
    this.state = 'playing';
    this._tipsN = 0; if (this.attempt === 1) this._hazardTips(lv);
    this._budgetTipShown = false;
    // (1.2g) 미리보기 예산 안내 제거
    // 산 힌트는 같은 레벨을 다시 시작해도 유지(다른 레벨이면 지움)
    if (!(this.hintActive && this.hintLevel === this.levelIdx)) this._clearHint();
    this._refreshHintBtn();
    this._resetVessel(CONFIG.VSCALE, W / 2, CONFIG.VESSEL_Y);
    this.vignette.setTint(0x000000).setAlpha(0.9); this.tweens.add({ targets: this.vignette, alpha: 0, duration: 500 });
    this.vessel.setScale(CONFIG.VSCALE * 0.94); this.tweens.add({ targets: this.vessel, scaleX: CONFIG.VSCALE, scaleY: CONFIG.VSCALE, duration: 320, ease: 'Back.Out' });
    const ch = chapterOf(this.levelIdx);
    if (this.attempt === 1) { if (CHAPTERS[ch].from === this.levelIdx && this.levelIdx > 0) { this._chapterCard(ch); this._introTimer = this.time.delayedCall(1900, () => { this._introTimer = null; if (this.sim && this.state === 'playing' && LEVELS[this.levelIdx] === lv) this._intro(lv); }); } else this._intro(lv); }
    if (this.attempt > CONFIG.HINT_AFTER_FAILS && this.hintBtn.visible) this.tweens.add({ targets: this.hintBtn, scaleX: 1.08, scaleY: 1.08, duration: 300, yoyo: true, repeat: 2 });
    this._refreshHud(); this._refreshUndo(); this._refreshHintSteps();
    if (!this.save.seenHow) this._showHowHint(); else this._hideHowHint(); // 다른 판으로 바로 넘어가도 안내 문구가 남지 않게
    if (this.save.seenHow && !this.save.seenHold && this.levelIdx >= 1 && this.attempt === 1) this._fxTimer(this._budgetTipShown ? 3600 : this._tipsN ? 1500 + this._tipsN * 1900 + 200 : 1300, () => { if (this.state === 'playing' && !this.save.seenHold) this._toast(t('holdTip'), css(PAL.text), 186, 'tip'); });
    this._applyLayout();
  }
  _chapterCard(ch) {
    const c = CHAPTERS[ch]; if (!c) return;
    const nm = c.name[currentLang] || c.name.en;
    const a = this.add.text(W / 2, 162, t('chapter', { n: ch + 1 }).toUpperCase(), { fontFamily: FONT, fontSize: '18px', color: css(PAL.gold), fontStyle: 'bold', letterSpacing: 8 }).setOrigin(0.5).setDepth(DEPTH.TOAST).setAlpha(0);
    const b = this.add.text(W / 2, 206, nm, { fontFamily: FONT_D, fontSize: '40px', color: css(PAL.text) }).setOrigin(0.5).setDepth(DEPTH.TOAST).setAlpha(0).setShadow(0, 4, 'rgba(0,0,0,0.7)', 12);
    this._fitText(b, W - 60);
    const line = this.add.rectangle(W / 2, 240, 10, 2, PAL.gold, 0.8).setDepth(DEPTH.TOAST).setAlpha(0);
    this.tweens.add({ targets: [a, b, line], alpha: 1, duration: 420, ease: 'Quad.Out' });
    this.tweens.add({ targets: line, width: 220, duration: 700, ease: 'Quad.Out' });
    this.tweens.add({ targets: [a, b, line], alpha: 0, delay: 1700, duration: 500, onComplete: () => { a.destroy(); b.destroy(); line.destroy(); } });
    this._chapterObjs = [a, b, line];
  }
  _intro(lv) {
    const a = this.add.text(W / 2, H * 0.42, t('vessel', { n: this.levelIdx + 1 }).toUpperCase(), { fontFamily: FONT, fontSize: '20px', color: css(PAL.gold), fontStyle: 'bold', letterSpacing: 6 }).setOrigin(0.5).setDepth(DEPTH.TOAST).setAlpha(0);
    const b = this.add.text(W / 2, H * 0.42 + 42, levelName(lv), { fontFamily: FONT_D, fontSize: '46px', color: css(PAL.text) }).setOrigin(0.5).setDepth(DEPTH.TOAST).setAlpha(0).setShadow(0, 4, 'rgba(0,0,0,0.7)', 10);
    this.tweens.add({ targets: [a, b], alpha: 1, duration: 260 });
    this.tweens.add({ targets: [a, b], alpha: 0, y: '-=30', delay: 900, duration: 380, onComplete: () => { a.destroy(); b.destroy(); } });
  }
  _showHowHint() {
    if (this.howHint) { this.howHint.destroy(); this.howHint = null; }
    this.howHint = this.add.text(W / 2, this.landscape ? H - 120 : H - 200, t('howTo'), { fontFamily: FONT, fontSize: '15px', color: css(PAL.text), backgroundColor: 'rgba(10,7,5,0.75)', padding: { x: 12, y: 8 }, align: 'center', wordWrap: { width: W - 80 } }).setOrigin(0.5).setDepth(DEPTH.TOAST).setAlpha(0);
    this.tweens.add({ targets: this.howHint, alpha: 1, duration: 300 });
  }
  _hideHowHint() { if (this.howHint) { const h = this.howHint; this.howHint = null; this.tweens.add({ targets: h, alpha: 0, duration: 200, onComplete: () => h.destroy() }); } }

  // ---------------------------------------------------------------------------
  // 입력 — 좌/우 탭 · 버튼 · 키보드
  // ---------------------------------------------------------------------------
  _buildInput() {
    const top = CONFIG.HUD_H + 40, bottom = H - 160;
    this.tapL = this.add.zone(W / 4, (top + bottom) / 2, W / 2, bottom - top).setOrigin(0.5).setDepth(DEPTH.VESSEL + 1).setInteractive();
    this.tapR = this.add.zone(W * 3 / 4, (top + bottom) / 2, W / 2, bottom - top).setOrigin(0.5).setDepth(DEPTH.VESSEL + 1).setInteractive();
    // 1.2e: 누르면 시작, 떼면 회전. HOLD_MS 이상 누르고 있으면 그 회전의 '정지 결과'를 유령 모래로 미리 보여준다(결정적 물리라 정확)
    this.tapL.on('pointerdown', (p) => this._pressStart(-1, p)); this.tapR.on('pointerdown', (p) => this._pressStart(1, p));
    this.input.on('pointerup', (p) => this._pressEnd(p)); this.input.on('pointerupoutside', (p) => this._pressEnd(p));
    this.input.keyboard.on('keydown', (e) => {
      if (GDFlow.isBlocking() || e.repeat) return; // 키를 누르고 있을 때 자동 반복으로 회전이 예약되던 문제
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this._pressStart(-1, null, 'key');
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this._pressStart(1, null, 'key');
      else if (e.key === 'z' || e.key === 'Z' || e.key === 'u' || e.key === 'U' || e.key === 'Backspace') this._undo();
      else if (e.key === 'r' || e.key === 'R') { if (this.state === 'playing' || this.state === 'failed') { this._setGroup('win', false); this._startLevel(); } }
    });
    this.input.keyboard.on('keyup', (e) => { if (this._press && this._press.src === 'key' && ['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'].includes(e.key)) this._pressEnd(null); });
  }
  _pressStart(dir, p, src) {
    if (this.state !== 'playing' || !this.sim || GDFlow.isBlocking() || this._press) return;
    this._press = { dir, t: this.time.now, src: src || 'pointer', shown: false, denied: false };
    if (!this.sim.settled) this._hurry = true; // 흐르는 중 탭 = 결정했으니 빨리(정지까지 4배)
    const b = dir > 0 ? this.btnR : this.btnL; this.tweens.add({ targets: b, scaleX: 0.94, scaleY: 0.94, duration: 70 });
  }
  _pressEnd(p) {
    const pr = this._press; if (!pr) return;
    this._press = null;
    const b = pr.dir > 0 ? this.btnR : this.btnL; this.tweens.add({ targets: b, scaleX: 1, scaleY: 1, duration: 90 });
    const hadPreview = pr.shown && !pr.denied; this._clearPreview();
    if (this.state !== 'playing' || !this.sim || GDFlow.isBlocking()) return;
    // 미리보기 중 손가락을 그릇 밖(위쪽 HUD)으로 끌고 가서 떼면 취소 — 결과만 보고 돌리지 않을 수 있게
    if (hadPreview && p && pr.src === 'pointer' && p.worldY < CONFIG.HUD_H + 20) { this._spinTo(this.visAngle); return; }
    this._turn(pr.dir);
  }
  _clearPreview() {
    if (!this._previewOn) return;
    this._previewOn = false; this.ghostImg.setVisible(false); this.sandImg.setAlpha(1); this.grainImg.setAlpha(0.14);
    if (this._previewToast) { this._previewToast.destroy(); this._previewToast = null; }
    if (this._previewTilt) { this._previewTilt.stop(); this._previewTilt = null; }
  }
  // 유령 모래: 지금 dir 로 돌렸을 때 모래가 멈추는 자리(실패면 붉게, 승리면 금빛). 그릇은 그 방향으로 살짝 기운다(예비 동작)
  _showPreview(dir) {
    if (!this.sim.settled) return false;
    const c = cloneSim(this.sim); if (!rotate(c, dir)) return false;
    let n = 0; while (!c.settled && c.status === 'playing' && n < SIM.TPS * SIM.MAX_TIME) { step(c, 1 / SIM.TPS); n++; }
    const ctx = this.ghostCtx, V = CONFIG.VESSEL, cs = CELL_PX, g = c.grid; ctx.clearRect(0, 0, V, V);
    const bad = c.status === 'lost', won = c.status === 'won';
    // 결과 격자는 회전 뒤 그릇 좌표계 그대로 — 지금 화면의 방 위치로 "어느 방에 들어가는가"가 읽힌다(중력만 옆으로)
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const v = g[y * N + x]; if (!isSand(v)) continue;
      const pal = this._sandTones[v - 1];
      ctx.fillStyle = bad ? 'rgba(255,96,70,0.75)' : won ? 'rgba(255,236,170,0.85)' : pal[4]; ctx.globalAlpha = bad || won ? 1 : 0.62;
      ctx.fillRect(x * cs, y * cs, cs + 0.3, cs + 0.3);
    }
    ctx.globalAlpha = 1; this.ghostTex.refresh();
    this.ghostImg.setVisible(true); this.sandImg.setAlpha(0.28); this.grainImg.setAlpha(0.03); this._previewOn = true;
    if (this._previewTilt) this._previewTilt.stop();
    this._previewTilt = this.tweens.add({ targets: this.vessel, angle: this.visAngle + 7 * dir, duration: 160, ease: 'Quad.Out' });
    const msg = bad ? (c.reason === 'mixed' ? t('mixed') : c.reason === 'lost' ? t('lost') : t('timeout')) : won ? '✓' : '';
    if (msg) { this._previewToast = this.add.text(W / 2, 236, msg, { fontFamily: FONT_D, fontSize: '30px', color: bad ? css(PAL.danger) : css(PAL.gold), backgroundColor: 'rgba(18,10,6,0.85)', padding: { x: 18, y: 8 } }).setOrigin(0.5).setDepth(DEPTH.TOAST); }
    return true;
  }
  _turn(dir) {
    if (this.state !== 'playing' || !this.sim || GDFlow.isBlocking()) return;
    // 1.1: 모래가 흐르는 동안은 회전하지 않고 마지막 탭 1개를 예약 → 정지 즉시 실행(타이밍·연타로 퍼즐을 우회하지 못하게)
    if (!this.sim.settled) { this.queued = dir > 0 ? 1 : -1; const qb = dir > 0 ? this.btnR : this.btnL; this.tweens.add({ targets: qb, scaleX: 0.92, scaleY: 0.92, duration: 70, yoyo: true }); return; }
    const snap = cloneSim(this.sim);
    if (!rotate(this.sim, dir)) return;
    this.history.push({ sim: snap, dir: dir > 0 ? 1 : -1 }); this._sandDirty = true;
    this._refreshUndo(); this._refreshHintSteps();
    if (!this.save.seenHow) { this.save.seenHow = true; this._save(); } this._hideHowHint();
    SFX.turn();
    this.visAngle += 90 * dir;
    this._spinTo(this.visAngle);
    this.tweens.add({ targets: this.vessel, scaleX: CONFIG.VSCALE * 1.03, scaleY: CONFIG.VSCALE * 1.03, duration: 90, yoyo: true });
    this._refreshHud();
  }
  // 1.2e: 처음 만나는 배수구·체에 반 초 동안 시선을 모은다(링 + 한 줄 설명). 세이브에 기록해 한 번만
  _hazardTips(lv) {
    const tips = [];
    if ((lv.drains || []).length && !this.save.seenDrain) { this.save.seenDrain = true; tips.push({ key: 'tipDrain', rects: lv.drains, color: PAL.drainRim }); }
    if ((lv.sieves || []).length && !this.save.seenSieve) { this.save.seenSieve = true; tips.push({ key: 'tipSieve', rects: lv.sieves, color: PAL.sand[lv.sieves[0].color || 1][2] }); }
    this._tipsN = tips.length; if (!tips.length) return; this._save();
    tips.forEach((tip, k) => this._fxTimer(1500 + k * 1900, () => {
      if (this.state !== 'playing' || LEVELS[this.levelIdx] !== lv) return;
      const cs = CELL_PX, V = CONFIG.VESSEL;
      for (const r of tip.rects) {
        const ring = this.add.graphics(); this.vessel.add(ring); this.vessel.moveBelow(ring, this.frameImg);
        const cx = (r.x + r.w / 2) * cs - V / 2, cy = (r.y + r.h / 2) * cs - V / 2;
        ring.lineStyle(3, tip.color, 0.95); ring.strokeCircle(cx, cy, Math.max(r.w, r.h) * cs * 1.2 + 10); ring.setAlpha(0);
        this.tweens.add({ targets: ring, alpha: { from: 1, to: 0 }, scaleX: 1.6, scaleY: 1.6, duration: 700, repeat: 1, onComplete: () => ring.destroy() });
      }
      const tx = this.add.text(W / 2, 186, t(tip.key), { fontFamily: FONT, fontSize: '18px', color: css(PAL.text), backgroundColor: 'rgba(18,10,6,0.88)', padding: { x: 16, y: 9 }, align: 'center', wordWrap: { width: W - 80 } }).setOrigin(0.5).setDepth(DEPTH.TOAST).setAlpha(0);
      this.tweens.add({ targets: tx, alpha: 1, duration: 200 }); this.tweens.add({ targets: tx, alpha: 0, delay: 1500, duration: 300, onComplete: () => tx.destroy() });
    }));
  }

  _undo() {
    if (this.state !== 'playing' || !this.sim || GDFlow.isBlocking() || !this.history.length) return;
    const h = this.history.pop();
    this._restoreSnap(h.sim, this.visAngle - 90 * h.dir);
    SFX.turn(); this._refreshHintSteps();
  }
  _rewindAll() {
    if (!this.history.length) return;
    const first = this.history[0]; const back = this.history.reduce((a, h) => a + h.dir, 0);
    this.history = [];
    this._restoreSnap(first.sim, this.visAngle - 90 * back);
  }
  _restoreSnap(sim, angle) {
    this.queued = 0; this._press = null; this._clearPreview(); this._hurry = false;
    this.sim = sim; this._evIdx = sim.events.length;
    this.visAngle = angle;
    this._spinTo(this.visAngle);
    this._drawSand(); this._refreshHud(); this._refreshUndo();
  }
  _refreshUndo() {
    if (!this.btnUndo) return;
    const can = this.state === 'playing' && !!this.history && this.history.length > 0;
    this.btnUndo.setAlpha(can ? 1 : 0.35);
  }

  // ---------------------------------------------------------------------------
  // 매 프레임
  // ---------------------------------------------------------------------------
  update(time, delta) {
    this._layoutTick(time);
    if (!this.sim) return;
    for (const sp of this.drainSprs || []) sp.angle += delta * 0.09; // 배수구 소용돌이 회전
    if (this.state === 'title' && this.vessel.visible) {
      // 장식: 3초마다 시계방향 회전
      this._titleTimer += delta;
      if (this._titleTimer > 3000) { this._titleTimer = 0; if (this.sim.status !== 'playing' || this.sim.rot >= 8) { this._loadSim(0, 7); this._resetVessel(0.62, W / 2, 470); } else { rotate(this.sim, 1); this.visAngle += 90; this._spinTo(this.visAngle); } }
      step(this.sim, delta / 1000); if (this.sim.moved > 0 || !this.sim.settled) this._drawSand(); this._drawTargets(time);
      return;
    }
    if (this.state === 'playing') {
      // 1.2: 긴 흐름은 점점 빨라진다(0.8s 까지 1배 → 2.5s 에 2.2배). 틱 단위 규칙이라 결과는 동일
      const ft = this.sim.settled ? 0 : this.sim.t - (this.sim.flowStart || 0);
      // 1.2f: 램프를 0.3s 부터 3.0배까지(6차 '수마다 기다림'), 흐르는 중 탭하면 4배(서두르기)
      const ts = this._hurry ? 4.5 : ft < 0.3 ? 1 : Math.min(4.0, 1 + (ft - 0.3) * 1.6);
      step(this.sim, delta / 1000 * ts);
      this._consumeEvents();
      if (this.queued && this.sim.settled && this.sim.status === 'playing') { const q = this.queued; this.queued = 0; this._turn(q); }
      if (this.sim.moved > 0 || this._sandDirty || !this.sim.settled) { this._drawSand(); this._sandDirty = false; this._shimT = time; }
      else if (time - (this._shimT || 0) > 110) { this._shimT = time; this._drawSand(time); } // 대기 반짝임
      // 1.2e: 누르고 있는 동안 — HOLD_MS 뒤 미리보기(예산 1 소모, 없으면 안내)
      const pr = this._press;
      if (pr && !pr.shown && time - pr.t > HOLD_MS && this.sim.settled && this.state === 'playing') {
        pr.shown = true;
        if ((this.previewsLeft || 0) <= 0) { pr.denied = true; this._toast(t('noPreview'), css(PAL.textDim), H * 0.78, 'tip'); this.tweens.add({ targets: this.previewBtn, scaleX: 1.1, scaleY: 1.1, duration: 120, yoyo: true, repeat: 1 }); }
        else if (this._showPreview(pr.dir)) { if (this.previewsLeft !== Infinity) this.previewsLeft = Math.max(0, this.previewsLeft - 1); this._refreshPreviewBtn(); if (!this.save.seenHold) { this.save.seenHold = true; this._save(); } }
      }
      this._drawTargets(time); this._refreshGauges();
      SFX.flow(this.sim.moved / 90);
      if (this.sim.status === 'won') this._onWin();
      else if (this.sim.status === 'lost') this._onFail(this.sim.reason);
    } else { SFX.flow(0); if (this._press) { this._press = null; this._clearPreview(); } if (this.state === 'won' || this.state === 'failed') this._drawTargets(time); }
  }
  // 1.2e: 정지 순간 더미 표면에서 먼지가 살짝 인다(착지 손맛). 표면 셀 몇 개를 골라 화면 좌표로 변환
  _landingDust() {
    const g = this.sim.grid, [gx, gy] = GRAV[this.sim.g], cs = CELL_PX, V = CONFIG.VESSEL; const cells = [];
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) { const c = g[y * N + x]; if (isSand(c) && g[(y - gy) * N + (x - gx)] === CELL.EMPTY) cells.push([x, y, c]); }
    if (!cells.length) return;
    const pick = []; const stepN = Math.max(1, Math.floor(cells.length / 10)); for (let i = 0; i < cells.length && pick.length < 10; i += stepN) pick.push(cells[i]);
    const mtx = this.vessel.getWorldTransformMatrix();
    for (const [x, y, c] of pick) {
      const wp = mtx.transformPoint((x + 0.5) * cs - V / 2, (y + 0.5) * cs - V / 2);
      const pt = this.add.particles(wp.x, wp.y, 'dot', { lifespan: 420, speed: { min: 8, max: 34 }, scale: { start: 0.3, end: 0 }, alpha: { start: 0.7, end: 0 }, tint: PAL.sand[c - 1][2], blendMode: 'ADD', quantity: 3, emitting: false }).setDepth(DEPTH.FX);
      pt.explode(3); this.time.delayedCall(500, () => pt.destroy());
    }
  }
  _consumeEvents() {
    const ev = this.sim.events;
    for (; this._evIdx < ev.length; this._evIdx++) {
      const e = ev[this._evIdx];
      if (e.type === 'settled') this._hurry = false;
      if (e.type === 'settled' && this.sim.rot > 0) { SFX.settle(); this._landingDust(); if (this.previewsLeft !== Infinity && this.previewsLeft < PREVIEW_MAX && this.sim.status === 'playing') { this.previewsLeft++; this._refreshPreviewBtn(); } }
      else if (e.type === 'drain') {
        if (e.n > 0 && Math.random() < 0.3) SFX.drain();
        // 배수구로 빨려 드는 알갱이(화면 좌표: 그릇 회전 반영)
        if (!this._drainCool || this.time.now > this._drainCool) {
          this._drainCool = this.time.now + 120;
          for (const d of this.sim.level.drains || []) {
            const lx = (d.x + d.w / 2) * CELL_PX - CONFIG.VESSEL / 2, ly = (d.y + d.h / 2) * CELL_PX - CONFIG.VESSEL / 2;
            const wp = this.vessel.getWorldTransformMatrix().transformPoint(lx, ly);
            const pt = this.add.particles(wp.x, wp.y, 'dot', { lifespan: 380, speed: { min: 10, max: 40 }, scale: { start: 0.45, end: 0 }, tint: PAL.drainRim, blendMode: 'ADD', quantity: 4, emitting: false }).setDepth(DEPTH.FX);
            pt.explode(4); this.time.delayedCall(450, () => pt.destroy());
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 결과
  // ---------------------------------------------------------------------------
  _onWin() {
    this.state = 'won'; SFX.flow(0);
    const lv = LEVELS[this.levelIdx]; const rot = this.sim.rot;
    const stars = rot <= lv.par ? 3 : rot <= lv.par + 2 ? 2 : 1;
    const prev = this.save.stars[lv.id] || 0;
    if (!prev) { this.save.hintBank++; if (this.save.hintBank >= CONFIG.HINT_EVERY) { this.save.hintBank = 0; this.save.hints++; this._fxTimer(1500, () => this._toast(t('hintGot'), css(PAL.gold), H * 0.86)); } }
    this.save.stars[lv.id] = Math.max(prev, stars);
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(this.levelIdx + 1, LEVELS.length - 1));
    this.save.seenHow = true; this._save(); this._clearHint(); this._refreshHintBtn(); this._hideHowHint(); this._refreshUndo();
    SFX.win();
    // 1.2b: 목표 방 모래가 금으로 변하며(0.9s) 카메라가 그릇으로 밀려 들어감
    this._goldMask = new Uint8Array(N * N); for (const tg of lv.targets || []) for (let y = tg.y; y < tg.y + tg.h; y++) for (let x = tg.x; x < tg.x + tg.w; x++) this._goldMask[y * N + x] = 1;
    this._goldT = 0; this.tweens.addCounter({ from: 0, to: 1, duration: 900, ease: 'Quad.Out', onUpdate: (tw) => { this._goldT = tw.getValue(); this._drawSand(); } });
    this.tweens.add({ targets: this.vessel, scaleX: CONFIG.VSCALE * 1.05, scaleY: CONFIG.VSCALE * 1.05, duration: 800, ease: 'Sine.InOut', yoyo: true, hold: 300 });
    // 연출: 그릇이 살짝 튀고 금빛 반짝 + 목표 방 글로우
    const glow = this.add.image(W / 2, CONFIG.VESSEL_Y, 'glow').setDisplaySize(700, 700).setTint(PAL.gold).setAlpha(0).setBlendMode(ADD).setDepth(DEPTH.FX);
    this.tweens.add({ targets: glow, alpha: 0.45, duration: 300, yoyo: true, hold: 200, onComplete: () => glow.destroy() });
    const p = this.add.particles(W / 2, CONFIG.VESSEL_Y, 'dot', { lifespan: 1100, speed: { min: 60, max: 240 }, gravityY: 160, scale: { start: 0.7, end: 0 }, tint: [PAL.gold, PAL.targetMet, 0xffffff], blendMode: 'ADD', quantity: 36, emitting: false }).setDepth(DEPTH.FX); p.explode(36); this.time.delayedCall(1300, () => p.destroy());
    // 1.2e: 채워진 방마다 금가루가 위로 솟고(0.3s 뒤) 방 테두리가 한 번 크게 번쩍
    { const mtx = this.vessel.getWorldTransformMatrix(); const cs = CELL_PX, V = CONFIG.VESSEL;
      (lv.targets || []).forEach((tg, i) => this._fxTimer(280 + i * 120, () => {
        if (this.state !== 'won') return;
        const wp = mtx.transformPoint((tg.x + tg.w / 2) * cs - V / 2, (tg.y + tg.h / 2) * cs - V / 2);
        const pt = this.add.particles(wp.x, wp.y, 'dot', { lifespan: 900, speed: { min: 40, max: 170 }, angle: { min: 200, max: 340 }, gravityY: 220, scale: { start: 0.55, end: 0 }, tint: [PAL.gold, 0xfff1c0], blendMode: 'ADD', quantity: 22, emitting: false }).setDepth(DEPTH.FX); pt.explode(22); this.time.delayedCall(1000, () => pt.destroy());
        const ring = this.add.image(wp.x, wp.y, 'glow').setDisplaySize(Math.max(tg.w, tg.h) * cs * 1.6, Math.max(tg.w, tg.h) * cs * 1.6).setTint(PAL.targetMet).setBlendMode(ADD).setAlpha(0.7).setDepth(DEPTH.FX);
        this.tweens.add({ targets: ring, alpha: 0, scaleX: ring.scaleX * 2.2, scaleY: ring.scaleY * 2.2, duration: 600, ease: 'Quad.Out', onComplete: () => ring.destroy() });
      })); }
    this._winTimer = this.time.delayedCall(1900, () => { // 1.2g: 금 변환·방 번쩍임이 다 보인 뒤 명판(1.2s → 1.9s)
      this._winTimer = null;
      if (this.state !== 'won') return; // 그사이 홈/재시작으로 떠났으면 패널을 띄우지 않음
      this.winTitle.setText(t('cleared', { n: this.levelIdx + 1 }));
      this.winTaps.setText(`${t('turns')} ${rot}  ·  ${t('par')} ${lv.par}`);
      this.winNext.txt.setText(t('next')); this.winHome.txt.setText(t('home')); this.winRetry.txt.setText(t('retry'));
      this._setGroup('win', true);
      // 1.2h: 별 = 그 그릇의 미니어처(모래시계 아이콘은 게임에 없는 물건이었음) — 얻으면 금빛으로 한 바퀴
      this.winStars.forEach((st, i) => { st.setTexture(this._vesselIcon(lv, this.levelIdx)).setDisplaySize(68, 68).setTint(0x4a4038).setAlpha(0.5).setAngle(0); const bs = st.scaleX; st.setScale(bs * 0.85); if (i < stars) this._fxTimer(250 + i * 240, () => { if (this.state !== 'won') return; st.setTint(0xffe9a8).setAlpha(1); SFX.star(i); this.tweens.add({ targets: st, angle: 360, scaleX: bs * 1.08, scaleY: bs * 1.08, duration: 480, ease: 'Back.Out' }); const p = this.add.particles(st.x, st.y, 'dot', { lifespan: 600, speed: { min: 30, max: 110 }, scale: { start: 0.45, end: 0 }, tint: [PAL.gold, 0xffffff], blendMode: 'ADD', quantity: 10, emitting: false }).setDepth(DEPTH.MODAL + 2); p.explode(10); this.time.delayedCall(700, () => p.destroy()); }); });
    });
  }
  _onFail(reason) {
    this.state = 'failed'; SFX.flow(0); SFX.fail(); this._refreshHintBtn(); this._hideHowHint(); // 1.1: 산 힌트는 실패해도 유지
    const msg = reason === 'mixed' ? t('mixed') : reason === 'lost' ? t('lost') : t('timeout');
    this._toast(msg, css(PAL.danger), 236, true); // 1.2g: 유실 카운터(156) 아래, 그릇 위
    // 무엇이 잘못됐는지 그릇 안에서 붉게: 섞임 = 목표 방, 유실 = 배수구
    const fx = this.add.graphics(); this.vessel.add(fx); const cs = CELL_PX, V = CONFIG.VESSEL;
    const rects = reason === 'mixed' ? (this.sim.level.targets || []) : reason === 'lost' ? (this.sim.level.drains || []) : [];
    fx.fillStyle(PAL.danger, 0.45); for (const r of rects) fx.fillRect(r.x * cs - V / 2, r.y * cs - V / 2, r.w * cs, r.h * cs);
    fx.lineStyle(3, PAL.danger, 1); for (const r of rects) fx.strokeRect(r.x * cs - V / 2, r.y * cs - V / 2, r.w * cs, r.h * cs);
    this.tweens.add({ targets: fx, alpha: { from: 1, to: 0.2 }, duration: 220, yoyo: true, repeat: 2, onComplete: () => fx.destroy() });
    this.vignette.setTint(0xe0603c).setAlpha(0.3); this.tweens.add({ targets: this.vignette, alpha: 0, duration: 500, onComplete: () => this.vignette.setTint(0x000000) });
    this.cameras.main.shake(160, 0.005);
    // 1.1: 실패하면 처음부터가 아니라 직전 수만 되돌린다(되돌리기 기록이 있으면)
    if (this._failTimer) this._failTimer.remove(false);
    this._failTimer = this.time.delayedCall(CONFIG.FAIL_RESTART_MS, () => { this._failTimer = null; if (this.state !== 'failed') return; if (this.history.length) { this.state = 'playing'; this._undo(); this._refreshHintBtn(); } else this._startLevel(); });
  }
  // 버튼 경유 = 비게임플레이 버튼 → 미드롤(GD 규격, 자체 쿨다운 없음)
  async _retryByButton() {
    if (this.state === 'loading' || this.state === 'title' || this.state === 'shelf') return;
    const prev = this.state; this.state = 'loading';
    await GDFlow.playAd('interstitial');
    this.state = prev; this._setGroup('win', false); this._startLevel();
  }
  async _nextByButton() {
    if (this.state !== 'won') return;
    this.state = 'loading';
    await GDFlow.playAd('interstitial');
    this._setGroup('win', false);
    if (this.levelIdx + 1 >= LEVELS.length) { this._toast(t('allDone')); this._showTitle(); return; }
    this.levelIdx++; this.attempt = 0; this.state = 'won'; this._startLevel();
  }
  async _goHome() {
    if (this.state === 'loading' || this.state === 'title' || this.state === 'shelf') return;
    this.state = 'loading';
    await GDFlow.playAd('interstitial');
    this._setGroup('win', false); this._clearHint();
    this._showTitle();
  }
}

// =============================================================================
// 부팅
// =============================================================================
const phaserConfig = {
  type: Phaser.AUTO, parent: 'game-container', backgroundColor: '#1a120e',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER, expandParent: false, autoRound: true, width: W, height: H },
  scene: [Game],
  render: { antialias: true, pixelArt: false },
};
(async () => {
  try { if (document.fonts && document.fonts.load) await Promise.race([Promise.all([document.fonts.load("700 20px 'Montserrat'"), document.fonts.load("400 20px 'Cinzel'")]), new Promise((r) => setTimeout(r, 1500))]); } catch (e) {}
  const game = new Phaser.Game(phaserConfig);
  GDFlow.init({ game, sceneKey: 'game', lang: () => currentLang, setAdMuted: (m) => { SFX.setAdMuted(m); MUSIC.setAdMuted(m); } });
  const unlock = () => { SFX.unlock(); MUSIC.start(); };
  ['pointerdown', 'touchend', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock));
})();
