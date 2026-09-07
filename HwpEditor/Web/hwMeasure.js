/* 글자 폭 측정. 줄 나눔이 오라클과 맞느냐가 전부 여기에 달려 있다.

   ★ 반올림하지 않는다. 글자마다 0.5 HWPUNIT 씩만 잘라도 40글자 줄에서 20 HWPUNIT 이 어긋나고,
     그게 줄 끝 한 글자를 밀어 낸다.

   ★ 폰트 크기를 바꿔 가며 재지 않는다. canvas measureText 는 크기에 선형이므로
     100px 로 한 번 재서 캐시하고, 실제 크기는 곱셈으로 낸다:
        W_hu = W100 * sizeHu / 100
     (sizePx = sizeHu/75, W_px = W100 * sizePx/100, W_hu = W_px * 75 → 정리하면 위 식)
     크기별로 캐시하면 문서 하나에 캐시가 수십 벌 생기고 첫 화면이 눈에 띄게 느려진다. */

var hwMeasure = (function () {
  'use strict';

  var cCanvas = null, cCtx = null;

  /* "패밀리|B|I" → { 글자 → 100px 폭 } */
  var cCache = {};

  var cReady = false;

  /* 공백 폭(em). 나눔의 공백은 0.273em 으로 좁은데 한글 문서의 기준 글꼴(함초롬)은 0.5em 이다.
     실측으로 정한 값이라 바꾸려면 오라클 일치율로 판정한다. */
  var cSpaceEm = 0.5;

  function ctx() {
    if (!cCtx) {
      cCanvas = document.createElement('canvas');
      cCanvas.width = 8;
      cCanvas.height = 8;
      cCtx = cCanvas.getContext('2d');
    }
    return cCtx;
  }

  /* 글자모양 → CSS font 문자열(100px 고정). 순서는 CSS 규격대로 style weight size family. */
  function fontKey(cs) {
    var face = hwModel.faceName(cs.face);
    var fam = (face && face.sub) || 'NanumGothicHW';
    return fam + '|' + (cs.bold ? 'B' : '') + (cs.italic ? 'I' : '');
  }

  function fontString(key) {
    var t = key.split('|');
    var fam = t[0], flags = t[1] || '';
    return (flags.indexOf('I') >= 0 ? 'italic ' : '')
         + (flags.indexOf('B') >= 0 ? '700 ' : '')
         + '100px "' + fam + '"';
  }

  /* 정폭(1em)으로 다루는 글자: 한글 음절·자모, 한자, 전각 문장부호·기호. */
  function isFullWidth(ch) {
    var c = ch.charCodeAt(0);
    return (c >= 0xAC00 && c <= 0xD7A3)     /* 한글 음절 */
        || (c >= 0x1100 && c <= 0x11FF)     /* 한글 자모 */
        || (c >= 0x3130 && c <= 0x318F)     /* 호환 자모 */
        || (c >= 0x4E00 && c <= 0x9FFF)     /* 한자 */
        || (c >= 0x3400 && c <= 0x4DBF)     /* 한자 확장 A */
        || (c >= 0xF900 && c <= 0xFAFF)     /* 한자 호환 */
        || (c >= 0x3000 && c <= 0x303F)     /* 전각 문장부호 */
        || (c >= 0xFF01 && c <= 0xFF60)     /* 전각 영숫자·기호 */
        || (c >= 0xFFE0 && c <= 0xFFE6);
  }

  function width100(key, ch) {
    var box = cCache[key];
    if (!box) { box = cCache[key] = {}; }
    var w = box[ch];
    if (w !== undefined) return w;

    var c = ctx();
    c.font = fontString(key);
    w = c.measureText(ch).width;
    box[ch] = w;
    return w;
  }

  return {
    /* @font-face 가 실제로 로드된 뒤에 재야 한다 — 안 그러면 대체 글꼴 폭으로 캐시가 굳는다.
       ★ document.fonts.ready 만 기다리면 안 된다. @font-face 는 실제로 쓰이기 전까지 아예
         받아 오지 않으므로, 아직 아무도 안 쓴 글꼴은 "받는 중"이 아니라서 ready 가 그냥 통과한다
         (실측 — 명조를 안 쓴 문서에서만 폰트 판정이 OK 로 나왔다). 네 벌을 명시적으로 불러 온다. */
    ready: function () {
      if (cReady) return Promise.resolve();

      var want = [
        '100px "NanumGothicHW"', '700 100px "NanumGothicHW"',
        '100px "NanumMyeongjoHW"', '700 100px "NanumMyeongjoHW"'
      ];
      var jobs = [];
      if (document.fonts && document.fonts.load) {
        for (var i = 0; i < want.length; i++) {
          /* 한글 글리프까지 확실히 받게 표본을 준다 — 기본 표본은 라틴뿐이다. */
          jobs.push(document.fonts.load(want[i], '가나다ABC123').catch(function () { }));
        }
      }

      return Promise.all(jobs).then(function () {
        return (document.fonts && document.fonts.ready) ? document.fonts.ready : null;
      }).then(function () {
        cReady = true;
        cCache = {};
      });
    },

    isReady: function () { return cReady; },

    /* 글자 하나의 폭(HWPUNIT). 장평·자간까지 얹은 값이다.

       ★ 한글·한자·전각 문장부호는 대체 글꼴을 재지 않고 <b>글자 크기 그대로</b>(1em) 쓴다.
         한글 문서에서 이 글자들은 정폭이고 함초롬도 그렇다. 그런데 이 PC 에 함초롬이 없어 나눔으로
         대체하는데, 나눔의 한글 자간폭이 1em 보다 좁아서 재는 대로 두면 줄마다 서너 글자씩 더 들어간다
         (실측 — complaint-form.hwpx 가 41자에서 끊기는 줄을 우리는 45자까지 넣었다).
         대체 글꼴의 개성을 문서의 조판으로 착각하지 않으려면 여기서 끊어야 한다. */
    charHu: function (ch, cs) {
      var w = isFullWidth(ch) ? cs.sizeHu
            : (ch === ' ' ? cs.sizeHu * cSpaceEm : width100(fontKey(cs), ch) * cs.sizeHu / 100);
      if (cs.ratio && cs.ratio !== 100) w = w * cs.ratio / 100;
      if (cs.spacing) w += cs.sizeHu * cs.spacing / 100;
      return w;
    },

    /* 글자 크기(HWPUNIT). 줄 높이 계산의 바탕이다. */
    sizeHu: function (cs) { return cs.sizeHu; },

    /* ★ <b>브라우저가 실제로 그릴</b> 폭(HWPUNIT). 장평·자간을 안 얹은 날 것이다.
       charHu 와 이 값의 차이가 곧 화면에 자간으로 메워야 할 양이다 — 그래야 우리가 계산한
       캐럿 자리와 눈에 보이는 글자 자리가 같아진다. */
    naturalHu: function (ch, cs) {
      return width100(fontKey(cs), ch) * cs.sizeHu / 100;
    },

    /* 진단용 — 캐시에 든 패밀리와 글자 수. */
    stats: function () {
      var out = {};
      for (var k in cCache) if (cCache.hasOwnProperty(k)) out[k] = Object.keys(cCache[k]).length;
      return out;
    },

    /* @font-face 가 정말 먹었는지 본다. 대체 글꼴로 떨어지면 폭이 달라지므로 여기서 걸러야 한다. */
    fontLoaded: function (family) {
      if (!document.fonts || !document.fonts.check) return null;
      return document.fonts.check('100px "' + family + '"');
    }
  };
})();
