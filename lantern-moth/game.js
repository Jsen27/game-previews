// game-14-lantern-moth : Lantern Moth
// -----------------------------------------------------------------------------
// 규칙 한 문장: "등불을 켜고 꺼서 나방을 창가의 집 등불까지 데려가라 — 나방은 절대 직접 만질 수 없다."
//
// 장르: 간접 조작 퍼즐 아케이드(원탭). 나방 AI·판정은 전부 ./sim.js(순수 모듈, Node 솔버와 공유),
// 이 파일은 렌더·입력·연출·광고 흐름만 담당한다. 레벨 데이터 ./levels.js. 설계 = 게임 루트의 DESIGN.md, 아트 = STYLE_GUIDE.md.
// 회색 박스 단계(2026-10-22): 그래픽 전부 절차적(이미지 0), 폰트는 템플릿 Montserrat 임시. 주석 한국어(CLAUDE.md).
//
// 포털 빌드: 광고는 shared/gd-flow.js(GDFlow.playAd) 로만.
//   - 프리롤 = PLAY 버튼 pointerup 직후, 미드롤 = Next/Retry/Home 버튼마다(빈도는 GD SDK, 자체 쿨다운 없음).
//   - 광고 중 씬 정지 + 완전 음소거, 광고 후 "TAP TO CONTINUE" 는 GDFlow 가 보장.
//   - BGM: shared/music.js(SONGS.lanternMoth) + 음악/효과음 토글 분리(GD 필수).
import { GDFlow } from './shared/gd-flow.js';
import { createMusic, SONGS } from './shared/music.js';
import { clamp, loadJSON, saveJSON, initCloudStorage } from './shared/utils.js';
// CrazyGames Data 모듈(진행 저장·로그인 시 클라우드 동기화) 준비 — 세이브/언어를 읽는 어떤 코드보다 먼저. 실패·4초 초과면 localStorage.
await initCloudStorage();
import { SIM, createSim, step, tapLamp, lampAt, isPlayerLamp } from './sim.js';
import { LEVELS } from './levels.js';
import { HINTS } from './hints.js'; // 솔버 par 해답(등불 탭 순서) — test/hints.mjs 가 생성
// 1.1b: 장(10밤씩) — 배경·장 이름. 장의 첫 밤에 장 제목 카드, 타이틀은 도달한 장의 배경
const CHAPTERS = [
  { from: 0, bg: 'img_bg', name: { en: 'The Courtyard', ko: '안마당', ja: '中庭', zh: '庭院', es: 'El patio', pt: 'O pátio', fr: 'La cour', de: 'Der Innenhof', it: 'Il cortile', tr: 'Avlu', ru: 'Двор' } },
  { from: 10, bg: 'img_bg_pond', name: { en: 'Lotus Pond', ko: '연못', ja: '蓮の池', zh: '荷塘', es: 'El estanque de lotos', pt: 'O lago de lótus', fr: "L'étang aux lotus", de: 'Der Lotusteich', it: 'Lo stagno dei loti', tr: 'Nilüfer Gölü', ru: 'Пруд с лотосами' } },
  { from: 20, bg: 'img_bg_temple', name: { en: 'Bamboo Temple', ko: '대숲 절', ja: '竹林の寺', zh: '竹林古寺', es: 'El templo del bambú', pt: 'O templo do bambu', fr: 'Le temple des bambous', de: 'Der Bambustempel', it: 'Il tempio dei bambù', tr: 'Bambu Tapınağı', ru: 'Храм в бамбуке' } },
  { from: 30, bg: 'img_bg_festival', name: { en: 'Lantern Festival', ko: '연등 축제', ja: '灯籠祭り', zh: '灯会之夜', es: 'Festival de faroles', pt: 'Festival das lanternas', fr: 'Fête des lanternes', de: 'Laternenfest', it: 'Festa delle lanterne', tr: 'Fener Şenliği', ru: 'Праздник фонарей' } },
  // 1.2e: 41~60 — 눈 내린 사당·항구
  { from: 40, bg: 'img_bg_snow', name: { en: 'Snow Shrine', ko: '눈 내린 사당', ja: '雪の祠', zh: '雪中神社', es: 'Santuario nevado', pt: 'Santuário na neve', fr: 'Sanctuaire sous la neige', de: 'Verschneiter Schrein', it: 'Santuario innevato', tr: 'Karlı Tapınak', ru: 'Заснеженное святилище' } },
  { from: 50, bg: 'img_bg_harbor', name: { en: 'Harbor Lights', ko: '항구의 불빛', ja: '港の灯り', zh: '港口灯火', es: 'Luces del puerto', pt: 'Luzes do porto', fr: 'Lumières du port', de: 'Hafenlichter', it: 'Luci del porto', tr: 'Liman Işıkları', ru: 'Огни гавани' } },
];
const LAMP_SET = ['lamp', 'lamp2', 'lamp3', 'lamp4', 'lamp3', 'lamp4']; // 장별 플레이어 등불 디자인(5·6장은 3·4장 디자인 재사용)
const chapterOf = (i) => { let c = 0; CHAPTERS.forEach((ch, k) => { if (i >= ch.from) c = k; }); return c; };


// 진단 전역은 ?qa=1 일 때만 — 제출 빌드에서 전역 노출 없음
const QA_HOOKS = /(?:^|[?&])qa=1(?:&|$)/.test(location.search);

// =============================================================================
// CONFIG
// =============================================================================
const CONFIG = {
  W: 540, H: 960,
  SAVE_KEY: 'lantern-moth', LANG_KEY: 'lantern-moth-lang',
  HUD_H: 110,
  FAIL_RESTART_MS: 1100, // 실패 연출 뒤 자동 재시작
  HINT_EVERY: 3,         // 밤 N개를 처음 클리어할 때마다 힌트 1개 적립(보상형 광고의 비광고 대체)
  HINT_AFTER_FAILS: 2,   // 이 횟수 실패하면 힌트 버튼 강조
  SFX_VOLUME: 0.55,
  TRAIL_EVERY_MS: 40,
};
const W = CONFIG.W, H = CONFIG.H;
const FONT = "'Montserrat', system-ui, sans-serif";
const FONT_D = "'Yuji Syuku', 'Montserrat', system-ui, serif"; // 디스플레이(제목·밤 이름·클리어)
const ADD = Phaser.BlendModes.ADD;
const PREVIEW_MAX = 6; // 1.2d: 15밤부터의 미리보기 예산(밤마다 리셋, 착지마다 +1 회복)
const FLOOR_Y = 850; // 1.2d: 네 장 배경 공통 마루 윗선 — 켜진 등불의 바닥 빛이 여기에 깔린다
const MAX_GW = 1720; // 1.2e: 가로 iframe 에서 논리 폭을 비율에 맞춰 넓힌다(세로 기둥 대신 양옆 밤 풍경 + 버튼)
const DEPTH = { BG: 0, WIND: 3, WEB: 4, POOL: 2, GLOW: 6, REACH: 5, LAMP: 10, LINE: 12, TRAIL: 14, MOTH: 16, FX: 30, HUD: 70, OVERLAY: 100, MODAL: 110, TOAST: 130 };
const PAL = {
  night0: 0x070a1a, night1: 0x141b3c, nightMid: 0x1b2347,
  lampCore: 0xffe2a8, lampGlow: 0xffb347, lampEdge: 0xff7a1a, lampOff: 0x3a3f5c,
  candleCore: 0xffd27a, candleGlow: 0xff5a2e, danger: 0xff3b3b,
  homeCore: 0xfff3d6, homeGlow: 0xffc46b, homeFrame: 0x3a2a1e,
  moth: 0xf3e9d2, mothMark: 0xc9a27e, mothEye: 0x5b4636, dust: 0xfff1c9,
  web: 0x9da7c7, teal: 0x1ba39c, red: 0xc8373b, gold: 0xd9a441, ink: 0x1a1612,
  text: 0xfff4e0, textDim: 0xb9b2a3,
};
const css = (h) => '#' + h.toString(16).padStart(6, '0');

// =============================================================================
// i18n (11개 언어 — 회색 박스 단계 최소 키)
// =============================================================================
const STRINGS = {
  en: { title: 'LANTERN MOTH', tagline: 'You never touch the moth. Only the lights.', play: 'PLAY', night: 'Night {n}', taps: 'Taps', par: 'Par', cleared: 'Night {n} cleared', next: 'NEXT', retry: 'RETRY', home: 'HOME', burned: 'Burned!', webbed: 'Caught in silk!', lostNight: 'Lost in the night…', howTo: 'Tap a paper lantern to light it — the moth flies to the nearest light. Tap it again to snuff it and set the moth free.', allDone: 'You guided the moth through every night.', levels: 'NIGHTS', hintLight: 'Tap the lantern to light it', hintSnuff: 'Tap the lit lantern to let the moth go', rewind: 'Rewind', chapter: 'Chapter {n}', hintHold: 'Hold a lantern to preview the flight, release to light it', previews: 'Previews', noPreview: 'No previews left', hint: 'Hint', hintAd: 'Watch an ad for a firefly hint', hintGot: '+1 firefly hint', hintFree: 'Firefly hint', back: 'BACK', moths: 'MOTHS', unlockAt: 'Clear {n} nights', newMoth: 'New moth: {name}', tipLumen: 'Brighter lights look closer to the moth — it picks the brightest-looking one', previewTip: 'Previews are limited from here on — landing on a safe lantern earns one back' },
  ko: { title: 'LANTERN MOTH', tagline: '나방은 만질 수 없어요. 오직 불빛만.', play: '시작', night: '{n}번째 밤', taps: '탭', par: '기준', cleared: '{n}번째 밤 통과', next: '다음', retry: '다시', home: '홈', burned: '타버렸어요!', webbed: '거미줄에 걸렸어요!', lostNight: '밤 속에서 길을 잃었어요…', howTo: '종이등을 탭하면 불이 켜지고, 나방은 가장 가까운 불빛으로 날아가요. 다시 탭하면 불을 꺼서 나방을 놓아줘요.', allDone: '모든 밤을 무사히 건넜어요.', levels: '밤', hintLight: '등불을 탭해 불을 켜세요', hintSnuff: '켜진 등불을 탭해 나방을 놓아주세요', rewind: '되감기', chapter: '{n}장', hintHold: '등불을 길게 누르면 날아갈 길이 보여요. 떼면 켜져요', previews: '미리보기', noPreview: '미리보기를 다 썼어요', hint: '힌트', hintAd: '광고를 보고 반딧불 힌트 받기', hintGot: '반딧불 힌트 +1', hintFree: '반딧불 힌트', back: '뒤로', moths: '나방 도감', unlockAt: '밤 {n}개 클리어', newMoth: '새 나방: {name}', tipLumen: '밝은 불일수록 나방에겐 더 가까워 보여요 — 가장 밝아 보이는 불로 가요', previewTip: '여기부터 미리보기는 제한돼요 — 안전한 등불에 앉을 때마다 1회 회복' },
  ja: { title: 'LANTERN MOTH', tagline: '蛾には触れない。灯りだけ。', play: 'プレイ', night: '{n}夜目', taps: 'タップ', par: '基準', cleared: '{n}夜目クリア', next: '次へ', retry: 'リトライ', home: 'ホーム', burned: '燃えてしまった！', webbed: '蜘蛛の糸に捕まった！', lostNight: '夜に迷ってしまった…', howTo: '提灯をタップすると灯り、蛾は一番近い灯りへ飛びます。もう一度タップして消すと、蛾は自由に。', allDone: 'すべての夜を導き切りました。', levels: '夜', hintLight: '提灯をタップして灯す', hintSnuff: '灯った提灯をタップして蛾を放す', rewind: '巻き戻し', back: '戻る', moths: '蛾図鑑', unlockAt: '{n}夜クリアで解放', newMoth: '新しい蛾：{name}', chapter: '第{n}章', hintHold: '提灯を長押しで飛ぶ道を予告、離すと点灯', previews: 'プレビュー', noPreview: 'プレビューを使い切りました', hint: 'ヒント', hintAd: '広告を見てホタルのヒントをもらう', hintGot: 'ホタルのヒント +1', hintFree: 'ホタルのヒント', tipLumen: '明るい灯りほど蛾には近く見えます — 一番明るく見える灯りへ飛びます', previewTip: 'ここからプレビューは回数制限 — 安全な提灯に止まるたびに1回回復' },
  zh: { title: 'LANTERN MOTH', tagline: '你无法触碰飞蛾，只能操控灯火。', play: '开始', night: '第 {n} 夜', taps: '点击', par: '标准', cleared: '第 {n} 夜通过', next: '下一关', retry: '重试', home: '主页', burned: '被烧到了！', webbed: '被蛛丝缠住了！', lostNight: '迷失在夜色中…', howTo: '点击纸灯笼点亮它，飞蛾会飞向最近的灯火。再次点击熄灭，放飞蛾离开。', allDone: '你已引导飞蛾穿过每一个夜晚。', levels: '夜', hintLight: '点击灯笼点亮', hintSnuff: '点击亮着的灯笼放飞蛾走', rewind: '倒回', back: '返回', moths: '飞蛾图鉴', unlockAt: '通关{n}夜解锁', newMoth: '新飞蛾：{name}', chapter: '第{n}章', hintHold: '长按灯笼可预览飞行路线，松开点亮', previews: '预览', noPreview: '预览次数已用完', hint: '提示', hintAd: '观看广告获得萤火提示', hintGot: '萤火提示 +1', hintFree: '萤火提示', tipLumen: '越亮的灯在飞蛾眼里越近——它会飞向看起来最亮的灯', previewTip: '从这里开始预览次数有限——落在安全的灯笼上可恢复一次' },
  es: { title: 'LANTERN MOTH', tagline: 'Nunca tocas a la polilla. Solo las luces.', play: 'JUGAR', night: 'Noche {n}', taps: 'Toques', par: 'Par', cleared: 'Noche {n} superada', next: 'SIGUIENTE', retry: 'REINTENTAR', home: 'INICIO', burned: '¡Se quemó!', webbed: '¡Atrapada en la seda!', lostNight: 'Perdida en la noche…', howTo: 'Toca un farol para encenderlo: la polilla vuela a la luz más cercana. Tócalo de nuevo para apagarlo y liberarla.', allDone: 'Guiaste a la polilla por todas las noches.', levels: 'NOCHES', hintLight: 'Toca el farol para encenderlo', hintSnuff: 'Toca el farol encendido para soltar a la polilla', rewind: 'Rebobinar', back: 'ATRÁS', moths: 'POLILLAS', unlockAt: 'Supera {n} noches', newMoth: 'Nueva polilla: {name}', chapter: 'Capítulo {n}', hintHold: 'Mantén pulsado un farol para ver el vuelo; suelta para encenderlo', previews: 'Vistas previas', noPreview: 'Sin vistas previas', hint: 'Pista', hintAd: 'Ver un anuncio para una pista luciérnaga', hintGot: '+1 pista luciérnaga', hintFree: 'Pista luciérnaga', tipLumen: 'Las luces más brillantes parecen más cercanas a la polilla: elige la que parece más brillante', previewTip: 'Desde aquí las vistas previas son limitadas: posarse en un farol seguro devuelve una' },
  pt: { title: 'LANTERN MOTH', tagline: 'Você nunca toca na mariposa. Só nas luzes.', play: 'JOGAR', night: 'Noite {n}', taps: 'Toques', par: 'Par', cleared: 'Noite {n} concluída', next: 'PRÓXIMA', retry: 'TENTAR DE NOVO', home: 'INÍCIO', burned: 'Queimou!', webbed: 'Presa na teia!', lostNight: 'Perdida na noite…', howTo: 'Toque numa lanterna para acendê-la: a mariposa voa para a luz mais próxima. Toque de novo para apagar e libertá-la.', allDone: 'Você guiou a mariposa por todas as noites.', levels: 'NOITES', hintLight: 'Toque na lanterna para acender', hintSnuff: 'Toque na lanterna acesa para soltar a mariposa', rewind: 'Voltar', back: 'VOLTAR', moths: 'MARIPOSAS', unlockAt: 'Vença {n} noites', newMoth: 'Nova mariposa: {name}', chapter: 'Capítulo {n}', hintHold: 'Segure uma lanterna para ver o voo; solte para acendê-la', previews: 'Prévias', noPreview: 'Sem prévias', hint: 'Dica', hintAd: 'Veja um anúncio para uma dica vaga-lume', hintGot: '+1 dica vaga-lume', hintFree: 'Dica vaga-lume', tipLumen: 'Luzes mais fortes parecem mais próximas da mariposa: ela escolhe a que parece mais forte', previewTip: 'Daqui em diante as prévias são limitadas: pousar numa lanterna segura devolve uma' },
  fr: { title: 'LANTERN MOTH', tagline: 'On ne touche jamais le papillon. Seulement les lumières.', play: 'JOUER', night: 'Nuit {n}', taps: 'Touches', par: 'Par', cleared: 'Nuit {n} réussie', next: 'SUIVANT', retry: 'REJOUER', home: 'ACCUEIL', burned: 'Brûlé !', webbed: 'Pris dans la toile !', lostNight: 'Perdu dans la nuit…', howTo: 'Touchez une lanterne pour l’allumer : le papillon vole vers la lumière la plus proche. Touchez-la encore pour l’éteindre et le libérer.', allDone: 'Vous avez guidé le papillon à travers toutes les nuits.', levels: 'NUITS', hintLight: 'Touchez la lanterne pour l’allumer', hintSnuff: 'Touchez la lanterne allumée pour libérer le papillon', rewind: 'Revenir', back: 'RETOUR', moths: 'PAPILLONS', unlockAt: 'Réussis {n} nuits', newMoth: 'Nouveau papillon : {name}', chapter: 'Chapitre {n}', hintHold: 'Maintiens une lanterne pour voir le vol, relâche pour l\'allumer', previews: 'Aperçus', noPreview: 'Plus d\'aperçus', hint: 'Indice', hintAd: 'Regarder une pub pour un indice luciole', hintGot: '+1 indice luciole', hintFree: 'Indice luciole', tipLumen: 'Les lumières plus vives semblent plus proches au papillon : il choisit la plus vive', previewTip: 'À partir d\'ici les aperçus sont limités : se poser sur une lanterne sûre en rend un' },
  de: { title: 'LANTERN MOTH', tagline: 'Du berührst die Motte nie. Nur die Lichter.', play: 'SPIELEN', night: 'Nacht {n}', taps: 'Tipps', par: 'Par', cleared: 'Nacht {n} geschafft', next: 'WEITER', retry: 'NOCHMAL', home: 'START', burned: 'Verbrannt!', webbed: 'Im Netz gefangen!', lostNight: 'In der Nacht verloren…', howTo: 'Tippe eine Laterne an, um sie anzuzünden – die Motte fliegt zum nächsten Licht. Tippe erneut, um sie zu löschen und die Motte freizulassen.', allDone: 'Du hast die Motte durch jede Nacht geführt.', levels: 'NÄCHTE', hintLight: 'Tippe die Laterne an, um sie anzuzünden', hintSnuff: 'Tippe die brennende Laterne an, um die Motte freizulassen', rewind: 'Zurück', back: 'ZURÜCK', moths: 'MOTTEN', unlockAt: 'Schaffe {n} Nächte', newMoth: 'Neue Motte: {name}', chapter: 'Kapitel {n}', hintHold: 'Laterne gedrückt halten zeigt den Flug, loslassen zündet sie an', previews: 'Vorschauen', noPreview: 'Keine Vorschau mehr', hint: 'Tipp', hintAd: 'Werbung ansehen für einen Glühwürmchen-Tipp', hintGot: '+1 Glühwürmchen-Tipp', hintFree: 'Glühwürmchen-Tipp', tipLumen: 'Hellere Lichter wirken für die Motte näher – sie wählt das hellste', previewTip: 'Ab hier sind Vorschauen begrenzt – jede Landung auf einer sicheren Laterne gibt eine zurück' },
  it: { title: 'LANTERN MOTH', tagline: 'Non tocchi mai la falena. Solo le luci.', play: 'GIOCA', night: 'Notte {n}', taps: 'Tocchi', par: 'Par', cleared: 'Notte {n} superata', next: 'AVANTI', retry: 'RIPROVA', home: 'HOME', burned: 'Bruciata!', webbed: 'Presa nella tela!', lostNight: 'Persa nella notte…', howTo: 'Tocca una lanterna per accenderla: la falena vola verso la luce più vicina. Toccala di nuovo per spegnerla e liberarla.', allDone: 'Hai guidato la falena attraverso ogni notte.', levels: 'NOTTI', hintLight: 'Tocca la lanterna per accenderla', hintSnuff: 'Tocca la lanterna accesa per liberare la falena', rewind: 'Indietro', back: 'INDIETRO', moths: 'FALENE', unlockAt: 'Supera {n} notti', newMoth: 'Nuova falena: {name}', chapter: 'Capitolo {n}', hintHold: 'Tieni premuta una lanterna per vedere il volo, rilascia per accenderla', previews: 'Anteprime', noPreview: 'Anteprime finite', hint: 'Aiuto', hintAd: 'Guarda un annuncio per un aiuto lucciola', hintGot: '+1 aiuto lucciola', hintFree: 'Aiuto lucciola', tipLumen: 'Le luci più intense sembrano più vicine alla falena: sceglie la più intensa', previewTip: 'Da qui le anteprime sono limitate: posarsi su una lanterna sicura ne restituisce una' },
  tr: { title: 'LANTERN MOTH', tagline: 'Güveye asla dokunmazsın. Sadece ışıklara.', play: 'OYNA', night: 'Gece {n}', taps: 'Dokunuş', par: 'Par', cleared: 'Gece {n} tamamlandı', next: 'SONRAKİ', retry: 'TEKRAR', home: 'ANA SAYFA', burned: 'Yandı!', webbed: 'Ağa yakalandı!', lostNight: 'Gecede kayboldu…', howTo: 'Bir fenere dokunarak yak: güve en yakın ışığa uçar. Tekrar dokunarak söndür ve güveyi serbest bırak.', allDone: 'Güveyi her geceden geçirdin.', levels: 'GECELER', hintLight: 'Feneri yakmak için dokun', hintSnuff: 'Güveyi bırakmak için yanan fenere dokun', rewind: 'Geri sar', back: 'GERİ', moths: 'GÜVELER', unlockAt: '{n} gece geç', newMoth: 'Yeni güve: {name}', chapter: 'Bölüm {n}', hintHold: 'Feneri basılı tut: uçuş yolu görünür, bırakınca yanar', previews: 'Önizleme', noPreview: 'Önizleme kalmadı', hint: 'İpucu', hintAd: 'Ateşböceği ipucu için reklam izle', hintGot: '+1 ateşböceği ipucu', hintFree: 'Ateşböceği ipucu', tipLumen: 'Parlak ışıklar güveye daha yakın görünür — en parlak görüneni seçer', previewTip: 'Buradan itibaren önizleme sınırlı — güvenli bir fenere konmak bir tane geri verir' },
  ru: { title: 'LANTERN MOTH', tagline: 'Мотылька нельзя трогать. Только огни.', play: 'ИГРАТЬ', night: 'Ночь {n}', taps: 'Нажатия', par: 'Пар', cleared: 'Ночь {n} пройдена', next: 'ДАЛЕЕ', retry: 'ЗАНОВО', home: 'ДОМОЙ', burned: 'Сгорел!', webbed: 'Попал в паутину!', lostNight: 'Потерялся в ночи…', howTo: 'Нажмите на фонарь, чтобы зажечь его — мотылёк летит к ближайшему свету. Нажмите снова, чтобы погасить и отпустить его.', allDone: 'Вы провели мотылька через все ночи.', levels: 'НОЧИ', hintLight: 'Нажмите на фонарь, чтобы зажечь', hintSnuff: 'Нажмите на горящий фонарь, чтобы отпустить мотылька', rewind: 'Назад', back: 'НАЗАД', moths: 'МОТЫЛЬКИ', unlockAt: 'Пройди ночей: {n}', newMoth: 'Новый мотылёк: {name}', chapter: 'Глава {n}', hintHold: 'Удерживай фонарь: увидишь путь, отпусти, и он зажжётся', previews: 'Предпросмотр', noPreview: 'Предпросмотры закончились', hint: 'Подсказка', hintAd: 'Посмотреть рекламу за подсказку-светлячка', hintGot: '+1 подсказка-светлячок', hintFree: 'Подсказка-светлячок', tipLumen: 'Яркие огни кажутся мотыльку ближе — он выбирает самый яркий', previewTip: 'Отсюда предпросмотры ограничены — посадка на безопасный фонарь возвращает один' },
};
// 나방 도감 — 밤을 처음 클리어한 수(cleared)로 해금. 스프라이트는 moth.png 의 코드 리컬러(tools/imggen/recolor.mjs)
const MOTHS = [
  { key: 'moth', need: 0, name: { en: 'Ivory Moth', ko: '상아나방', ja: 'アイボリー蛾', zh: '象牙蛾', es: 'Polilla marfil', pt: 'Mariposa marfim', fr: 'Papillon ivoire', de: 'Elfenbeinmotte', it: 'Falena avorio', tr: 'Fildişi güve', ru: 'Мотылёк цвета слоновой кости' } },
  { key: 'moth_jade', need: 5, name: { en: 'Jade Moth', ko: '비취나방', ja: '翡翠蛾', zh: '翡翠蛾', es: 'Polilla jade', pt: 'Mariposa jade', fr: 'Papillon jade', de: 'Jademotte', it: 'Falena giada', tr: 'Yeşim güve', ru: 'Нефритовый мотылёк' } },
  { key: 'moth_plum', need: 10, name: { en: 'Plum Moth', ko: '매화나방', ja: '梅蛾', zh: '梅花蛾', es: 'Polilla ciruela', pt: 'Mariposa ameixa', fr: 'Papillon prune', de: 'Pflaumenmotte', it: 'Falena prugna', tr: 'Erik güve', ru: 'Сливовый мотылёк' } },
  { key: 'moth_ember', need: 16, name: { en: 'Ember Moth', ko: '불씨나방', ja: '燠蛾', zh: '余烬蛾', es: 'Polilla brasa', pt: 'Mariposa brasa', fr: 'Papillon braise', de: 'Glutmotte', it: 'Falena brace', tr: 'Kor güve', ru: 'Мотылёк-уголёк' } },
  { key: 'moth_moon', need: 24, name: { en: 'Moon Moth', ko: '달나방', ja: '月蛾', zh: '月蛾', es: 'Polilla luna', pt: 'Mariposa lua', fr: 'Papillon lune', de: 'Mondmotte', it: 'Falena luna', tr: 'Ay güve', ru: 'Лунный мотылёк' } },
  { key: 'moth_indigo', need: 34, name: { en: 'Indigo Moth', ko: '쪽빛나방', ja: '藍蛾', zh: '靛蓝蛾', es: 'Polilla índigo', pt: 'Mariposa índigo', fr: 'Papillon indigo', de: 'Indigomotte', it: 'Falena indaco', tr: 'Çivit güve', ru: 'Индиговый мотылёк' } },
];
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
// SFX (절차적 Web Audio) — 밤마당 톤: 부드러운 종·숨소리·불똥
// =============================================================================
const SFX = {
  ctx: null, master: null, _userMuted: false, _adMuted: false, _unlocked: false,
  _ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = CONFIG.SFX_VOLUME; const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 10; comp.attack.value = 0.003; comp.release.value = 0.16; this.master.connect(comp); comp.connect(this.ctx.destination); } catch (e) { this.ctx = null; }
    return this.ctx;
  },
  unlock() { const c = this._ensure(); if (!c) return; if (c.state === 'suspended') c.resume(); if (!this._unlocked) { try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0); this._unlocked = true; } catch (e) {} } },
  setUserMuted(m) { this._userMuted = !!m; }, setAdMuted(m) { this._adMuted = !!m; },
  _on() { return this.ctx && !this._userMuted && !this._adMuted; },
  _tone(o) { if (!this._on()) return; const c = this.ctx, t0 = c.currentTime + (o.delay || 0), dur = o.dur || 0.12, vol = o.vol == null ? 0.3 : o.vol, atk = o.attack || 0.006; const osc = c.createOscillator(), g = c.createGain(); osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.freq, t0); if (o.sweepTo) osc.frequency.exponentialRampToValueAtTime(o.sweepTo, t0 + dur); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + atk); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); osc.connect(g); g.connect(this.master); osc.start(t0); osc.stop(t0 + dur + 0.03); },
  _bell(freq, dur, vol, delay) { this._tone({ freq, type: 'sine', dur, vol, delay, attack: 0.004 }); this._tone({ freq: freq * 2.76, type: 'sine', dur: dur * 0.5, vol: vol * 0.22, delay, attack: 0.003 }); },
  _noise(dur, vol, delay, lp, hp) { if (!this._on()) return; const c = this.ctx, t0 = c.currentTime + (delay || 0), n = Math.floor(c.sampleRate * dur); const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n); const src = c.createBufferSource(); src.buffer = buf; const g = c.createGain(); g.gain.value = vol == null ? 0.15 : vol; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 2200; let last = f; if (hp) { const h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; f.connect(h); last = h; } src.connect(f); last.connect(g); g.connect(this.master); src.start(t0); },
  light() { this._noise(0.18, 0.08, 0, 3000, 600); this._bell(880, 0.35, 0.12, 0.03); },
  snuff() { this._noise(0.22, 0.1, 0, 1200); this._tone({ freq: 520, sweepTo: 260, type: 'sine', dur: 0.18, vol: 0.06 }); },
  arrive() { this._bell(1320, 0.12, 0.05, 0); },
  retarget() { this._tone({ freq: 1760, type: 'sine', dur: 0.04, vol: 0.025 }); },
  burn() { this._noise(0.5, 0.2, 0, 2600, 300); this._tone({ freq: 220, sweepTo: 70, type: 'sawtooth', dur: 0.45, vol: 0.1 }); this._tone({ freq: 2200, sweepTo: 900, type: 'square', dur: 0.12, vol: 0.03 }); },
  web() { this._tone({ freq: 180, sweepTo: 90, type: 'triangle', dur: 0.25, vol: 0.14 }); this._noise(0.12, 0.06, 0, 900); },
  oilOut() { this._noise(0.3, 0.07, 0, 900); this._tone({ freq: 400, sweepTo: 200, type: 'sine', dur: 0.3, vol: 0.05 }); },
  win() { [659, 784, 988, 1319].forEach((f, i) => this._bell(f, 0.5, 0.11, i * 0.11)); this._noise(0.6, 0.04, 0.2, 4000, 1500); },
  button() { this._tone({ freq: 620, type: 'sine', dur: 0.05, vol: 0.1 }); },
  wake() { this._noise(0.12, 0.05, 0, 3500, 1200); this._bell(1760, 0.18, 0.05, 0.02); },
  danger() { this._tone({ freq: 110, sweepTo: 70, type: 'triangle', dur: 0.35, vol: 0.16 }); this._noise(0.25, 0.05, 0, 700); },
  heart() { this._tone({ freq: 90, sweepTo: 60, type: 'sine', dur: 0.16, vol: 0.18 }); },
  star(i) { this._bell(1046 * Math.pow(2, i / 12 * 3), 0.3, 0.09, 0); },
};
const MUSIC = createMusic({ getCtx: () => SFX._ensure(), song: SONGS.lanternMoth });

// =============================================================================
// 씬
// =============================================================================
class Game extends Phaser.Scene {
  constructor() { super('game'); }

  preload() {
    // 생성 아트(4단계, 2026-10-22). 없거나 실패해도 절차적 텍스처 폴백(_tex 가 'img_' 접두 키 존재 여부로 선택).
    this.load.image('img_bg', './assets/bg.jpg');
    for (const k of ['pond', 'temple', 'festival', 'snow', 'harbor']) this.load.image('img_bg_' + k, `./assets/bg_${k}.jpg`);
    for (const k of ['moth', 'moth_jade', 'moth_plum', 'moth_ember', 'moth_moon', 'moth_indigo', 'lamp_on', 'lamp_off', 'lamp2_on', 'lamp2_off', 'lamp3_on', 'lamp3_off', 'lamp4_on', 'lamp4_off', 'oil_on', 'oil_off', 'oil_spent', 'fixed', 'candle', 'home', 'web']) this.load.image('img_' + k, `./assets/sprites/${k}.png`);
    this.load.on('loaderror', () => {});
  }

  create() {
    this.save = this._loadSave();
    SFX.setUserMuted(!!this.save.mute);
    MUSIC.setMute(!!this.save.musicMute); this.game.sound.mute = !!this.save.musicMute;
    this.state = 'title'; this.sim = null; this.levelIdx = 0; this.attempt = 0;
    this.groups = { title: [], hud: [], play: [], win: [], nights: [], moths: [] };
    this._buildTextures();
    this._buildBg();
    this.world = this.add.container(0, 0).setDepth(DEPTH.LAMP);
    this.lineGfx = this.add.graphics().setDepth(DEPTH.LINE);
    this.ringGfx = this.add.graphics().setDepth(DEPTH.LAMP + 1);
    this._buildHUD();
    this._buildTitle();
    this._buildWin();
    this._buildNights();
    this._buildMoths();
    this._buildInput();
    this._showTitle();
    if (QA_HOOKS) { window.__game = this.game; window.__SFX = SFX; window.__MUSIC = MUSIC; window.__GDFlow = GDFlow; window.__scene = this; }
  }

  // ---------------------------------------------------------------------------
  // 세이브 (타입 가드)
  // ---------------------------------------------------------------------------
  _loadSave() {
    const m = loadJSON(CONFIG.SAVE_KEY, {}) || {};
    const int = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(0, n) : d; };
    const stars = (m.stars && typeof m.stars === 'object' && !Array.isArray(m.stars)) ? m.stars : {};
    const clean = {};
    for (const k of Object.keys(stars)) clean[k] = clamp(int(stars[k], 0), 0, 3);
    return { unlocked: clamp(int(m.unlocked, 0), 0, LEVELS.length - 1), stars: clean, mute: !!m.mute, musicMute: !!m.musicMute, seenHow: !!m.seenHow, seenHold: !!m.seenHold, seenLumen: !!m.seenLumen, seenBudget: !!m.seenBudget, hints: clamp(int(m.hints, 0), 0, 99), hintBank: clamp(int(m.hintBank, 0), 0, 99), moth: MOTHS.some((x) => x.key === m.moth) ? m.moth : 'moth' };
  }
  _save() { saveJSON(CONFIG.SAVE_KEY, this.save); }
  _cleared() { return LEVELS.filter((l) => this.save.stars[l.id]).length; } // 현재 레벨에 있는 id 만(이전 버전 세이브 무시)
  _mothUnlocked(m) { return this._cleared() >= m.need; }
  _mothKey() { const m = MOTHS.find((x) => x.key === this.save.moth); return (m && this._mothUnlocked(m)) ? m.key : 'moth'; }

  // ---------------------------------------------------------------------------
  // 텍스처(절차적) — 글로우·등불·촛불·집·나방·거미줄·바람 결
  // ---------------------------------------------------------------------------
  // 이미지 에셋이 있으면 그 키, 없으면 절차적 텍스처 키
  _tex(k) { return this.textures.exists('img_' + k) ? 'img_' + k : k; }
  // 이미지 스프라이트 표시 높이(절차 텍스처는 원래 크기 그대로)
  _lampKey(on) { const ch = chapterOf(this.levelIdx); const k = (LAMP_SET[ch] || 'lamp') + '_' + (on ? 'on' : 'off'); return this.textures.exists('img_' + k) ? k : (on ? 'lamp_on' : 'lamp_off'); } // 1.2c: 장별 등불
  _fitH(img, k) { const H_ = { moth: 112, moth_jade: 112, moth_plum: 112, moth_ember: 112, moth_moon: 112, moth_indigo: 112, lamp_on: 106, lamp_off: 106, lamp2_on: 101, lamp2_off: 101, lamp3_on: 110, lamp3_off: 110, lamp4_on: 104, lamp4_off: 104, oil_on: 80, oil_off: 80, oil_spent: 80, fixed: 108, candle: 72, home: 112 }[k]; if (img.texture.key.startsWith('img_') && H_) { const sc = H_ / img.height; img.setScale(sc); img._baseScale = sc; } else img._baseScale = 1; return img; }
  _makeCanvas(key, w, h, draw) {
    if (this.textures.exists(key)) return;
    const tex = this.textures.createCanvas(key, w, h); const ctx = tex.getContext();
    draw(ctx, w, h); tex.refresh();
  }
  _buildTextures() {
    // 부드러운 원형 글로우(흰색 → 틴트로 색 입힘)
    this._makeCanvas('glow', 256, 256, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    // 도달 반경 링(얇은 외곽만)
    this._makeCanvas('reach', 256, 256, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.85, 'rgba(255,255,255,0.05)'); g.addColorStop(0.97, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    // 작은 점(먼지·파티클)
    this._makeCanvas('dot', 16, 16, (ctx, w, h) => { const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
    // 청사초롱(on/off) — 한지 몸통 + 대나무 살 + 술
    const lantern = (on) => (ctx, w, h) => {
      const cx = w / 2;
      ctx.strokeStyle = on ? '#f6c56a' : '#4a5070'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, 2); ctx.lineTo(cx, 12); ctx.stroke();
      ctx.fillStyle = on ? '#2b2420' : '#232738'; ctx.fillRect(cx - 12, 10, 24, 5);
      const body = ctx.createLinearGradient(cx - 18, 0, cx + 18, 0);
      if (on) { body.addColorStop(0, '#ff8a2a'); body.addColorStop(0.45, '#ffe2a8'); body.addColorStop(1, '#ff9a3a'); } else { body.addColorStop(0, '#262a40'); body.addColorStop(0.5, '#363b57'); body.addColorStop(1, '#262a40'); }
      ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(cx - 14, 15); ctx.quadraticCurveTo(cx - 24, 38, cx - 14, 62); ctx.lineTo(cx + 14, 62); ctx.quadraticCurveTo(cx + 24, 38, cx + 14, 15); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = on ? 'rgba(120,60,20,0.55)' : 'rgba(80,88,120,0.8)'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) { const y = 24 + i * 13; ctx.beginPath(); ctx.moveTo(cx - 19 + i * 0.5, y); ctx.lineTo(cx + 19 - i * 0.5, y); ctx.stroke(); }
      ctx.stroke(); ctx.fillStyle = on ? '#2b2420' : '#232738'; ctx.fillRect(cx - 12, 61, 24, 5);
      ctx.strokeStyle = on ? '#c8373b' : '#3a3f5c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, 66); ctx.lineTo(cx, 78); ctx.stroke();
      ctx.fillStyle = on ? '#d9a441' : '#3a3f5c'; ctx.fillRect(cx - 4, 76, 8, 10);
    };
    this._makeCanvas('lamp_on', 56, 90, lantern(true));
    this._makeCanvas('lamp_off', 56, 90, lantern(false));
    // 기름등(on/off/spent) — 둥근 유리 + 받침
    const oil = (mode) => (ctx, w, h) => {
      const cx = w / 2; const on = mode === 'on';
      ctx.fillStyle = mode === 'spent' ? '#1c1c24' : (on ? '#2b2420' : '#232738'); ctx.fillRect(cx - 14, 60, 28, 8); ctx.fillRect(cx - 6, 50, 12, 12);
      const g = ctx.createRadialGradient(cx - 4, 30, 2, cx, 32, 24);
      if (on) { g.addColorStop(0, '#fff6d0'); g.addColorStop(0.4, '#ffc46b'); g.addColorStop(1, 'rgba(255,122,26,0.35)'); } else if (mode === 'spent') { g.addColorStop(0, '#2a2a33'); g.addColorStop(1, '#15151c'); } else { g.addColorStop(0, '#3a3f5c'); g.addColorStop(1, '#232738'); }
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, 32, 20, 24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = on ? 'rgba(255,226,168,0.7)' : 'rgba(110,118,150,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(cx, 32, 20, 24, 0, 0, Math.PI * 2); ctx.stroke();
      if (on) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(cx, 38, 4, 9, 0, 0, Math.PI * 2); ctx.fill(); }
    };
    this._makeCanvas('oil_on', 56, 72, oil('on')); this._makeCanvas('oil_off', 56, 72, oil('off')); this._makeCanvas('oil_spent', 56, 72, oil('spent'));
    // 처마 등 — 큰 사각 등, 줄에 매달림
    this._makeCanvas('fixed', 64, 100, (ctx, w, h) => {
      const cx = w / 2; ctx.strokeStyle = '#6b5a3e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, 16); ctx.stroke();
      ctx.fillStyle = '#2b2420'; ctx.fillRect(cx - 20, 14, 40, 6);
      const g = ctx.createLinearGradient(0, 20, 0, 80); g.addColorStop(0, '#ffd27a'); g.addColorStop(0.5, '#ffe9bf'); g.addColorStop(1, '#ff9a3a');
      ctx.fillStyle = g; ctx.fillRect(cx - 18, 20, 36, 60);
      ctx.strokeStyle = 'rgba(80,40,10,0.5)'; ctx.lineWidth = 1.5; ctx.strokeRect(cx - 18, 20, 36, 60); ctx.beginPath(); ctx.moveTo(cx, 20); ctx.lineTo(cx, 80); ctx.moveTo(cx - 18, 50); ctx.lineTo(cx + 18, 50); ctx.stroke();
      ctx.fillStyle = '#2b2420'; ctx.fillRect(cx - 20, 80, 40, 6);
    });
    // 촛불 — 촛대 + 불꽃
    this._makeCanvas('candle', 40, 64, (ctx, w, h) => {
      const cx = w / 2; ctx.fillStyle = '#e9dcc2'; ctx.fillRect(cx - 6, 30, 12, 26); ctx.fillStyle = '#3a2a1e'; ctx.fillRect(cx - 12, 54, 24, 6);
      ctx.fillStyle = '#2a2520'; ctx.fillRect(cx - 1, 24, 2, 7);
      const g = ctx.createRadialGradient(cx, 20, 1, cx, 18, 12); g.addColorStop(0, '#fff8d8'); g.addColorStop(0.4, '#ffd27a'); g.addColorStop(1, 'rgba(255,90,46,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, 18, 8, 13, 0, 0, Math.PI * 2); ctx.fill();
    });
    // 집(창가 등불) — 창틀 + 창살
    this._makeCanvas('home', 84, 104, (ctx, w, h) => {
      ctx.fillStyle = '#3a2a1e'; ctx.fillRect(0, 0, w, h);
      const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, 56); g.addColorStop(0, '#fff3d6'); g.addColorStop(0.6, '#ffc46b'); g.addColorStop(1, '#ff9a3a');
      ctx.fillStyle = g; ctx.fillRect(8, 8, w - 16, h - 16);
      ctx.strokeStyle = '#3a2a1e'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(w / 2, 8); ctx.lineTo(w / 2, h - 8); ctx.moveTo(8, h / 2); ctx.lineTo(w - 8, h / 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w / 4 + 4, 8); ctx.lineTo(w / 4 + 4, h - 8); ctx.moveTo(w * 3 / 4 - 4, 8); ctx.lineTo(w * 3 / 4 - 4, h - 8); ctx.moveTo(8, h / 4 + 4); ctx.lineTo(w - 8, h / 4 + 4); ctx.moveTo(8, h * 3 / 4 - 4); ctx.lineTo(w - 8, h * 3 / 4 - 4); ctx.stroke();
    });
    // 나방 — 위에서 본 모습(머리 위쪽). 앞날개(위·바깥으로 뻗음) + 뒷날개 + 두툼한 몸통 + 깃털 더듬이 + 눈알 무늬
    this._makeCanvas('moth', 72, 72, (ctx, w, h) => {
      const cx = 36, cy = 38;
      const wing = (sx) => {
        ctx.save(); ctx.translate(cx, cy); ctx.scale(sx, 1);
        // 앞날개
        ctx.fillStyle = css(PAL.moth); ctx.strokeStyle = 'rgba(90,70,54,0.45)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(3, -4); ctx.quadraticCurveTo(14, -30, 30, -22); ctx.quadraticCurveTo(34, -10, 24, 4); ctx.quadraticCurveTo(14, 8, 3, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
        // 뒷날개
        ctx.fillStyle = '#e6d8b8'; ctx.beginPath(); ctx.moveTo(3, 4); ctx.quadraticCurveTo(22, 6, 22, 20); ctx.quadraticCurveTo(14, 28, 4, 18); ctx.closePath(); ctx.fill(); ctx.stroke();
        // 띠무늬 + 눈알
        ctx.strokeStyle = 'rgba(201,162,126,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(9, -14); ctx.quadraticCurveTo(18, -16, 27, -12); ctx.stroke();
        ctx.fillStyle = css(PAL.mothMark); ctx.beginPath(); ctx.ellipse(20, -6, 4.5, 3.2, -0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = css(PAL.mothEye); ctx.beginPath(); ctx.arc(20, -6, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      };
      wing(1); wing(-1);
      // 몸통(털 느낌의 그라데이션)
      const bg = ctx.createLinearGradient(cx - 5, 0, cx + 5, 0); bg.addColorStop(0, '#b8a688'); bg.addColorStop(0.5, '#efe3c8'); bg.addColorStop(1, '#b8a688');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(cx, cy + 4, 5, 15, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = css(PAL.mothEye); ctx.beginPath(); ctx.arc(cx, cy - 10, 4.2, 0, Math.PI * 2); ctx.fill();
      // 깃털 더듬이
      ctx.strokeStyle = css(PAL.mothEye); ctx.lineWidth = 1.4;
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sx * 2, cy - 13); ctx.quadraticCurveTo(cx + sx * 7, cy - 22, cx + sx * 13, cy - 27); ctx.stroke(); for (let k = 1; k <= 4; k++) { const tt = k / 5; const px = cx + sx * (2 + 11 * tt), py = cy - 13 - 14 * tt; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + sx * 2.5, py - 2); ctx.stroke(); } }
    });
    // 거미줄
    this._makeCanvas('web', 128, 128, (ctx, w, h) => {
      const cx = 64, cy = 64; ctx.strokeStyle = 'rgba(157,167,199,0.75)'; ctx.lineWidth = 1;
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 62, cy + Math.sin(a) * 62); ctx.stroke(); }
      for (let r = 10; r < 62; r += 10) { ctx.beginPath(); for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI * 2, rr = r - 2 + Math.sin(a * 5) * 1.5; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); }
    });
    // 바람 결(가로 줄무늬 타일)
    this._makeCanvas('streak', 64, 16, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 7, w, 2); });
    // 배경(그라데이션 + 별)
    this._makeCanvas('bg', 540, 960, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, css(PAL.night0)); g.addColorStop(0.55, css(PAL.nightMid)); g.addColorStop(1, css(PAL.night1));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // 별
      let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 90; i++) { const x = rnd() * w, y = rnd() * h * 0.7, r = rnd() * 1.2 + 0.3; ctx.fillStyle = `rgba(255,244,224,${0.25 + rnd() * 0.5})`; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
      // 마당 바닥 실루엣(아트 패스 전 임시): 기와 처마선 + 마루
      ctx.fillStyle = '#050714'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, 60); ctx.quadraticCurveTo(w * 0.75, 95, w / 2, 70); ctx.quadraticCurveTo(w * 0.25, 95, 0, 60); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#04060f'; ctx.fillRect(0, h - 34, w, 34);
      ctx.fillStyle = 'rgba(255,196,107,0.05)'; ctx.fillRect(0, h - 36, w, 2);
    });
  }

  // 장 배경으로 교차 전환(0.6s)
  _setChapterBg(ch) {
    const want = CHAPTERS[ch] && this.textures.exists(CHAPTERS[ch].bg) ? CHAPTERS[ch].bg : (this.textures.exists('img_bg') ? 'img_bg' : 'bg');
    if (!this.bg || this.bg.texture.key === want) return;
    const old = this.add.image(W / 2, H / 2, this.bg.texture.key).setDisplaySize(W, H).setDepth(DEPTH.BG + 0.5);
    this.bg.setTexture(want).setDisplaySize(W, H);
    if (this.sideL) { const sk = this._sideKey(want); this.sideL.setTexture(sk).setDisplaySize(W, H); this.sideR.setTexture(sk).setDisplaySize(W, H); this._applyLayout(); }
    this.tweens.add({ targets: old, alpha: 0, duration: 600, onComplete: () => old.destroy() });
  }
  // 1.2e: 가로 iframe — 논리 폭을 부모 비율에 맞춰 넓히고(FIT 이 꽉 채움) 카메라를 밀어 540 기둥을 가운데 둔다.
  //       양옆엔 같은 장 배경을 어둡게 깔고, 되감기·힌트·미리보기 버튼은 마당 양옆으로
  _layoutTick(time) {
    if (time - (this._layoutT || 0) < 250) return; this._layoutT = time;
    const ps = this.scale.parentSize; if (!ps || !ps.width || !ps.height) return;
    const want = Math.max(W, Math.min(MAX_GW, Math.round(H * ps.width / ps.height / 2) * 2));
    if (Math.abs(want - this.scale.gameSize.width) < 4) return;
    this.scale.setGameSize(want, H); this._applyLayout();
  }
  _applyLayout() {
    if (!this.sideL || !this.btnRewind) return;
    const gw = this.scale.gameSize.width; const land = gw >= W + 120; this.landscape = land;
    this.cameras.main.setScroll(-(gw - W) / 2, 0);
    const wide = gw > W + 2; // 1.2j: 조금만 넓어도(2:3 등) 양옆 배경을 깐다 — 검은 띠 방지. 조작부 재배치는 land 일 때만
    this.sideL.setVisible(wide); this.sideR.setVisible(wide); this.sideDim.setVisible(wide).setSize(gw + 8, H).setPosition(W / 2, H / 2);
    this.edgeL.setVisible(wide); this.edgeR.setVisible(wide);
    const px = Math.min(330, gw / 2 - 80);
    if (land && px > 250) { this.btnRewind.moveTo(W / 2 - px, 560); this.hintBtn.moveTo(W / 2 - px, 622); this.previewBtn.moveTo(W / 2 + px, 560); }
    else for (const b of [this.btnRewind, this.hintBtn, this.previewBtn]) b.moveTo(b.homeX, b.homeY);
  }
  _chapterCard(ch) {
    const c = CHAPTERS[ch]; if (!c) return;
    const nm = c.name[currentLang] || c.name.en;
    const a = this.add.text(W / 2, H * 0.30, t('chapter', { n: ch + 1 }).toUpperCase(), { fontFamily: FONT, fontSize: '18px', color: css(PAL.gold), fontStyle: 'bold', letterSpacing: 8 }).setOrigin(0.5).setDepth(DEPTH.TOAST).setAlpha(0);
    const b = this.add.text(W / 2, H * 0.30 + 46, nm, { fontFamily: FONT_D, fontSize: '44px', color: css(PAL.text), fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH.TOAST).setAlpha(0).setShadow(0, 4, 'rgba(0,0,0,0.7)', 12);
    this._fitText(b, W - 60);
    const line = this.add.rectangle(W / 2, H * 0.30 + 82, 10, 2, PAL.gold, 0.8).setDepth(DEPTH.TOAST).setAlpha(0);
    this._fxObj(a); this._fxObj(b); this._fxObj(line);
    this.tweens.add({ targets: [a, b, line], alpha: 1, duration: 420, ease: 'Quad.Out' });
    this.tweens.add({ targets: line, width: 220, duration: 700, ease: 'Quad.Out' });
    this.tweens.add({ targets: [a, b, line], alpha: 0, delay: 1700, duration: 500, onComplete: () => { a.destroy(); b.destroy(); line.destroy(); } });
  }
  // 1.2g: 양옆 반전 배경용 텍스처 — 1장 배경의 달은 지우고(하늘을 왼쪽에서 복사) 쓴다(데스크톱 타이틀에 달이 셋 보이던 버그)
  _sideKey(key) {
    if (key !== 'img_bg' || !this.textures.exists('img_bg')) return key;
    const sk = 'img_bg_side'; if (this.textures.exists(sk)) return sk;
    const src = this.textures.get('img_bg').getSourceImage(); const w = src.width, h = src.height;
    this._makeCanvas(sk, w, h, (ctx) => { ctx.drawImage(src, 0, 0); const mx = Math.round(w * 0.52), my = Math.round(h * 0.37); ctx.drawImage(src, Math.round(w * 0.08), 0, Math.round(w * 0.42), my, mx, 0, w - mx, my); });
    return sk;
  }
  _buildBg() {
    const key = this.textures.exists('img_bg') ? 'img_bg' : 'bg';
    // 1.2e: 가로 배치용 양옆 배경(어둡게) + 기둥 가장자리 페이드
    // 1.2f: 양옆은 같은 장 배경을 좌우 반전해 이어 붙인다(장면이 계속되는 느낌 — '흐린 띠' 지적)
    this.sideL = this.add.image(0, H / 2, this._sideKey(key)).setOrigin(1, 0.5).setFlipX(true).setDisplaySize(W, H).setDepth(DEPTH.BG - 2).setTint(0x9aa0b8).setVisible(false);
    this.sideR = this.add.image(W, H / 2, this._sideKey(key)).setOrigin(0, 0.5).setFlipX(true).setDisplaySize(W, H).setDepth(DEPTH.BG - 2).setTint(0x9aa0b8).setVisible(false);
    this.sideDim = this.add.rectangle(W / 2, H / 2, W, H, 0x05070f, 0.3).setDepth(DEPTH.BG - 1.5).setVisible(false);
    this._makeCanvas('edgefade', 48, 8, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(4,6,16,0.6)'); g.addColorStop(1, 'rgba(4,6,16,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
    this.edgeL = this.add.image(0, H / 2, 'edgefade').setOrigin(0, 0.5).setDisplaySize(48, H).setDepth(DEPTH.BG + 0.7).setVisible(false);
    this.edgeR = this.add.image(W, H / 2, 'edgefade').setOrigin(1, 0.5).setDisplaySize(48, H).setFlipX(true).setDepth(DEPTH.BG + 0.7).setVisible(false);
    this.bg = this.add.image(W / 2, H / 2, key).setDisplaySize(W, H).setDepth(DEPTH.BG);
    // 1.2e: 달빛 — 위에서 내려오는 차가운 빛 워시(ADD, 옅게). 등불의 따뜻한 빛과 대비되어 밤이 덜 평면적으로
    this.moonWash = this.add.image(W * 0.78, 150, 'glow').setDisplaySize(W * 1.6, W * 1.6).setTint(0x8fb0ff).setAlpha(0.13).setBlendMode(ADD).setDepth(DEPTH.BG + 0.8);
    // 전체 화면 어둠(등불이 많이 꺼지면 더 어두워지는 느낌은 4단계에서)
    this.vignette = this.add.image(W / 2, H / 2, 'glow').setDisplaySize(W * 1.9, H * 1.6).setTint(0x000000).setAlpha(0).setDepth(DEPTH.BG + 1);
  }

  // ---------------------------------------------------------------------------
  // 공용 UI
  // ---------------------------------------------------------------------------
  _fitText(txt, maxW) { const base = txt._base || parseInt(txt.style.fontSize, 10) || 22; let s = base; txt.setFontSize(s); while (txt.width > maxW && s > 9) { s -= 1; txt.setFontSize(s); } }
  _button(x, y, w, h, label, onClick, opts = {}) {
    const c = this.add.container(x, y).setDepth(opts.depth || DEPTH.HUD);
    const g = this.add.graphics();
    const tint = opts.tint == null ? PAL.gold : opts.tint;
    const gold = tint === PAL.gold;
    g.fillStyle(0x000000, 0.4); g.fillRoundedRect(-w / 2 + 2, -h / 2 + 6, w, h, 14);
    if (gold) {
      g.fillGradientStyle(0xf0c35a, 0xf0c35a, 0xc08a2a, 0xc08a2a, 1); g.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
      g.fillStyle(0xffffff, 0.18); g.fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h * 0.42, 10);
      g.lineStyle(2, 0x5a3b10, 0.9); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
      g.lineStyle(1, 0xfff0c0, 0.5); g.strokeRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 11);
      g.fillStyle(0xc8373b, 0.9); g.fillCircle(-w / 2 + 14, 0, 3); g.fillCircle(w / 2 - 14, 0, 3);
    } else {
      g.fillGradientStyle(0x2a3050, 0x2a3050, 0x161a2e, 0x161a2e, 1); g.fillRoundedRect(-w / 2, -h / 2, w, h, 14);
      g.lineStyle(2, PAL.teal, 0.7); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 14);
      g.fillStyle(0xffffff, 0.06); g.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h * 0.4, 10);
    }
    const txt = this.add.text(0, 0, label, { fontFamily: FONT, fontSize: (opts.fontSize || 26) + 'px', color: opts.color || css(PAL.ink), fontStyle: 'bold' }).setOrigin(0.5);
    txt._base = opts.fontSize || 26; this._fitText(txt, w - 20);
    c.add([g, txt]); c.txt = txt;
    const z = this.add.zone(x, y, w, h).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth((opts.depth || DEPTH.HUD) + 1);
    z.on('pointerdown', () => { if (!c.visible || GDFlow.isBlocking()) return; this.tweens.add({ targets: c, scaleX: 0.95, scaleY: 0.95, duration: 60, yoyo: true }); });
    z.on('pointerup', () => { if (!c.visible || GDFlow.isBlocking()) return; SFX.button(); onClick(); });
    c.zone = z; c.c = c; c.setVis = (v) => { c.setVisible(v); z.setVisible(v); if (v) z.setInteractive(); else z.disableInteractive(); };
    c.moveTo = (nx, ny) => { c.setPosition(nx, ny); z.setPosition(nx, ny); }; c.homeX = x; c.homeY = y; // 1.2e: 가로 배치용
    if (opts.group) { this.groups[opts.group].push(c); }
    return c;
  }
  _iconButton(x, y, kind, onClick, group) {
    const c = this.add.container(x, y).setDepth(DEPTH.HUD);
    const g = this.add.graphics(); g.fillStyle(0x000000, 0.35); g.fillCircle(0, 0, 24); g.lineStyle(2, PAL.gold, 0.6); g.strokeCircle(0, 0, 24);
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
    else if (kind === 'music' || kind === 'musicOff') { g.fillCircle(-5, 6, 4); g.fillCircle(6, 3, 4); g.lineBetween(-1, 6, -1, -9); g.lineBetween(10, 3, 10, -12); g.lineBetween(-1, -9, 10, -12); if (kind === 'musicOff') { g.lineStyle(3, PAL.red, 1); g.lineBetween(-12, 12, 12, -12); } }
    else if (kind === 'sound' || kind === 'soundOff') { g.fillTriangle(-10, -4, -3, -4, 4, -11); g.fillRect(-10, -4, 7, 8); g.fillTriangle(-3, 4, 4, 11, -10, 4); g.fillRect(-10, -4, 7, 8); g.beginPath(); g.arc(4, 0, 7, -1, 1, false); g.strokePath(); if (kind === 'soundOff') { g.lineStyle(3, PAL.red, 1); g.lineBetween(-12, 12, 12, -12); } }
    else if (kind === 'lang') { g.strokeCircle(0, 0, 10); g.lineBetween(-10, 0, 10, 0); g.lineBetween(0, -10, 0, 10); g.beginPath(); g.arc(0, 0, 10, -Math.PI / 2, Math.PI / 2, false); g.strokePath(); g.strokeEllipse(0, 0, 10, 20); }
  }
  _toast(msg, color, y, plate) {
    const tx = this.add.text(W / 2, y || H * 0.46, msg, { fontFamily: FONT, fontSize: plate ? '17px' : '34px', color: color || css(PAL.text), fontStyle: 'bold', align: 'center', wordWrap: { width: W - 60 }, ...(plate ? { backgroundColor: 'rgba(6,10,26,0.82)', padding: { x: 16, y: 9 } } : {}) }).setOrigin(0.5).setDepth(DEPTH.TOAST).setShadow(0, 3, 'rgba(0,0,0,0.6)', 8).setAlpha(0);
    this.tweens.add({ targets: tx, alpha: 1, y: tx.y - 12, duration: 180, ease: 'Quad.Out' });
    this.tweens.add({ targets: tx, alpha: 0, delay: plate ? 2600 : 900, duration: 300, onComplete: () => tx.destroy() });
    return tx;
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  _buildHUD() {
    const bar = this.add.graphics().setDepth(DEPTH.HUD - 1);
    bar.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.55, 0.55, 0, 0); bar.fillRect(0, 0, W, CONFIG.HUD_H + 20);
    this.groups.hud.push(bar);
    this.hudNight = this.add.text(W / 2, 34, '', { fontFamily: FONT, fontSize: '16px', color: css(PAL.gold), fontStyle: 'bold', letterSpacing: 2 }).setOrigin(0.5).setDepth(DEPTH.HUD);
    this.hudName = this.add.text(W / 2, 62, '', { fontFamily: FONT_D, fontSize: '30px', color: css(PAL.text), fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH.HUD);
    this.hudTaps = this.add.text(W / 2, 92, '', { fontFamily: FONT, fontSize: '15px', color: css(PAL.textDim) }).setOrigin(0.5).setDepth(DEPTH.HUD);
    this.groups.hud.push(this.hudNight, this.hudName, this.hudTaps);
    this.btnHome = this._iconButton(40, 48, 'home', () => this._goHome(), 'hud');
    this.btnRetry = this._iconButton(W - 40, 48, 'retry', () => this._retryByButton(), 'hud');
    // 음악/효과음 토글은 타이틀·HUD 양쪽에서 접근(GD 필수)
    this.btnMusic = this._iconButton(W - 40, 108, this.save.musicMute ? 'musicOff' : 'music', () => this._toggleMusic(), 'hud');
    this.btnSound = this._iconButton(40, 108, this.save.mute ? 'soundOff' : 'sound', () => this._toggleSound(), 'hud');
    // 반딧불 힌트(보상형 광고 / 적립 토큰) — 플레이 중 화면 하단
    this.hintBtn = this._button(W / 2 + 30, H - 42, 150, 50, '', () => this._onHintButton(), { tint: 0x1b3a37, color: css(PAL.text), group: 'hud', fontSize: 18 });
    // 1.2b: 미리보기 예산 — 밤마다 3회(등불을 하나씩 다 눌러 보는 열거 플레이 방지). 다 쓰면 토큰/보상형으로 +3
    this.previewBtn = this._button(W - 80, H - 42, 140, 50, '', () => this._onPreviewRefill(), { tint: 0x2a2238, color: css(PAL.text), group: 'hud', fontSize: 15 });
    // 1.1: 되감기 — 마지막으로 앉았던 등불로(실패하면 자동으로). 긴 퍼즐에서 "처음부터 다시"의 노가다를 없앤다
    this.btnRewind = this._button(82, H - 42, 128, 50, '↶ ' + t('rewind'), () => this._rewind(false), { tint: 0x2a2238, color: css(PAL.text), group: 'hud', fontSize: 17 });
  }
  _refreshPreviewBtn() {
    if (!this.previewBtn) return;
    const n = this.previewsLeft == null ? 3 : this.previewsLeft;
    this.previewBtn.txt.setText(`◉ ${t('previews')} ×${n === Infinity ? '∞' : n}`); this._fitText(this.previewBtn.txt, 124);
    this.previewBtn.setVis(false); this.previewBtn.setAlpha(n > 0 ? 1 : 0.8); // 1.2f: 무제한이라 버튼 숨김(충전 코드는 유지)
  }
  async _onPreviewRefill() {
    if (this.state !== 'playing' || (this.previewsLeft || 0) > 0) { this._toast(t('previews') + ' ' + (this.previewsLeft || 0), css(PAL.teal), H * 0.8); return; }
    if (this.save.hints > 0) { this.save.hints--; this._save(); this.previewsLeft = PREVIEW_MAX; this._refreshPreviewBtn(); this._refreshHintBtn(); SFX.light(); return; }
    const prev = this.state; this.state = 'loading';
    const ok = await GDFlow.playAd('rewarded');
    if (this.state === 'loading') this.state = prev;
    if (ok && this.state === 'playing') { this.previewsLeft = PREVIEW_MAX; SFX.light(); }
    this._refreshPreviewBtn();
  }
  _refreshHintBtn() {
    this._refreshPreviewBtn();
    if (!this.hintBtn) return;
    const n = this.save.hints;
    this.hintBtn.txt.setText(`✦ ${t('hint')}${n > 0 ? ` (${n})` : ''}`); this._fitText(this.hintBtn.txt, 130);
    this.hintBtn.setVis(this.state === 'playing' && !!this.sim && (HINTS[LEVELS[this.levelIdx].id] || []).length > 0 && !this.hintActive);
  }
  async _onHintButton() {
    if (this.state !== 'playing' || this.hintActive) return;
    if (this.save.hints > 0) { this.save.hints--; this._save(); this._showHintMarkers(); return; }
    // 토큰이 없으면 보상형 광고 — SDK_REWARDED_WATCH_COMPLETE 일 때만 지급(GD 규격)
    const prev = this.state; this.state = 'loading';
    const ok = await GDFlow.playAd('rewarded');
    if (this.state === 'loading') this.state = prev;
    if (ok && this.state === 'playing') this._showHintMarkers();
    else this._refreshHintBtn();
  }
  // 해답 순서대로 번호 표식(1,2,3…)을 등불 위에 띄운다. 레벨이 끝나면 사라짐.
  _showHintMarkers(fresh) {
    const seq = HINTS[LEVELS[this.levelIdx].id] || [];
    // 1.1: 해답은 시작 지점 기준 → 처음으로 되감고 표시(fresh = 막 시작한 레벨이라 되감을 필요 없음)
    if (!fresh && this.checkpoints && this.checkpoints.length) { this.checkpoints = [this.checkpoints[0]]; this._rewind(true); }
    this.hintActive = true; this.hintLevel = this.levelIdx; this._hideHint(); this._refreshHintBtn();
    this.hintMarks = [];
    const counts = {};
    seq.forEach((li, k) => {
      const l = this.sim.lamps[li]; if (!l) return;
      counts[li] = (counts[li] || 0) + 1; const slot = counts[li] - 1;
      const g = this.add.graphics().setDepth(DEPTH.TOAST); g.fillStyle(PAL.teal, 0.95); g.fillCircle(0, 0, 15); g.lineStyle(2, PAL.text, 0.9); g.strokeCircle(0, 0, 15);
      const tx = this.add.text(0, 0, String(k + 1), { fontFamily: FONT, fontSize: '17px', color: css(PAL.text), fontStyle: 'bold' }).setOrigin(0.5);
      // 1.1b: 등불 바로 오른쪽 위에 붙이고 등불까지 짧은 연결선(어느 등불의 번호인지 분명하게)
      const ox = 30 + slot * 30, oy = -34;
      const tail = this.add.graphics(); tail.lineStyle(2, PAL.teal, 0.85); tail.lineBetween(-ox + 12, -oy - 8, -11, 9);
      const c = this.add.container(l.x + ox, l.y + oy, [tail, g, tx]).setDepth(DEPTH.TOAST).setAlpha(0);
      this.tweens.add({ targets: c, alpha: 1, y: c.y - 6, duration: 240, delay: k * 90, yoyo: false });
      this.tweens.add({ targets: c, y: '-=5', duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.hintMarks.push(c);
    });
  }
  _clearHintMarkers() { if (this.hintMarks) for (const m of this.hintMarks) m.destroy(); this.hintMarks = null; this.hintActive = false; }
  _toggleMusic() { this.save.musicMute = !this.save.musicMute; MUSIC.setMute(this.save.musicMute); this.game.sound.mute = this.save.musicMute; this._save(); this._refreshAudioIcons(); }
  _toggleSound() { this.save.mute = !this.save.mute; SFX.setUserMuted(this.save.mute); this._save(); this._refreshAudioIcons(); }
  _refreshAudioIcons() {
    for (const b of [this.btnMusic, this.tMusic]) if (b) this._drawIcon(b.icon, this.save.musicMute ? 'musicOff' : 'music');
    for (const b of [this.btnSound, this.tSound]) if (b) this._drawIcon(b.icon, this.save.mute ? 'soundOff' : 'sound');
  }
  _setGroup(name, v) { for (const o of this.groups[name]) { if (o.setVis) o.setVis(v); else o.setVisible(v); } }
  _refreshHud() {
    if (!this.sim) return;
    this._refreshPreviewBtn();
    const lv = LEVELS[this.levelIdx];
    this.hudNight.setText(t('night', { n: this.levelIdx + 1 }).toUpperCase());
    this.hudName.setText(levelName(lv));
    this.hudTaps.setText(`${t('taps')} ${this.sim.taps}  ·  ${t('par')} ${lv.par}`);
  }

  // ---------------------------------------------------------------------------
  // 타이틀
  // ---------------------------------------------------------------------------
  _buildTitle() {
    const dim = this.add.rectangle(W / 2, H / 2, W * 4, H, 0x000000, 0.25).setDepth(DEPTH.OVERLAY - 1); // 1.2e: 가로 배치의 양옆까지
    this.titleLogo = this.add.text(W / 2, 250, t('title'), { fontFamily: FONT_D, fontSize: '58px', color: css(PAL.text), fontStyle: 'bold', align: 'center', letterSpacing: 4 }).setOrigin(0.5).setDepth(DEPTH.OVERLAY).setShadow(0, 6, 'rgba(0,0,0,0.5)', 14);
    this.titleLogo._base = 58; this._fitText(this.titleLogo, W - 40);
    this.titleTag = this.add.text(W / 2, 312, t('tagline'), { fontFamily: FONT, fontSize: '20px', color: css(PAL.textDim), align: 'center', wordWrap: { width: W - 80 } }).setOrigin(0.5).setDepth(DEPTH.OVERLAY);
    // 타이틀 장식: 등불 하나 + 나방 한 마리가 맴돈다
    this.titleLamp = this._fitH(this.add.image(W / 2, 470, this._tex('lamp_on')), 'lamp_on').setDepth(DEPTH.OVERLAY); this.titleLamp.setScale(this.titleLamp._baseScale * 1.5);
    this.titleGlow = this.add.image(W / 2, 505, 'glow').setDisplaySize(420, 420).setTint(PAL.lampGlow).setAlpha(0.5).setBlendMode(ADD).setDepth(DEPTH.OVERLAY - 0.5);
    this.titleMoth = this._fitH(this.add.image(W / 2 + 70, 500, this._tex(this._mothKey())), 'moth').setDepth(DEPTH.OVERLAY + 1); this._titleMothScale = this.titleMoth._baseScale * 1.1;
    this.playBtn = this._button(W / 2, 640, 300, 92, t('play'), () => this._startFromTitle(), { tint: PAL.gold, group: 'title', fontSize: 34, depth: DEPTH.OVERLAY });
    this.nightsBtn = this._button(W / 2 - 115, 742, 210, 60, t('levels'), () => this._openNights(), { tint: 0x2a2f4d, color: css(PAL.text), group: 'title', fontSize: 22, depth: DEPTH.OVERLAY });
    this.mothsBtn = this._button(W / 2 + 115, 742, 210, 60, t('moths'), () => this._openMoths(), { tint: 0x2a2f4d, color: css(PAL.text), group: 'title', fontSize: 22, depth: DEPTH.OVERLAY });
    this.titleProgress = this.add.text(W / 2, 700, '', { fontFamily: FONT, fontSize: '18px', color: css(PAL.gold), fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH.OVERLAY);
    this.titleHow = this.add.text(W / 2, 840, t('howTo'), { fontFamily: FONT, fontSize: '17px', color: css(PAL.textDim), align: 'center', wordWrap: { width: W - 96 } }).setOrigin(0.5).setDepth(DEPTH.OVERLAY);
    this.tMusic = this._iconButton(W - 40, 48, this.save.musicMute ? 'musicOff' : 'music', () => this._toggleMusic(), 'title');
    this.tSound = this._iconButton(W - 100, 48, this.save.mute ? 'soundOff' : 'sound', () => this._toggleSound(), 'title');
    this.tLang = this._iconButton(40, 48, 'lang', () => this._cycleLang(), 'title');
    this.titleMusic = this.tMusic; this.titleMute = this.tSound; this.titleLang = this.tLang; // QA 하네스 공통 이름
    this.tLangTxt = this.add.text(76, 48, LANG_NAMES[currentLang], { fontFamily: FONT, fontSize: '15px', color: css(PAL.textDim) }).setOrigin(0, 0.5).setDepth(DEPTH.OVERLAY);
    this.groups.title.push(dim, this.titleLogo, this.titleTag, this.titleLamp, this.titleGlow, this.titleMoth, this.titleProgress, this.titleHow, this.tLangTxt);
  }
  _cycleLang() {
    currentLang = LANGS[(LANGS.indexOf(currentLang) + 1) % LANGS.length];
    saveJSON(CONFIG.LANG_KEY, currentLang);
    this.titleLogo.setText(t('title')); this._fitText(this.titleLogo, W - 40); this.titleTag.setText(t('tagline')); this.titleHow.setText(t('howTo')); this.playBtn.txt.setText(t('play')); this._fitText(this.playBtn.txt, 280); this.nightsBtn.txt.setText(t('levels')); this._fitText(this.nightsBtn.txt, 190); this.mothsBtn.txt.setText(t('moths')); this._fitText(this.mothsBtn.txt, 190); this.tLangTxt.setText(LANG_NAMES[currentLang]);
    this._refreshTitleProgress();
    if (this.btnRewind) { this.btnRewind.txt.setText('↶ ' + t('rewind')); this._fitText(this.btnRewind.txt, 112); }
  }
  _refreshTitleProgress() {
    const cleared = this._cleared();
    const stars = LEVELS.reduce((a, l) => a + (this.save.stars[l.id] || 0), 0);
    this.titleProgress.setText(cleared ? `${t('levels')} ${cleared}/${LEVELS.length}   ★ ${stars}` : '');
  }
  _showTitle() {
    this.state = 'title';
    this._clearLevel();
    this._setChapterBg(chapterOf(Math.min(this.save.unlocked, LEVELS.length - 1)));
    this._setGroup('title', true); this._setGroup('hud', false); this._setGroup('win', false); this._setGroup('nights', false); this._setGroup('moths', false);
    this.titleMoth.setTexture(this._tex(this._mothKey()));
    this._refreshTitleProgress();
    this.tweens.killTweensOf(this.titleMoth);
    this.tweens.add({ targets: this.titleMoth, angle: 360, duration: 4000, repeat: -1 }); // 임시: 등불 주위 맴돌이는 update 에서
    this._titleT = 0;
  }
  async _startFromTitle() {
    if (this.state !== 'title') return;
    SFX.unlock(); MUSIC.start();
    this.state = 'loading';
    await GDFlow.playAd('interstitial'); // 프리롤(GD 필수) — 광고 없어도 반드시 시작
    this._setGroup('title', false); this._setGroup('hud', true);
    this.levelIdx = Math.min(this.save.unlocked, LEVELS.length - 1);
    this.attempt = 0;
    this._startLevel();
  }

  // ---------------------------------------------------------------------------
  // 클리어 패널
  // ---------------------------------------------------------------------------
  _buildWin() {
    const dim = this.add.rectangle(W / 2, H / 2, W * 4, H, 0x000000, 0.55).setDepth(DEPTH.MODAL - 1).setInteractive(); // 입력 차단
    // 1.1b: 불빛에 비친 한지 두루마리(나무 봉 + 한지 + 붉은 낙관) — 다른 게임과 다른 고유 패널. 버튼은 전부 패널 안
    const PX = W / 2 - 205, PY = 270, PW = 410, PH = 440;
    const panel = this.add.graphics().setDepth(DEPTH.MODAL);
    panel.fillStyle(0x000000, 0.4); panel.fillRoundedRect(PX + 5, PY + 12, PW, PH, 10);
    panel.fillGradientStyle(0xf6e8c8, 0xf6e8c8, 0xe6cf9f, 0xe6cf9f, 1); panel.fillRect(PX, PY, PW, PH);
    panel.fillStyle(0xffffff, 0.18); panel.fillRect(PX + 10, PY + 14, PW - 20, 60);
    panel.lineStyle(1, 0x9a7a4a, 0.5); panel.strokeRect(PX + 12, PY + 12, PW - 24, PH - 24);
    // 위·아래 나무 봉(족자)
    for (const yy of [PY - 10, PY + PH - 6]) { panel.fillStyle(0x3a2414, 1); panel.fillRoundedRect(PX - 16, yy, PW + 32, 16, 8); panel.fillStyle(0x6b4428, 1); panel.fillRoundedRect(PX - 16, yy + 2, PW + 32, 5, 3); panel.fillStyle(PAL.gold, 1); panel.fillCircle(PX - 16, yy + 8, 7); panel.fillCircle(PX + PW + 16, yy + 8, 7); }
    // 붉은 낙관(도장)
    panel.fillStyle(0xb5322a, 0.92); panel.fillRoundedRect(PX + PW - 64, PY + 26, 38, 38, 5); panel.lineStyle(2, 0xf6e8c8, 0.8); panel.strokeRoundedRect(PX + PW - 59, PY + 31, 28, 28, 3);
    this.winTitle = this.add.text(W / 2, PY + 70, '', { fontFamily: FONT_D, fontSize: '34px', color: '#2a1d12', fontStyle: 'bold', align: 'center', wordWrap: { width: PW - 110 } }).setOrigin(0.5).setDepth(DEPTH.MODAL + 1);
    // 별 = 등불 셋(켜짐/꺼짐)
    this.winStars = [0, 1, 2].map((i) => { const im = this.add.image(W / 2 - 80 + i * 80, PY + 160, this._tex('lamp_on')).setDepth(DEPTH.MODAL + 1); const sc = 76 / im.height; im.setScale(sc); im._bs = sc; return im; });
    this.winTaps = this.add.text(W / 2, PY + 232, '', { fontFamily: FONT, fontSize: '18px', color: '#5a4630' }).setOrigin(0.5).setDepth(DEPTH.MODAL + 1);
    this.winNext = this._button(W / 2, PY + 300, 250, 66, t('next'), () => this._nextByButton(), { tint: PAL.gold, group: 'win', fontSize: 28, depth: DEPTH.MODAL + 1 });
    this.winHome = this._button(W / 2 - 92, PY + 376, 150, 48, t('home'), () => this._goHome(), { tint: 0x2a2f4d, color: css(PAL.text), group: 'win', fontSize: 18, depth: DEPTH.MODAL + 1 });
    this.winRetry = this._button(W / 2 + 92, PY + 376, 150, 48, t('retry'), () => this._retryByButton(), { tint: 0x2a2f4d, color: css(PAL.text), group: 'win', fontSize: 18, depth: DEPTH.MODAL + 1 });
    this.groups.win.push(dim, panel, this.winTitle, ...this.winStars, this.winTaps);
  }

  // ---------------------------------------------------------------------------
  // 밤 선택(레벨 선택) — 5열 격자, 페이지당 30. 잠긴 밤은 흐리게. 선택 → 프리롤과 동일 취급(타이틀에서 시작하는 세션) → 미드롤 아님, 첫 광고.
  // ---------------------------------------------------------------------------
  _buildNights() {
    const dim = this.add.rectangle(W / 2, H / 2, W * 4, H, 0x05070f, 0.99).setDepth(DEPTH.MODAL - 1).setInteractive();
    this.nightsTitle = this.add.text(W / 2, 70, '', { fontFamily: FONT_D, fontSize: '40px', color: css(PAL.text) }).setOrigin(0.5).setDepth(DEPTH.MODAL + 1);
    this.nightsBack = this._button(W / 2, H - 70, 200, 60, t('back'), () => this._closeNights(), { tint: 0x2a2f4d, color: css(PAL.text), group: 'nights', fontSize: 22, depth: DEPTH.MODAL + 1 });
    // 페이지(30밤 단위) 이동
    this.nightsPrev = this._button(70, H - 70, 70, 60, '‹', () => this._nightsPageMove(-1), { tint: 0x2a2f4d, color: css(PAL.text), group: 'nights', fontSize: 34, depth: DEPTH.MODAL + 1 });
    this.nightsNext = this._button(W - 70, H - 70, 70, 60, '›', () => this._nightsPageMove(1), { tint: 0x2a2f4d, color: css(PAL.text), group: 'nights', fontSize: 34, depth: DEPTH.MODAL + 1 });
    this.nightsPageTxt = this.add.text(W / 2, H - 118, '', { fontFamily: FONT, fontSize: '15px', color: css(PAL.textDim) }).setOrigin(0.5).setDepth(DEPTH.MODAL + 1);
    this.nightsCells = this.add.container(0, 0).setDepth(DEPTH.MODAL + 1);
    this.nightsZone = this.add.zone(W / 2, 480, W, 660).setOrigin(0.5).setDepth(DEPTH.MODAL + 2).setInteractive();
    this.nightsZone.on('pointerup', (p) => this._onNightsTap(p.worldX, p.worldY)); // 1.2e: 가로 배치(카메라 스크롤)에서도 맞게 world 좌표
    this.groups.nights.push(dim, this.nightsTitle, this.nightsCells, this.nightsZone, this.nightsPageTxt);
    this.nightsPage = 0;
  }
  _nightsPageMove(d) { const pages = Math.ceil(LEVELS.length / 30); this.nightsPage = clamp(this.nightsPage + d, 0, pages - 1); this._refreshNights(); }
  // 나방 도감 — 2열 카드. 잠긴 종은 실루엣 + 해금 조건. 탭하면 선택.
  _buildMoths() {
    const dim = this.add.rectangle(W / 2, H / 2, W * 4, H, 0x05070f, 0.99).setDepth(DEPTH.MODAL - 1).setInteractive();
    this.mothsTitle = this.add.text(W / 2, 70, '', { fontFamily: FONT_D, fontSize: '40px', color: css(PAL.text) }).setOrigin(0.5).setDepth(DEPTH.MODAL + 1);
    this.mothsBack = this._button(W / 2, H - 70, 200, 60, t('back'), () => this._closeMoths(), { tint: 0x2a2f4d, color: css(PAL.text), group: 'moths', fontSize: 22, depth: DEPTH.MODAL + 1 });
    this.mothsCells = this.add.container(0, 0).setDepth(DEPTH.MODAL + 1);
    this.mothsZone = this.add.zone(W / 2, 470, W, 640).setOrigin(0.5).setDepth(DEPTH.MODAL + 2).setInteractive();
    this.mothsZone.on('pointerup', (p) => this._onMothsTap(p.worldX, p.worldY));
    this.groups.moths.push(dim, this.mothsTitle, this.mothsCells, this.mothsZone);
  }
  _mothCellPos(i) { return { x: 150 + (i % 2) * 240, y: 230 + Math.floor(i / 2) * 200 }; }
  _refreshMoths() {
    this.mothsTitle.setText(t('moths')); this.mothsBack.txt.setText(t('back'));
    this.mothsCells.removeAll(true);
    MOTHS.forEach((m, i) => {
      const p = this._mothCellPos(i); const un = this._mothUnlocked(m); const sel = this._mothKey() === m.key;
      const g = this.add.graphics();
      g.fillStyle(un ? 0x1c2038 : 0x11131f, 1); g.fillRoundedRect(p.x - 105, p.y - 85, 210, 170, 18);
      g.lineStyle(sel ? 3 : 2, sel ? PAL.gold : un ? PAL.teal : 0x2a2f4d, un ? 0.95 : 0.5); g.strokeRoundedRect(p.x - 105, p.y - 85, 210, 170, 18);
      const img = this._fitH(this.add.image(p.x, p.y - 18, this._tex(m.key)), 'moth');
      img.setScale(img._baseScale * 1.3);
      if (!un) img.setTint(0x1a1d30).setAlpha(0.9);
      const nm = this.add.text(p.x, p.y + 52, un ? (m.name[currentLang] || m.name.en) : t('unlockAt', { n: m.need }), { fontFamily: FONT, fontSize: '15px', color: un ? css(PAL.text) : '#5a5f7a', align: 'center', wordWrap: { width: 190 } }).setOrigin(0.5);
      this.mothsCells.add([g, img, nm]);
      if (sel) { const chk = this.add.text(p.x + 86, p.y - 68, '✓', { fontFamily: FONT, fontSize: '20px', color: css(PAL.gold), fontStyle: 'bold' }).setOrigin(0.5); this.mothsCells.add(chk); }
    });
  }
  _openMoths() { if (this.state !== 'title') return; this.state = 'moths'; this._setGroup('title', false); this._setGroup('moths', true); this._refreshMoths(); }
  _closeMoths() { if (this.state !== 'moths') return; this.state = 'title'; this._setGroup('moths', false); this._setGroup('title', true); this.titleMoth.setTexture(this._tex(this._mothKey())); }
  _onMothsTap(x, y) {
    if (this.state !== 'moths') return;
    MOTHS.forEach((m, i) => { const p = this._mothCellPos(i); if (Math.abs(x - p.x) <= 105 && Math.abs(y - p.y) <= 85) { SFX.button(); if (this._mothUnlocked(m)) { this.save.moth = m.key; this._save(); SFX.arrive(); } this._refreshMoths(); } });
  }
  _nightCellPos(i) { const col = i % 5, row = Math.floor(i / 5) % 6; return { x: 70 + col * 100, y: 166 + row * 100 + Math.floor(row / 2) * 20 }; } // 1.2g: 장(2줄)마다 20px 여백 — 장 라벨이 등불 술과 겹치지 않게
  _refreshNights() {
    this.nightsTitle.setText(t('levels'));
    this.nightsBack.txt.setText(t('back'));
    const pages = Math.ceil(LEVELS.length / 30);
    this.nightsPrev.setVis(pages > 1 && this.nightsPage > 0); this.nightsNext.setVis(pages > 1 && this.nightsPage < pages - 1);
    this.nightsPageTxt.setText(pages > 1 ? `${this.nightsPage * 30 + 1}–${Math.min(LEVELS.length, this.nightsPage * 30 + 30)} / ${LEVELS.length}` : '');
    this.nightsCells.removeAll(true);
    const first = this.nightsPage * 30;
    // 1.2e: 장 구분 — 10밤마다 금색 선 + 장 이름(어둡고 밋밋하던 격자에 구조를)
    for (let i = first; i < Math.min(LEVELS.length, first + 30); i += 10) {
      const ch = chapterOf(i); const p = this._nightCellPos(i - first); const y = p.y - 70;
      const line = this.add.graphics(); line.lineStyle(1, PAL.gold, 0.45); line.lineBetween(40, y, W - 40, y);
      const lab = this.add.text(W / 2, y, `${t('chapter', { n: ch + 1 })} · ${CHAPTERS[ch].name[currentLang] || CHAPTERS[ch].name.en}`.toUpperCase(), { fontFamily: FONT, fontSize: '13px', color: css(PAL.gold), fontStyle: 'bold', letterSpacing: 2, backgroundColor: '#05070f', padding: { x: 10, y: 2 } }).setOrigin(0.5);
      this.nightsCells.add([line, lab]);
    }
    for (let i = first; i < Math.min(LEVELS.length, first + 30); i++) {
      const lv = LEVELS[i]; const p = this._nightCellPos(i - first);
      const unlocked = i <= this.save.unlocked; const st = this.save.stars[lv.id] || 0;
      // 1.1b: 숫자 칸 대신 등불 — 깬 밤은 불 켜진 초롱, 아직이면 꺼진 초롱, 잠긴 밤은 흐린 실루엣. 별 = 작은 불씨 초롱
      const lamp = this.add.image(p.x, p.y - 6, this._tex(st ? 'lamp_on' : 'lamp_off')); const lsc = 62 / lamp.height; lamp.setScale(lsc).setAlpha(unlocked ? 1 : 0.4);
      if (!unlocked) lamp.setTint(0x6a7090); else if (!st) lamp.setTint(0xc9d2ff);
      const glow = this.add.image(p.x, p.y - 6, 'glow').setDisplaySize(96, 96).setTint(st ? PAL.homeCore : 0x8fa6e0).setBlendMode(ADD).setAlpha(st ? 0.4 : unlocked ? 0.14 : 0);
      const num = this.add.text(p.x, p.y - 4, String(i + 1), { fontFamily: FONT_D, fontSize: '22px', color: unlocked ? '#fff6e0' : '#4a4f6a', fontStyle: 'bold' }).setOrigin(0.5).setStroke('#140c06', 5);
      const dots = [];
      if (unlocked) for (let k = 0; k < 3; k++) { const d = this.add.image(p.x - 16 + k * 16, p.y + 34, this._tex(k < st ? 'lamp_on' : 'lamp_off')); d.setScale(14 / d.height).setAlpha(k < st ? 1 : 0.35); dots.push(d); }
      const g = glow, stars = this.add.container(0, 0, dots);
      this.nightsCells.add([glow, lamp]);
      this.nightsCells.add([num, stars]);
    }
  }
  _openNights() { if (this.state !== 'title') return; this.state = 'nights'; this.nightsPage = Math.floor(Math.min(this.save.unlocked, LEVELS.length - 1) / 30); this._setGroup('title', false); this._setGroup('nights', true); this._refreshNights(); }
  _closeNights() { if (this.state !== 'nights') return; this.state = 'title'; this._setGroup('nights', false); this._setGroup('title', true); }
  async _onNightsTap(x, y) {
    if (this.state !== 'nights' || GDFlow.isBlocking()) return;
    const first = this.nightsPage * 30;
    for (let i = first; i < Math.min(LEVELS.length, first + 30); i++) {
      const p = this._nightCellPos(i - first);
      if (Math.abs(x - p.x) <= 42 && Math.abs(y - p.y) <= 42) {
        if (i > this.save.unlocked) { SFX.button(); return; }
        SFX.button(); SFX.unlock(); MUSIC.start();
        this.state = 'loading';
        await GDFlow.playAd('interstitial'); // 밤 선택 후 시작 = 세션 시작 광고(프리롤과 동일 규격)
        this._setGroup('nights', false); this._setGroup('hud', true);
        this.levelIdx = i; this.attempt = 0; this._startLevel();
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 레벨 생성/정리
  // ---------------------------------------------------------------------------
  // 레벨에 묶인 연출(지연 호출·떠다니는 이미지·카드 텍스트)을 등록해 두고 레벨을 떠날 때 한 번에 정리
  _fxTimer(ms, fn) { const tm = this.time.delayedCall(ms, () => { this._fxTimers = (this._fxTimers || []).filter((x) => x !== tm); fn(); }); (this._fxTimers = this._fxTimers || []).push(tm); return tm; }
  _fxObj(o) { (this._fxObjs = this._fxObjs || []).push(o); return o; }
  _clearFx() {
    for (const tm of this._fxTimers || []) tm.remove(false); this._fxTimers = [];
    for (const o of this._fxObjs || []) { if (o.active) { this.tweens.killTweensOf(o); o.destroy(); } } this._fxObjs = [];
    this._hold = false;
    this.world.setScale(1).setPosition(0, 0);
  }
  _clearLevel() {
    // 레벨을 떠날 때: 승리 패널 지연 호출·안내 문구·힌트 표식·연출 정리(홈/재시작 직후 패널이 뜨거나 표식이 타이틀에 남던 문제)
    if (this._winTimer) { this._winTimer.remove(false); this._winTimer = null; }
    this._clearFx();
    this._hideHint(); if (this.hintMarks) { for (const m of this.hintMarks) m.destroy(); this.hintMarks = null; }
    this._press = null; this._clearPreview();
    this.world.removeAll(true);
    this.lineGfx.clear(); this.ringGfx.clear();
    if (this.trail) { this.trail.destroy(); this.trail = null; }
    if (this.mothSpr) { this.mothSpr.destroy(); this.mothSpr = null; }
    this.lampViews = []; this.windViews = [];
    this.sim = null;
    if (this._failTimer) { this._failTimer.remove(false); this._failTimer = null; }
  }
  _startLevel() {
    const keepHint = this.hintActive && this.hintLevel === this.levelIdx; // 산 힌트는 같은 레벨을 다시 시작해도 유지
    this._clearLevel();
    const lv = LEVELS[this.levelIdx];
    this.attempt++;
    // 1.1: 시드 고정(흔들림은 시각 전용이라 물리는 결정적) + 체크포인트(시작·안전한 등불 착지) 스택
    this.sim = createSim(lv, { seed: 1 });
    this._evIdx = 0;
    this.checkpoints = [this._snap()];
    this.previewsLeft = Infinity; this._refreshPreviewBtn(); // 1.2f: 미리보기 무제한(예산은 두 평가에서 모두 '유료 벽' — 끌림 선으로 규칙을 보이고 난이도는 바람·기름등·거미줄로)
    this.state = 'playing';
    this.hintShown = false;
    // 바람
    for (const w of lv.winds || []) {
      const rect = this.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 0x9fb0ff, 0.05).setDepth(DEPTH.WIND);
      const ts = this.add.tileSprite(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 'streak').setAlpha(0.35).setDepth(DEPTH.WIND).setBlendMode(ADD);
      ts.setTileScale(1.6, 1.2);
      this.world.add([rect, ts]); this.windViews.push({ ts, w });
    }
    // 거미줄
    for (const wb of lv.webs || []) {
      const hh = ((wb.x * 73856093) ^ (wb.y * 19349663)) >>> 0; // 1.2b: 같은 도장 반복 느낌 제거 — 위치 해시로 고정된 회전·반전·크기
      const img = this.add.image(wb.x, wb.y, this._tex('web')).setDisplaySize(wb.r * 2.2 * (0.9 + (hh % 5) * 0.06), wb.r * 2.2 * (0.9 + ((hh >> 3) % 5) * 0.06)).setAngle((hh >> 6) % 360).setFlipX(!!(hh & 1)).setAlpha(this.textures.exists('img_web') ? 0.72 + (hh >> 9) % 3 * 0.06 : 0.55).setDepth(DEPTH.WEB);
      this.world.add(img);
    }
    // 등불
    this._drawStrings();
    for (const l of this.sim.lamps) this.lampViews.push(this._makeLampView(l));
    // 나방 + 먼지 자취
    this.mothGlow = this.add.image(lv.start.x, lv.start.y, 'glow').setDisplaySize(150, 150).setTint(PAL.dust).setAlpha(0.32).setBlendMode(ADD).setDepth(DEPTH.MOTH - 1);
    this.world.add(this.mothGlow);
    this.mothSpr = this._fitH(this.add.image(lv.start.x, lv.start.y, this._tex(this._mothKey())), 'moth').setDepth(DEPTH.MOTH); this._mothScale = this.mothSpr._baseScale; this.world.add(this.mothSpr);
    this.trail = this.add.particles(0, 0, 'dot', { lifespan: 700, speed: { min: 4, max: 18 }, scale: { start: 0.45, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: PAL.dust, blendMode: 'ADD', frequency: CONFIG.TRAIL_EVERY_MS, emitting: false }).setDepth(DEPTH.TRAIL);
    this.world.add(this.trail); this.world.bringToTop(this.mothSpr); // 자취는 나방 아래, 둘 다 world(확대 연출) 안에
    this.trail.startFollow(this.mothSpr);
    this.trail.emitting = true;
    // 등장: 어둠에서 밝아짐 + 밤 이름 인트로(크게 떴다가 HUD 로 사라짐)
    this.vignette.setTint(0x000000).setAlpha(0.9); this.tweens.add({ targets: this.vignette, alpha: 0, duration: 600 });
    this.mothSpr.setAlpha(0).setScale(this._mothScale * 0.7); this.tweens.add({ targets: this.mothSpr, alpha: 1, duration: 400 });
    this._mothAwake = false; this._heartT = 0;
    const ch = chapterOf(this.levelIdx); this._setChapterBg(ch);
    this._hold = false;
    if (this.attempt === 1) { if (CHAPTERS[ch].from === this.levelIdx && this.levelIdx > 0) { this._chapterCard(ch); this._hold = true; this._fxTimer(1900, () => { this._hold = false; if (this.sim && this.state === 'playing' && LEVELS[this.levelIdx] === lv) this._nightIntro(lv); }); } else this._nightIntro(lv); }
    this._clearHintMarkers(); if (keepHint) this._showHintMarkers(true); this._refreshHintBtn();
    if (this.attempt > CONFIG.HINT_AFTER_FAILS && this.hintBtn.visible) this.tweens.add({ targets: this.hintBtn, scaleX: 1.08, scaleY: 1.08, duration: 300, yoyo: true, repeat: 2 });
    this._refreshHud(); this._refreshRewind();
    if (!this.save.seenHow && this.levelIdx < 2 && this.sim.lamps.some((l) => isPlayerLamp(l.kind))) this._showHint('hintLight'); // 1.2g: 튜토리얼 안내는 초반 밤에서만(늦은 밤까지 남는 '새 세이브' 인상)
    else if (!this.save.seenHold && this.levelIdx >= 1 && this.levelIdx <= 3 && this.attempt === 1) this._showHint('hintHold');
    // 1.2e: 숨은 규칙 두 가지를 때맞춰 한 번씩 — 밝기(첫 기름등 밤), 미리보기 예산(15밤)
    else if (!this.save.seenLumen && this.attempt === 1 && lv.lamps.some((l) => l.kind === 'oil')) { this.save.seenLumen = true; this._save(); this._fxTimer(900, () => { if (this.state === 'playing') this._toast(t('tipLumen'), css(PAL.text), H * 0.8, true); }); }
    this._syncLampViews(true);
    this._applyLayout();
  }
  _snap() { const s = this.sim; return { ...s, moth: { ...s.moth }, lamps: s.lamps.map((l) => ({ ...l })), events: [] }; }
  _refreshRewind() { if (this.btnRewind) this.btnRewind.setAlpha(this.state === 'playing' && this.checkpoints && (this.checkpoints.length > 1 || (this.sim && this.sim.taps > this.checkpoints[0].taps)) ? 1 : 0.35); }
  // 되감기: 마지막 체크포인트로. 이미 그 지점에서 아무것도 안 했으면 하나 더 앞으로. auto = 실패 후 자동
  _rewind(auto) {
    if (!this.checkpoints || !this.sim) return;
    if (!auto && (this.state !== 'playing' || GDFlow.isBlocking())) return;
    let cp = this.checkpoints[this.checkpoints.length - 1];
    if (!auto && this.checkpoints.length > 1 && this.sim.taps === cp.taps && this.sim.moth.state === 'orbit') { this.checkpoints.pop(); cp = this.checkpoints[this.checkpoints.length - 1]; }
    // 실패했는데 그 체크포인트 이후 탭이 하나도 없었다 = 그 지점은 이미 실패가 정해진 곳(예: 다 타 가는 기름등) → 한 단계 더 앞으로(무한 반복 방지)
    if (auto && this.checkpoints.length > 1 && this.sim.taps === cp.taps) { this.checkpoints.pop(); cp = this.checkpoints[this.checkpoints.length - 1]; }
    if (!auto && this.checkpoints.length === 1 && this.sim.taps === cp.taps && this.sim.t - cp.t < 0.5) return; // 시작 지점 그대로
    this.sim = { ...cp, moth: { ...cp.moth }, lamps: cp.lamps.map((l) => ({ ...l })), events: [] }; this._evIdx = 0;
    this.state = 'playing';
    if (this._failTimer) { this._failTimer.remove(false); this._failTimer = null; }
    this.tweens.killTweensOf(this.mothSpr);
    this.mothSpr.setAlpha(1).setAngle(0).setScale(this._mothScale); this.trail.emitting = true;
    if (this.mothGlow) this.mothGlow.setAlpha(0.32);
    this.vignette.setTint(0x2a2238).setAlpha(0.35); this.tweens.add({ targets: this.vignette, alpha: 0, duration: 360, onComplete: () => this.vignette.setTint(0x000000) });
    this.lampViews.forEach((v, i) => { v.l = this.sim.lamps[i]; }); // 그림이 복원된 sim 의 등불을 보게(안 하면 되감기 후 등불 그림이 멈춤)
    SFX.retarget(); this._syncLampViews(true); this._refreshHud(); this._refreshHintBtn(); this._refreshRewind();
  }
  _nightIntro(lv) {
    const a = this.add.text(W / 2, H * 0.42, t('night', { n: this.levelIdx + 1 }).toUpperCase(), { fontFamily: FONT, fontSize: '20px', color: css(PAL.gold), fontStyle: 'bold', letterSpacing: 6 }).setOrigin(0.5).setDepth(DEPTH.TOAST).setAlpha(0);
    const b = this.add.text(W / 2, H * 0.42 + 40, levelName(lv), { fontFamily: FONT_D, fontSize: '48px', color: css(PAL.text), fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH.TOAST).setAlpha(0).setShadow(0, 4, 'rgba(0,0,0,0.6)', 10);
    this.tweens.add({ targets: [a, b], alpha: 1, duration: 260, ease: 'Quad.Out' });
    this.tweens.add({ targets: [a, b], alpha: 0, y: '-=30', delay: 900, duration: 380, ease: 'Quad.In', onComplete: () => { a.destroy(); b.destroy(); } });
  }
  // 1.2f: 등불 줄 — 비슷한 높이의 플레이어 등불을 늘어진 끈으로 잇고(장대 사이에 걸린 등불), 외톨이 등불은 처마에서 내려온 끈에. 시뮬 무관('공중에 뜬 격자' 지적)
  _drawStrings() {
    const g = this.add.graphics().setDepth(DEPTH.LAMP - 1); this.world.add(g); this.world.sendToBack(g);
    const pts = this.sim.lamps.filter((l) => isPlayerLamp(l.kind)).map((l) => ({ x: l.x, y: l.y - (l.kind === 'oil' ? 30 : 42) })).sort((a, b) => a.y - b.y);
    const rows = [];
    for (const p of pts) { const r = rows.find((rw) => Math.abs(rw.y - p.y) < 48); if (r) { r.pts.push(p); r.y = (r.y * (r.pts.length - 1) + p.y) / r.pts.length; } else rows.push({ y: p.y, pts: [p] }); }
    const strand = (path) => {
      for (const [col, w, a] of [[0x120c08, 3, 0.85], [0x9a7a48, 1, 0.5]]) {
        g.lineStyle(w, col, a); g.beginPath(); g.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) { const p0 = path[i - 1], p1 = path[i]; const sag = Math.min(22, Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.09); for (let k = 1; k <= 8; k++) { const t = k / 8; g.lineTo(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t + sag * 4 * t * (1 - t)); } }
        g.strokePath();
      }
    };
    for (const r of rows) {
      r.pts.sort((a, b) => a.x - b.x);
      if (r.pts.length >= 2) strand([{ x: -60, y: r.pts[0].y - 26 }, ...r.pts, { x: W + 60, y: r.pts[r.pts.length - 1].y - 26 }]);
      else { const p = r.pts[0]; g.lineStyle(2, 0x120c08, 0.8); g.lineBetween(p.x, 126, p.x, p.y); g.lineStyle(1, 0x9a7a48, 0.35); g.lineBetween(p.x + 1, 126, p.x + 1, p.y); }
      for (const p of r.pts) { g.fillStyle(0x120c08, 0.95); g.fillCircle(p.x, p.y, 2.6); }
    }
  }
  _makeLampView(l) {
    const v = { l };
    const kind = l.kind;
    const glowTint = kind === 'candle' ? PAL.candleGlow : kind === 'home' ? PAL.homeGlow : PAL.lampGlow;
    v.reach = this.add.image(l.x, l.y, 'reach').setDisplaySize(l.reach * 2, l.reach * 2).setTint(glowTint).setAlpha(0).setBlendMode(ADD).setDepth(DEPTH.REACH);
    v.glow = this.add.image(l.x, l.y, 'glow').setDisplaySize(260, 260).setTint(glowTint).setAlpha(0).setBlendMode(ADD).setDepth(DEPTH.GLOW);
    v.core = this.add.image(l.x, l.y, 'glow').setDisplaySize(70, 70).setTint(kind === 'candle' ? PAL.candleCore : PAL.lampCore).setAlpha(0).setBlendMode(ADD).setDepth(DEPTH.GLOW + 1);
    // 1.2d: 바닥 빛 — 켜진 등불 아래 마루에 납작한 빛 웅덩이(가까울수록 밝고 넓게). 시뮬 무관, 장식
    v.poolK = Math.max(0, Math.min(1, 1 - (FLOOR_Y - l.y - 90) / 560));
    v.pool = this.add.image(l.x, FLOOR_Y + 14, 'glow').setDisplaySize(1, 1).setTint(glowTint).setAlpha(0).setBlendMode(ADD).setDepth(DEPTH.POOL);
    const key = kind === 'lamp' ? this._lampKey(false) : kind === 'oil' ? 'oil_off' : kind === 'fixed' ? 'fixed' : kind === 'candle' ? 'candle' : 'home';
    v.body = this._fitH(this.add.image(l.x, l.y, this._tex(key)), key).setDepth(DEPTH.LAMP);
    if (isPlayerLamp(kind)) { const vs = 0.92 + (((l.x * 31 + l.y * 17) % 9) / 8) * 0.16; v.vs = vs; v.body._baseScale *= vs; v.body.setScale(v.body._baseScale); } // 크기 변주(탭 반경·물리 무관)
    const isImg = v.body.texture.key.startsWith('img_');
    if (kind === 'lamp') v.body.setOrigin(0.5, isImg ? 0.42 : 0.45);
    if (kind === 'candle') v.body.setOrigin(0.5, isImg ? 0.22 : 0.3);
    if (kind === 'oil') v.body.setOrigin(0.5, isImg ? 0.42 : 0.5);
    if (kind === 'fixed') v.body.setOrigin(0.5, 0.5);
    v.glowBase = kind === 'home' ? 0.75 : kind === 'candle' ? 0.5 : kind === 'fixed' ? 0.7 : 0.6;
    // 1.2: 글로우 지름 = 나방이 느끼는 밝기(lumen) 순 — 기름등 1.3 > 등불·집 1.0 > 처마등 0.7 > 촛불 0.6 (숨은 규칙을 눈에 보이게)
    v.glowSize = kind === 'home' ? 420 : kind === 'candle' ? 150 : kind === 'fixed' ? 190 : kind === 'oil' ? 330 : 260;
    v.glow.setDisplaySize(v.glowSize, v.glowSize);
    v.phase = Math.random() * 10;
    this.world.add([v.pool, v.reach, v.glow, v.core, v.body]);
    return v;
  }
  _syncLampViews(instant) {
    for (const v of this.lampViews) {
      const l = v.l; const on = l.on && !l.spent;
      if (l.kind === 'lamp') { const k = this._lampKey(on); v.body.setTexture(this._tex(k)); this._fitH(v.body, k); if (v.vs) { v.body._baseScale *= v.vs; v.body.setScale(v.body._baseScale); } }
      if (l.kind === 'oil') { const k = l.spent ? 'oil_spent' : on ? 'oil_on' : 'oil_off'; v.body.setTexture(this._tex(k)); this._fitH(v.body, k); }
      const target = on ? v.glowBase : 0;
      const reachA = l.kind === 'home' ? 0 : 0.1;
      const poolA = on ? v.glowBase * 0.55 * (0.25 + 0.75 * v.poolK) : 0;
      if (instant) { v.glow.setAlpha(target); v.core.setAlpha(on ? 0.9 : 0); v.reach.setAlpha(on ? reachA : 0); v.pool.setAlpha(poolA); }
      else {
        this.tweens.add({ targets: v.glow, alpha: target, duration: on ? 220 : 160 }); this.tweens.add({ targets: v.core, alpha: on ? 0.9 : 0, duration: 160 }); this.tweens.add({ targets: v.pool, alpha: poolA, duration: on ? 320 : 200 });
        if (on && !v.on && l.kind !== 'home') { v.reach.setAlpha(0.45); this.tweens.add({ targets: v.reach, alpha: reachA, duration: 900, ease: 'Quad.Out' }); }
        else if (!on) this.tweens.add({ targets: v.reach, alpha: 0, duration: 200 });
      }
      v.on = on;
    }
  }

  // ---------------------------------------------------------------------------
  // 입력 — 플레이 영역 탭 → 가장 가까운 플레이어 등불 토글 / 키보드 1~9
  // ---------------------------------------------------------------------------
  _buildInput() {
    this.tapZone = this.add.zone(W / 2, (CONFIG.HUD_H + H) / 2 + 10, W, H - CONFIG.HUD_H - 20).setOrigin(0.5).setDepth(DEPTH.MOTH + 1).setInteractive();
    // 1.2: 누르고 있으면 그 등불을 탭했을 때의 비행 경로를 미리 보여주고(결정적 물리라 정확함), 떼는 순간 실제로 탭한다
    this.tapZone.on('pointerdown', (p) => this._pressStart(p.worldX, p.worldY));
    this.input.on('pointerup', () => this._pressEnd());
    this.input.on('pointerupoutside', () => this._pressEnd());
    this.previewGfx = this.add.graphics().setDepth(DEPTH.LINE + 1);
    this.input.keyboard.on('keydown', (e) => {
      if (this.state !== 'playing' || GDFlow.isBlocking() || e.repeat) return;
      const KEYMAP = '1234567890-='; const n = KEYMAP.indexOf(e.key) + 1; // 등불이 10개 넘는 밤도 키보드로 끝까지
      if (n >= 1) { const pl = this.sim.lamps.filter((l) => isPlayerLamp(l.kind)); if (pl[n - 1]) this._tap(pl[n - 1].i, pl[n - 1].x, pl[n - 1].y); }
      if (e.key === 'r' || e.key === 'R') this._restartLevel();
      if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') this._rewind(false);
    });
  }
  _onTap(x, y) {
    if (this.state !== 'playing' || !this.sim || GDFlow.isBlocking()) return;
    const i = lampAt(this.sim, x, y);
    if (i < 0) { this._tapRipple(x, y, false); return; }
    this._tap(i, this.sim.lamps[i].x, this.sim.lamps[i].y);
  }
  _pressStart(x, y) {
    if (this.state !== 'playing' || !this.sim || GDFlow.isBlocking()) return;
    const i = lampAt(this.sim, x, y);
    if (i < 0) { this._tapRipple(x, y, false); return; }
    this._press = { i, x, y, t: this.time.now, shown: false, lastCalc: 0 };
  }
  _pressEnd() {
    const pr = this._press; if (!pr) return;
    this._press = null; this._clearPreview();
    if (this.state !== 'playing' || !this.sim || GDFlow.isBlocking()) return;
    const l = this.sim.lamps[pr.i];
    this._tap(pr.i, l.x, l.y);
  }
  _clearPreview() { if (this.previewGfx) this.previewGfx.clear(); }
  // 미리보기: 지금 등불 i 를 탭하면 다음 결정 지점(착지·기름 소진·실패·집)까지 나방이 어디로 가는지
  _computePreview(i) {
    const s0 = this.sim; const c = { ...s0, moth: { ...s0.moth }, lamps: s0.lamps.map((l) => ({ ...l })), events: [] };
    if (!tapLamp(c, i)) { this._clearPreview(); return; }
    const pts = [[c.moth.x, c.moth.y]]; let end = null, n = 0;
    const cap = this.levelIdx >= 20 ? 180 : 480; // 1.2i: 3장부터는 1.5s 까지만(방향은 보이고 결과는 추론) — 두 평가 모두 '정확한 미리보기 = 열거'
    while (c.status === 'playing' && n < cap) {
      const n0 = c.events.length; step(c, SIM.DT); n++;
      if (n % 4 === 0) pts.push([c.moth.x, c.moth.y]);
      for (let k = n0; k < c.events.length; k++) { const e = c.events[k]; if (e.type === 'arrive') { end = { kind: 'arrive', lamp: e.lamp }; break; } if (e.type === 'oilOut' || e.type === 'lost') { end = { kind: e.type }; break; } }
      if (end) break;
    }
    if (!end) end = c.status === 'won' ? { kind: 'won' } : c.status === 'lost' ? { kind: 'fail', reason: c.reason } : { kind: 'more' };
    pts.push([c.moth.x, c.moth.y]);
    const g = this.previewGfx; g.clear();
    const bad = end.kind === 'fail' || (end.kind === 'arrive' && SIM.PULL[c.lamps[end.lamp].kind]);
    const col = bad ? PAL.danger : end.kind === 'won' ? PAL.gold : PAL.teal;
    g.lineStyle(3, col, 0.8);
    for (let k = 1; k < pts.length; k++) if (k % 2) g.lineBetween(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
    const [ex, ey] = pts[pts.length - 1];
    if (end.kind === 'fail') { g.lineStyle(4, PAL.danger, 1); g.lineBetween(ex - 12, ey - 12, ex + 12, ey + 12); g.lineBetween(ex - 12, ey + 12, ex + 12, ey - 12); }
    else if (end.kind === 'arrive') { const l = c.lamps[end.lamp]; g.lineStyle(3, col, 0.9); g.strokeCircle(l.x, l.y, 46); }
    else if (end.kind === 'won') { const h = c.lamps.find((l) => l.kind === 'home'); g.lineStyle(3, PAL.gold, 1); g.strokeCircle(h.x, h.y, 60); }
    else { g.fillStyle(col, 0.9); g.fillCircle(ex, ey, 5); }
  }
  _tap(i, x, y) {
    const l = this.sim.lamps[i];
    const wasOn = l.on;
    const ok = tapLamp(this.sim, i);
    this._tapRipple(x, y, ok);
    if (!ok) return;
    const view = this.lampViews[i];
    const bs = view.body._baseScale || 1;
    if (!wasOn) { SFX.light(); this._lightBurst(x, y, l.kind === 'oil' ? 1.3 : 1); this.tweens.add({ targets: view.body, scaleX: bs * 1.16, scaleY: bs * 1.16, duration: 110, yoyo: true, ease: 'Quad.Out' }); if (!this.save.seenHow) this._showHint('hintSnuff'); }
    else { SFX.snuff(); this._smokePuff(x, y); this.tweens.add({ targets: view.body, scaleX: bs * 0.9, scaleY: bs * 0.9, duration: 90, yoyo: true }); this.save.seenHow = true; this._save(); this._hideHint(); }
    this._syncLampViews(false);
    this._refreshHud(); this._refreshRewind();
  }
  _singe(x, y) {
    const pt = this.add.particles(x, y, 'dot', { lifespan: 300, speed: { min: 20, max: 70 }, gravityY: -80, scale: { start: 0.35, end: 0 }, tint: [0xff8a2a, 0xffd27a], blendMode: ADD, quantity: 2, emitting: false }).setDepth(DEPTH.FX); pt.explode(2); this.time.delayedCall(350, () => pt.destroy());
  }
  _tapRipple(x, y, strong) {
    const g = this.add.graphics().setDepth(DEPTH.FX);
    g.lineStyle(2, strong ? PAL.lampCore : PAL.textDim, 0.8); g.strokeCircle(0, 0, 12); g.setPosition(x, y);
    this.tweens.add({ targets: g, scaleX: strong ? 4 : 2.2, scaleY: strong ? 4 : 2.2, alpha: 0, duration: strong ? 420 : 260, ease: 'Quad.Out', onComplete: () => g.destroy() });
  }
  _lightBurst(x, y, k) {
    const img = this.add.image(x, y, 'glow').setDisplaySize(80, 80).setTint(PAL.lampCore).setBlendMode(ADD).setDepth(DEPTH.FX);
    this.tweens.add({ targets: img, displayWidth: 520 * k, displayHeight: 520 * k, alpha: 0, duration: 520, ease: 'Cubic.Out', onComplete: () => img.destroy() });
    const p = this.add.particles(x, y, 'dot', { lifespan: 600, speed: { min: 40, max: 160 }, scale: { start: 0.6, end: 0 }, tint: PAL.lampCore, blendMode: 'ADD', quantity: 14, emitting: false }).setDepth(DEPTH.FX);
    p.explode(14); this.time.delayedCall(700, () => p.destroy());
  }
  _smokePuff(x, y) {
    const p = this.add.particles(x, y - 20, 'dot', { lifespan: 900, speedY: { min: -50, max: -20 }, speedX: { min: -10, max: 10 }, scale: { start: 0.5, end: 1.4 }, alpha: { start: 0.35, end: 0 }, tint: 0x9da7c7, quantity: 6, emitting: false }).setDepth(DEPTH.FX);
    p.explode(6); this.time.delayedCall(1000, () => p.destroy());
  }
  _showHint(key) {
    this._hideHint();
    const target = key === 'hintLight' ? this.sim.lamps.find((l) => isPlayerLamp(l.kind) && !l.on) : this.sim.lamps.find((l) => isPlayerLamp(l.kind) && l.on);
    if (target) {
      const ar = this.add.text(target.x, target.y - 78, '▼', { fontFamily: FONT, fontSize: '30px', color: css(PAL.gold) }).setOrigin(0.5).setDepth(DEPTH.TOAST);
      this.tweens.add({ targets: ar, y: target.y - 62, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.hintArrow = ar;
    }
    this.hint = this.add.text(W / 2, H - 182, t(key), { fontFamily: FONT, fontSize: '18px', color: css(PAL.text), backgroundColor: 'rgba(6,10,26,0.7)', padding: { x: 14, y: 8 }, align: 'center', wordWrap: { width: W - 80 } }).setOrigin(0.5).setDepth(DEPTH.TOAST).setAlpha(0);
    this.tweens.add({ targets: this.hint, alpha: 1, duration: 300 });
  }
  _hideHint() {
    if (this.hintArrow) { this.hintArrow.destroy(); this.hintArrow = null; }
    if (this.hint) { const h = this.hint; this.hint = null; this.tweens.add({ targets: h, alpha: 0, duration: 200, onComplete: () => h.destroy() }); }
  }

  // ---------------------------------------------------------------------------
  // 매 프레임: 시뮬 전진 → 이벤트 연출 → 스프라이트 동기화
  // ---------------------------------------------------------------------------
  update(time, delta) {
    this._layoutTick(time);
    // 타이틀 장식 나방
    if (this.state === 'title') {
      this._titleT = (this._titleT || 0) + delta / 1000;
      const a = this._titleT * 1.6; const r = 72 + Math.sin(this._titleT * 3) * 6;
      this.titleMoth.setPosition(W / 2 + Math.cos(a) * r, 500 + Math.sin(a) * r * 0.55);
      this.titleMoth.setRotation(a + Math.PI); const ts = this._titleMothScale || 0.9; this.titleMoth.setScale(ts * (0.82 + Math.abs(Math.sin(this._titleT * 22)) * 0.18), ts);
      this.titleGlow.setAlpha(0.45 + Math.sin(this._titleT * 7) * 0.04);
      return;
    }
    if (!this.sim) return;
    if (this.state === 'playing') {
      if (!this._hold) step(this.sim, delta / 1000); // 장 제목 카드 동안은 정지(해답·par 무관 — wake 가 길어지는 것과 같음)
      this._consumeEvents();
      if (this.sim.status === 'won') this._onWin();
      else if (this.sim.status === 'lost') this._onFail(this.sim.reason);
      const pr = this._press;
      if (pr && this.state === 'playing' && time - pr.t > 300 && time - pr.lastCalc > 100) { // 1.2h: 미리보기는 0.3s 홀드 뒤(짧은 탭엔 위험이 남게)
        pr.lastCalc = time;
        if (!pr.shown && (this.previewsLeft || 0) <= 0) { pr.shown = true; pr.denied = true; this._toast(t('noPreview'), css(PAL.textDim), H * 0.8); this.tweens.add({ targets: this.previewBtn, scaleX: 1.1, scaleY: 1.1, duration: 120, yoyo: true, repeat: 1 }); }
        if (!pr.denied) { this._computePreview(pr.i); if (!pr.shown) { pr.shown = true; if (this.previewsLeft !== Infinity) this.previewsLeft = Math.max(0, (this.previewsLeft || 0) - 1); this._refreshPreviewBtn(); if (!this.save.seenHold) { this.save.seenHold = true; this._save(); this._hideHint(); } } }
      }
    } else if (this._press) { this._press = null; this._clearPreview(); }
    if (this.state === 'playing') this._syncMoth(delta);
    this._syncGlows(time);
    this._drawIntent();
    for (const wv of this.windViews) { wv.ts.tilePositionX -= wv.w.fx * delta / 1000 * 0.6; wv.ts.tilePositionY -= wv.w.fy * delta / 1000 * 0.6; }
  }
  _consumeEvents() {
    const ev = this.sim.events;
    for (; this._evIdx < ev.length; this._evIdx++) {
      const e = ev[this._evIdx];
      if (e.type === 'arrive') { SFX.arrive(); const l = this.sim.lamps[e.lamp]; this._tapRipple(l.x, l.y, false); if (!SIM.PULL[l.kind] && l.kind !== 'home' && this.sim.status === 'playing' && !(l.kind === 'oil' && l.on && l.timer < 1.5)) { this.checkpoints.push(this._snap()); this._refreshRewind(); if (this.previewsLeft !== Infinity && this.previewsLeft < PREVIEW_MAX) { this.previewsLeft++; this._refreshPreviewBtn(); } } }
      else if (e.type === 'oilOut') { SFX.oilOut(); const l = this.sim.lamps[e.lamp]; this._smokePuff(l.x, l.y); this._syncLampViews(false); }
      else if (e.type === 'target' && e.t > 0.05) {
        this._intentFlash = 1;
        if (this.mothSpr && this.state === 'playing') { this.tweens.killTweensOf(this.mothSpr, 'scaleY'); this._startle = 1; } // 1.2c: 화들짝
        const to = e.to >= 0 ? this.sim.lamps[e.to] : null;
        if (to) { const v = this.lampViews[e.to]; this.tweens.add({ targets: v.glow, scaleX: v.glow.scaleX * (SIM.PULL[to.kind] ? 1.5 : 1.35), scaleY: v.glow.scaleY * (SIM.PULL[to.kind] ? 1.5 : 1.35), duration: 240, yoyo: true }); } // 1.2g: 새 목표의 빛이 한 번 부풀어 '이겼다'를 보여줌
        if (to && SIM.PULL[to.kind]) { SFX.danger(); this._dangerPulse(); }
        else SFX.retarget();
      }
      else if (e.type === 'wake') { SFX.wake(); this._mothAwake = true; this.tweens.add({ targets: this.mothSpr, scaleX: this._mothScale, scaleY: this._mothScale, duration: 260, ease: 'Back.Out' }); const p = this.add.particles(this.sim.moth.x, this.sim.moth.y, 'dot', { lifespan: 500, speed: { min: 20, max: 70 }, scale: { start: 0.4, end: 0 }, tint: PAL.dust, blendMode: 'ADD', quantity: 8, emitting: false }).setDepth(DEPTH.FX); p.explode(8); this.time.delayedCall(600, () => p.destroy()); }
      else if (e.type === 'off' && e.auto) { const l = this.sim.lamps[e.lamp]; this._smokePuff(l.x, l.y); }
    }
  }
  _dangerPulse() {
    this.vignette.setTint(0xff2a1a).setAlpha(0.28); this.tweens.add({ targets: this.vignette, alpha: 0, duration: 420, onComplete: () => this.vignette.setTint(0x000000) });
  }
  _syncMoth(delta) {
    const m = this.sim.moth; const s = this.mothSpr;
    s.setPosition(m.x + (m.ox || 0), m.y + (m.oy || 0)); if (this.mothGlow) this.mothGlow.setPosition(m.x + (m.ox || 0), m.y + (m.oy || 0)).setAlpha(this.state === 'playing' ? 0.32 : 0);
    if (m.state === 'wake') { s.setRotation(Math.sin(this.sim.t * 3) * 0.08); return; } // 잠든 나방: 살짝 숨쉬기
    s.setRotation(m.heading + Math.PI / 2);
    const st = this._startle || 0; this._startle = Math.max(0, st - delta / 260);
    const flap = 0.86 + Math.abs(Math.sin(this.sim.t * 30)) * 0.14 + st * 0.35; // 날갯짓 + 화들짝(날개 활짝)
    s.setScale(this._mothScale * flap, this._mothScale * (1 + st * 0.12));
    // 치명 등불 맴돌이: 점점 붉어지고 불똥
    const tg0 = this.sim.target >= 0 ? this.sim.lamps[this.sim.target] : null;
    if (tg0 && SIM.PULL[tg0.kind] && m.state === 'orbit') { const p = Math.min(1, m.orbitT / SIM.PULL[tg0.kind]); s.setTint(Phaser.Display.Color.GetColor(255, Math.round(255 - 120 * p), Math.round(255 - 180 * p))); if (p > 0.35 && Math.random() < 0.25) this._singe(m.x, m.y); }
    else if (s.tintTopLeft !== 0xffffff) s.clearTint();
    // 치명 등불 맴돌이: 심장박동(점점 빨라짐)
    const tg = this.sim.target >= 0 ? this.sim.lamps[this.sim.target] : null;
    if (tg && SIM.PULL[tg.kind] && m.state === 'orbit' && this.state === 'playing') {
      const p = m.orbitT / SIM.PULL[tg.kind]; const period = 0.6 - p * 0.35;
      this._heartT += delta / 1000;
      if (this._heartT >= period) { this._heartT = 0; SFX.heart(); this.vignette.setTint(0xff2a1a).setAlpha(0.12 + p * 0.2); this.tweens.add({ targets: this.vignette, alpha: 0, duration: period * 800 }); }
    }
  }
  _syncGlows(time) {
    const tt = time / 1000;
    for (const v of this.lampViews) {
      if (!v.on) continue;
      const fl = 1 + Math.sin(tt * 9 + v.phase) * 0.05 + Math.sin(tt * 23 + v.phase * 2) * 0.03;
      v.glow.setScale(v.glowSize / 256 * fl);
      const pw = v.glowSize * (1.1 + 0.9 * v.poolK) * fl; v.pool.setDisplaySize(pw, pw * 0.22);
      if (v.l.kind === 'candle') { const bs = v.body._baseScale || 1; v.body.setScale(bs, bs * (1 + Math.sin(tt * 17 + v.phase) * 0.06)); }
    }
    // 끌려 들어가는 중(치명 등불 맴돌이) — 위험 링 + 기름등 잔량 링
    this.ringGfx.clear();
    const tg = this.sim.target >= 0 ? this.sim.lamps[this.sim.target] : null;
    const m = this.sim.moth;
    if (tg && SIM.PULL[tg.kind] && m.state === 'orbit') {
      const p = Math.min(1, m.orbitT / SIM.PULL[tg.kind]);
      this.ringGfx.lineStyle(3, PAL.danger, 0.35 + p * 0.5); this.ringGfx.beginPath(); this.ringGfx.arc(tg.x, tg.y, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p, false); this.ringGfx.strokePath();
    }
    for (const l of this.sim.lamps) if (l.kind === 'oil' && l.on && !l.spent) {
      const p = l.timer / l.oil;
      this.ringGfx.lineStyle(3, PAL.lampCore, 0.7); this.ringGfx.beginPath(); this.ringGfx.arc(l.x, l.y, 40, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p, false); this.ringGfx.strokePath();
    }
    if (tg) { this.ringGfx.lineStyle(1.5, PAL.lampCore, 0.35 + Math.sin(tt * 6) * 0.15); this.ringGfx.strokeCircle(tg.x, tg.y, 34 + Math.sin(tt * 6) * 2); }
  }
  // 의도선: 나방 → 목표 불 점선(가독성의 핵심)
  _drawIntent() {
    const g = this.lineGfx; g.clear();
    const s = this.sim; if (!s || s.status !== 'playing') return;
    if (s.target < 0) return;
    const tg = s.lamps[s.target], m = s.moth;
    const dx = tg.x - m.x, dy = tg.y - m.y, d = Math.hypot(dx, dy); if (d < 30) return;
    const ux = dx / d, uy = dy / d;
    const flash = this._intentFlash || 0; this._intentFlash = Math.max(0, flash - 0.04);
    const color = SIM.PULL[tg.kind] ? PAL.danger : PAL.lampCore;
    g.lineStyle(2, color, 0.22 + flash * 0.5);
    const dash = 10, gap = 9; const off = (s.t * 60) % (dash + gap);
    for (let p = off; p < d - 36; p += dash + gap) { g.lineBetween(m.x + ux * p, m.y + uy * p, m.x + ux * Math.min(d - 36, p + dash), m.y + uy * Math.min(d - 36, p + dash)); }
    const gp = ((s.t * 220) % Math.max(1, d - 36)); g.fillStyle(color, 0.5 + flash * 0.5); g.fillCircle(m.x + ux * gp, m.y + uy * gp, 3);
    // 1.2f: 끌림 가시화 — 다른 켜진 불에도 체감 거리 순으로 옅은 점선(가장 짙은 것 = 지금 불을 끄면 갈 곳). 숨은 규칙 (d+30)/lumen 을 화면에
    const parked = m.state === 'orbit' && !SIM.PULL[tg.kind];
    const rx = parked ? tg.x : m.x, ry = parked ? tg.y : m.y;
    const others = [];
    for (const l of s.lamps) { if (l.i === s.target || !l.on || l.spent) continue; const dd = Math.hypot(l.x - rx, l.y - ry); if (dd > l.reach) continue; others.push({ l, e: (dd + SIM.D0) / l.lumen }); }
    if (!others.length) return;
    const be = Math.min(...others.map((o) => o.e));
    for (const { l, e } of others) {
      const k = be / e, a = 0.12 + 0.45 * k * k; /* 1.2g: 더 짙게(7차 '안 보임') */ const L = Math.hypot(l.x - m.x, l.y - m.y) || 1; const vx = (l.x - m.x) / L, vy = (l.y - m.y) / L;
      g.lineStyle(k > 0.999 ? 2.4 : 1.6, SIM.PULL[l.kind] ? PAL.danger : PAL.lampCore, a);
      for (let p = 14; p < L - 34; p += 14) g.lineBetween(m.x + vx * p, m.y + vy * p, m.x + vx * Math.min(L - 34, p + 5), m.y + vy * Math.min(L - 34, p + 5));
    }
  }

  // ---------------------------------------------------------------------------
  // 결과
  // ---------------------------------------------------------------------------
  // 클리어 연출: 아래에서 풍등이 하나둘 떠올라 밤하늘로(별이 많을수록 많이)
  _skyLanterns(n) {
    for (let k = 0; k < n; k++) {
      const x = 40 + Math.random() * (W - 80), sc0 = 0.16 + Math.random() * 0.12;
      const im = this._fxObj(this.add.image(x, H + 30, this._tex('lamp_on')).setDepth(DEPTH.FX - 1).setAlpha(0).setTint(0xffd9a0));
      const sc = (26 + Math.random() * 18) / im.height; im.setScale(sc);
      const g = this._fxObj(this.add.image(x, H + 30, 'glow').setDisplaySize(70, 70).setTint(PAL.homeCore).setBlendMode(ADD).setAlpha(0).setDepth(DEPTH.FX - 2));
      const dur = 3200 + Math.random() * 1800, delay = k * 140 + Math.random() * 200, drift = (Math.random() - 0.5) * 90;
      this.tweens.add({ targets: [im, g], y: 140 + Math.random() * 220, x: x + drift, duration: dur, delay, ease: 'Sine.Out' });
      this.tweens.add({ targets: im, alpha: { from: 0, to: 0.9 }, duration: 600, delay });
      this.tweens.add({ targets: g, alpha: { from: 0, to: 0.35 }, duration: 600, delay });
      this.tweens.add({ targets: [im, g], alpha: 0, duration: 900, delay: delay + dur - 700, onComplete: () => { im.destroy(); g.destroy(); } });
      void sc0;
    }
  }
  _onWin() {
    this.state = 'won';
    this._hideHint();
    const lv = LEVELS[this.levelIdx];
    const taps = this.sim.taps;
    const stars = taps <= lv.par ? 3 : taps <= lv.par + 2 ? 2 : 1;
    const prev = this.save.stars[lv.id] || 0;
    if (!prev) { const before = this._cleared(); const nm = MOTHS.find((m) => m.need === before + 1); if (nm) this._fxTimer(1800, () => this._toast(t('newMoth', { name: nm.name[currentLang] || nm.name.en }), css(PAL.gold)));
      this.save.hintBank++; if (this.save.hintBank >= CONFIG.HINT_EVERY) { this.save.hintBank = 0; this.save.hints++; this._fxTimer(1200, () => this._toast(t('hintGot'), css(PAL.teal))); } }
    this.save.stars[lv.id] = Math.max(prev, stars);
    this._clearHintMarkers(); this._refreshHintBtn();
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(this.levelIdx + 1, LEVELS.length - 1));
    this.save.seenHow = true; this._save();
    SFX.win();
    // 도착 연출: 창이 환해지고 나방이 내려앉는다
    const home = this.lampViews.find((v) => v.l.kind === 'home');
    if (home) {
      this.tweens.add({ targets: home.glow, displayWidth: 900, displayHeight: 900, alpha: 1, duration: 700, ease: 'Cubic.Out' });
      // 1.2e: 평평한 빛 커튼 대신 — 창에서 비스듬히 퍼지는 빛줄기 셋(ADD) + 마당의 꺼진 등불이 집에서 가까운 순서로 켜지는 '등불 줄 점등'
      for (let k = 0; k < 3; k++) {
        const beam = this.add.image(home.l.x, home.l.y + 30, 'glow').setDisplaySize(70 + k * 50, 760).setOrigin(0.5, 0.08).setAngle(-26 + k * 26).setTint(PAL.homeCore).setAlpha(0).setBlendMode(ADD).setDepth(DEPTH.FX);
        this.tweens.add({ targets: beam, alpha: 0.32, duration: 420 + k * 120, ease: 'Quad.Out', yoyo: true, hold: 600, onComplete: () => beam.destroy() });
      }
      const order = this.lampViews.filter((v) => isPlayerLamp(v.l.kind) && !(v.l.on && !v.l.spent)).sort((a, b) => Math.hypot(a.l.x - home.l.x, a.l.y - home.l.y) - Math.hypot(b.l.x - home.l.x, b.l.y - home.l.y));
      order.forEach((v, i) => this._fxTimer(320 + i * 110, () => {
        if (this.state !== 'won') return;
        if (v.l.kind === 'lamp') { const k = this._lampKey(true); v.body.setTexture(this._tex(k)); this._fitH(v.body, k); if (v.vs) { v.body._baseScale *= v.vs; v.body.setScale(v.body._baseScale); } }
        else if (v.l.kind === 'oil') { v.body.setTexture(this._tex('oil_on')); this._fitH(v.body, 'oil_on'); }
        v.on = true; this.tweens.add({ targets: v.glow, alpha: 0.5, duration: 260 }); this.tweens.add({ targets: v.core, alpha: 0.8, duration: 200 }); this.tweens.add({ targets: v.pool, alpha: 0.3, duration: 300 });
        this._lightBurst(v.l.x, v.l.y, 0.45); SFX.star(Math.min(2, i));
      }));
    }
    this._skyLanterns(6 + stars * 3);
    { // 창 쪽으로 '밀려 들어가기': 레벨 컨테이너(world)를 집 등불 기준으로 1.12배(HUD 는 그대로)
      const hl = lv.lamps[0]; const k = { v: 1 }; const wld = this.world;
      this.tweens.add({ targets: k, v: 1.12, duration: 900, ease: 'Sine.InOut', yoyo: true, hold: 500, onUpdate: () => { wld.setScale(k.v).setPosition(hl.x * (1 - k.v), hl.y * (1 - k.v)); }, onComplete: () => { wld.setScale(1).setPosition(0, 0); } });
    }
    this.trail.emitting = false;
    this.tweens.add({ targets: this.mothSpr, x: lv.lamps[0].x, y: lv.lamps[0].y - 10, scaleX: this._mothScale * 0.75, scaleY: this._mothScale * 0.75, duration: 450, ease: 'Quad.Out' });
    this._winTimer = this.time.delayedCall(1250, () => {
      this._winTimer = null;
      if (this.state !== 'won') return;
      this.winTitle.setText(t('cleared', { n: this.levelIdx + 1 }));
      this.winTaps.setText(`${t('taps')} ${taps}  ·  ${t('par')} ${lv.par}`);
      this.winNext.txt.setText(t('next')); this.winHome.txt.setText(t('home')); this.winRetry.txt.setText(t('retry'));
      this._setGroup('win', true);
      this.winStars.forEach((st, i) => { st.setTexture(this._tex('lamp_off')).setAlpha(0.45).setScale(st._bs * 0.8); if (i < stars) this._fxTimer(250 + i * 220, () => { if (this.state !== 'won') return; st.setTexture(this._tex('lamp_on')).setAlpha(1); SFX.star(i); this.tweens.add({ targets: st, scaleX: st._bs * 1.12, scaleY: st._bs * 1.12, duration: 160, yoyo: true }); this._lightBurst(st.x, st.y, 0.6); }); });
    });
  }
  _onFail(reason) {
    this.state = 'failed';
    this._hideHint(); this._refreshHintBtn(); // 1.1: 힌트 표식은 되감기 후에도 유지
    const m = this.sim.moth;
    this.trail.emitting = false;
    this.vignette.setTint(0x05030a).setAlpha(0.5); this.tweens.add({ targets: this.vignette, alpha: 0, delay: 500, duration: 500, onComplete: () => this.vignette.setTint(0x000000) }); // 1.2h: 실패 = 화면이 잠깐 어두워짐
    if (reason === 'burn') {
      SFX.burn(); this._toast(t('burned'), css(PAL.danger));
      const flash = this.add.rectangle(W / 2, H / 2, W, H, 0xff7a1a, 0.35).setDepth(DEPTH.FX + 1); this.tweens.add({ targets: flash, alpha: 0, duration: 380, onComplete: () => flash.destroy() });
      const p = this.add.particles(m.x, m.y, 'dot', { lifespan: 900, speed: { min: 30, max: 140 }, gravityY: -60, scale: { start: 0.7, end: 0 }, tint: [0xff7a1a, 0xffd27a, 0x444444], blendMode: 'ADD', quantity: 24, emitting: false }).setDepth(DEPTH.FX); p.explode(24); this.time.delayedCall(1000, () => p.destroy());
      // 1.2e: 글자 대신 몸으로 — 불똥을 흘리며 빙글 돌아 떨어지는 나방(텀블)
      this.tweens.add({ targets: this.mothSpr, angle: '+=540', y: m.y + 150, x: m.x + ((m.x | 0) % 2 ? 44 : -44), scaleX: this._mothScale * 0.3, scaleY: this._mothScale * 0.3, alpha: 0, duration: 680, ease: 'Quad.In' });
      const em = this.add.particles(0, 0, 'dot', { lifespan: 520, speed: { min: 10, max: 40 }, gravityY: -50, scale: { start: 0.42, end: 0 }, tint: [0xff8a2a, 0xffd27a, 0x666666], blendMode: 'ADD', frequency: 24 }).setDepth(DEPTH.FX);
      em.startFollow(this.mothSpr); this.time.delayedCall(720, () => em.destroy());
      this.cameras.main.shake(180, 0.006);
    } else if (reason === 'web') {
      SFX.web(); this._toast(t('webbed'), css(PAL.web)); this.cameras.main.shake(140, 0.004);
      for (const o of this.world.list) if (o.texture && /web$/.test(o.texture.key) && Math.hypot(o.x - m.x, o.y - m.y) < 120) this.tweens.add({ targets: o, scaleX: o.scaleX * 1.06, scaleY: o.scaleY * 1.06, duration: 70, yoyo: true, repeat: 5 });
      this.tweens.add({ targets: this.mothSpr, angle: '+=25', duration: 90, yoyo: true, repeat: 4 });
      this.tweens.add({ targets: this.mothSpr, alpha: 0.3, duration: 800 });
      // 1.2e: 거미줄 실 가닥이 나방을 감는다(가까운 거미줄 중심 → 나방, 세 가닥, 떨림)
      const wb = this.sim.webs.reduce((a, w) => (!a || Math.hypot(w.x - m.x, w.y - m.y) < Math.hypot(a.x - m.x, a.y - m.y) ? w : a), null);
      if (wb) { const silk = this.add.graphics().setDepth(DEPTH.MOTH + 1); const draw = (k) => { silk.clear(); silk.lineStyle(1.5, PAL.web, 0.85); for (let s = 0; s < 3; s++) { const j = Math.sin(k * 30 + s * 2.1) * 6; silk.lineBetween(wb.x + (s - 1) * 10, wb.y + (s - 1) * 6, m.x + (s - 1) * 14 + j, m.y + (s - 1) * 9 - j); } }; draw(0);
        const cnt = { v: 0 }; this.tweens.addCounter({ from: 0, to: 1, duration: 900, onUpdate: (tw) => draw(tw.getValue()), onComplete: () => silk.destroy() }); void cnt; }
    } else { this._toast(t('lostNight'), css(PAL.textDim)); this.tweens.add({ targets: this.mothSpr, alpha: 0, duration: 500 }); }
    // 1.1: 처음부터가 아니라 마지막으로 앉았던 등불로 되감기
    this._failTimer = this.time.delayedCall(CONFIG.FAIL_RESTART_MS, () => { this._failTimer = null; if (this.state === 'failed') { this.attempt++; this._rewind(true); } });
  }
  _restartLevel() { if (this.state === 'playing' || this.state === 'failed' || this.state === 'won') { this._setGroup('win', false); this._startLevel(); } }
  // 버튼 경유 재시작/다음/홈 = 비게임플레이 버튼 → 미드롤(GD 규격, 자체 쿨다운 없음)
  async _retryByButton() {
    if (this.state === 'loading' || this.state === 'title') return;
    const prev = this.state; this.state = 'loading';
    await GDFlow.playAd('interstitial');
    this.state = prev; this._setGroup('win', false); this._startLevel();
  }
  async _nextByButton() {
    if (this.state !== 'won') return;
    this.state = 'loading';
    await GDFlow.playAd('interstitial');
    this._setGroup('win', false);
    if (this.levelIdx + 1 >= LEVELS.length) { this._toast(t('allDone')); this._clearHintMarkers(); this._showTitle(); return; } else this.levelIdx++;
    this.attempt = 0; this.state = 'won';
    this._startLevel();
  }
  async _goHome() {
    if (this.state === 'loading' || this.state === 'title') return;
    this.state = 'loading';
    await GDFlow.playAd('interstitial');
    this._setGroup('win', false);
    this._clearHintMarkers();
    this._showTitle();
  }
}

// =============================================================================
// 부팅 — 폰트 준비 후(FOUT 방지) Phaser 생성. GDFlow 가 광고·레터박스·회전 안내를 맡는다.
// =============================================================================
const phaserConfig = {
  type: Phaser.AUTO, parent: 'game-container', backgroundColor: '#070a1a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER, expandParent: false, autoRound: true, width: W, height: H },
  scene: [Game],
  render: { antialias: true, pixelArt: false },
};
(async () => {
  try { if (document.fonts && document.fonts.load) await Promise.race([Promise.all([document.fonts.load("700 20px 'Montserrat'"), document.fonts.load("400 20px 'Yuji Syuku'")]), new Promise((r) => setTimeout(r, 1500))]); } catch (e) {}
  const game = new Phaser.Game(phaserConfig);
  GDFlow.init({ game, sceneKey: 'game', lang: () => currentLang, setAdMuted: (m) => { SFX.setAdMuted(m); MUSIC.setAdMuted(m); } });
  const unlock = () => { SFX.unlock(); MUSIC.start(); }; // 첫 제스처에서 BGM 시작(브라우저 자동재생 정책·GD 요건)
  ['pointerdown', 'touchend', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock));
})();
