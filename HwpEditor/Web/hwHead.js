/* 문단 머리(글머리표·문단 번호·개요)를 <b>그리기만</b> 한다 — 줄 나눔에는 안 먹인다.
   ★ 표본의 머리 문단은 전부 한 줄이라 머리가 줄 나눔에 먹는지 <b>못 쟀다</b>(FEATURE-PLAN E11 실측).
     머리 몫을 본문 폭에서 빼면 지금 100% 인 lists·lists-bullet·basicsReport 의 배치가 갈리므로,
     회귀가 안 나는 쪽을 택해 첫 줄 시작 x <b>왼쪽</b>에 얹는다(문단 테두리와 같은 층).

   번호 값은 문서 순서로 누적한다 — 목록(본문·표 칸·머리말 띠)마다 카운터를 따로 둔다. */

var hwHead = (function () {
  'use strict';

  var cCache = null, cGen = -1;

  /* 사용자 영역 글머리표 → 볼 수 있는 글자. 문서가 실제로 쓰는 것은 Wingdings·Symbol 글꼴의
     글리프라, 본문 글꼴로 그대로 그리면 두부가 뜬다(실측 lists-bullet.hwp 22개 중 17개). */
  var cWing = {
    0xF046: '❖', 0xF06C: '●', 0xF06E: '■', 0xF06F: '□', 0xF075: '❑', 0xF076: '❖',
    0xF077: '◆', 0xF09F: '•', 0xF0A1: '○', 0xF0A4: '◆', 0xF0A7: '▪', 0xF0AB: '◈',
    0xF0FC: '✔', 0xF0FE: '☑'
  };

  var cHangul = '가나다라마바사아자차카타파하';
  var cJamo = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ';
  var cRoman = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];

  function roman(n) {
    var out = '';
    for (var i = 0; i < cRoman.length && n > 0; i++)
      while (n >= cRoman[i][0]) { out += cRoman[i][1]; n -= cRoman[i][0]; }
    return out;
  }

  /* A·B·…·Z·AA — 26 을 넘으면 자리를 늘린다. */
  function alpha(n) {
    var out = '';
    while (n > 0) { n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
    return out;
  }

  function circled(n) {
    if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
    return String(n);
  }

  /* 값 하나를 모양대로. ★ 표본에 나오는 것만 제대로 쓰고 나머지는 십진으로 떨어뜨린다. */
  function numText(n, fmt) {
    switch (fmt) {
      case 'circledDigit': return circled(n);
      case 'romanUpper': return roman(n);
      case 'romanLower': return roman(n).toLowerCase();
      case 'alphaUpper': return alpha(n);
      case 'alphaLower': return alpha(n).toLowerCase();
      case 'circledAlphaUpper': return alpha(n);
      case 'circledAlphaLower': return alpha(n).toLowerCase();
      case 'hangul': return cHangul.charAt((n - 1) % cHangul.length);
      case 'circledHangul': return cHangul.charAt((n - 1) % cHangul.length);
      case 'jamo': return cJamo.charAt((n - 1) % cJamo.length);
      case 'circledJamo': return cJamo.charAt((n - 1) % cJamo.length);
      default: return String(n);
    }
  }

  function numbering(id) {
    var list = hwDoc && hwDoc.numberings;
    if (!list) return null;
    /* ★ 개요는 headId 가 0 이다(실측) — 문서의 첫 번호 정의로 그린다(우리가 정한 규칙). */
    return list[id] || list[1] || null;
  }

  function bullet(id) {
    var list = hwDoc && hwDoc.bullets;
    return (list && list[id]) || null;
  }

  function levelOf(num, lvl) {
    if (!num || !num.levels || !num.levels.length) return null;
    return num.levels[Math.min(lvl, num.levels.length - 1)] || null;
  }

  function startOf(num, lvl) {
    var lv = levelOf(num, lvl);
    if (lv && lv.start > 0) return lv.start;
    if (num && num.start > 0) return num.start;
    return 1;
  }

  /* 한 목록(본문·칸·띠)의 카운터 한 벌. 목록이 다르면 번호를 따로 센다. */
  function scopeOf(scopes, list) {
    for (var i = 0; i < scopes.length; i++) if (scopes[i].list === list) return scopes[i];
    var s = { list: list, n: {} };
    scopes.push(s);
    return s;
  }

  function build() {
    var map = {};
    if (!hwDoc) return map;

    var scopes = [];
    var paras = hwModel.allParas();

    for (var i = 0; i < paras.length; i++) {
      var p = paras[i];
      var ps = hwModel.paraShape(p.ps);
      var kind = ps && ps.head;
      if (!kind || kind === 'none') continue;

      if (kind === 'bullet') {
        var b = bullet(ps.headId);
        var ch = b && b.ch ? b.ch : '';
        map[p.id] = ch ? (cWing[ch.charCodeAt(0)] || (ch.charCodeAt(0) >= 0xE000 && ch.charCodeAt(0) <= 0xF8FF ? '·' : ch)) : '·';
        continue;
      }

      var num = numbering(ps.headId);
      var lvl = Math.max(0, Math.min(6, ps.lvl || 0));
      var sc = scopeOf(scopes, hwModel.listOf(p));
      var key = (ps.headId || 0) + '/';

      /* 이 수준을 한 칸 올리고 <b>더 깊은 수준은 리셋</b>한다 — 3-2 다음의 3-3 이 3-2-1 을 안 물려받는다. */
      sc.n[key + lvl] = sc.n[key + lvl] === undefined ? startOf(num, lvl) : sc.n[key + lvl] + 1;
      for (var d = lvl + 1; d <= 6; d++) delete sc.n[key + d];

      var lv = levelOf(num, lvl);
      var fmt = (lv && lv.fmt) || '^1';
      map[p.id] = fmt.replace(/\^([1-7])/g, function (m, k) {
        var at = parseInt(k, 10) - 1;
        var v = sc.n[key + at];
        if (v === undefined) v = startOf(num, at);
        return numText(v, (levelOf(num, at) || {}).numFmt || 'digit');
      });
    }
    return map;
  }

  function all() {
    var gen = hwModel.gen();
    if (cCache === null || cGen !== gen) { cCache = build(); cGen = gen; }
    return cCache;
  }

  return {
    /* 이 문단의 머리 글. 없으면 빈 문자열이다. */
    textOf: function (para) { return (para && all()[para.id]) || ''; },

    /* 머리와 본문 사이 간격(HWPUNIT). hwp·hwpx 둘 다 표본은 "글자 폭의 50%" 다. */
    gapHu: function (ps, cs) {
      var h = null;
      if (ps.head === 'bullet') { var b = bullet(ps.headId); h = b && b.head; }
      else { h = levelOf(numbering(ps.headId), ps.lvl || 0); }
      if (!h) return 0;
      return h.distPct ? (cs.sizeHu || 1000) * (h.dist || 0) / 100 : (h.dist || 0);
    },

    numText: numText
  };
})();
