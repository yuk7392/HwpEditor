/* 오라클 대조. 문서에 저장돼 있던 lineseg(한글이 계산한 줄 정보)와 우리 레이아웃을 견준다.

   ★ 채점 대상은 우리 쪽이다 — seg 를 우리 결과에 맞춰 손보는 순간 이 검사는 아무 의견도 못 낸다.
   ★ 편집으로 dirty 가 된 문단은 seg 가 null 이므로 대조에서 빠진다(계획 B-5). */

var hwOracle = (function () {
  'use strict';

  /* 문단 하나: 줄 시작 인덱스 배열이 통째로 같아야 "일치"다. */
  function comparePara(para, ourLines) {
    if (!para.seg || !para.seg.length) return null;

    var expect = [], actual = [];
    for (var i = 0; i < para.seg.length; i++) expect.push(para.seg[i].s);
    for (var k = 0; k < ourLines.length; k++) actual.push(ourLines[k].line.s);

    var same = expect.length === actual.length;
    if (same) for (var j = 0; j < expect.length; j++) if (expect[j] !== actual[j]) { same = false; break; }

    /* y 오차는 쪽 안에서만 뜻이 있다 — 줄 수가 같을 때만 잰다. */
    var maxDy = 0;
    if (expect.length === actual.length) {
      for (var m = 0; m < ourLines.length; m++) {
        var dy = Math.abs(ourLines[m].yHu - para.seg[m].y);
        if (dy > maxDy) maxDy = dy;
      }
    } else {
      maxDy = -1;
    }

    return {
      id: para.id, ok: same, expect: expect, actual: actual, maxDy: maxDy,
      text: hwModel.text(para).slice(0, 30)
    };
  }

  function check() {
    var total = 0, match = 0, details = [];
    var dySum = 0, dyCount = 0, dyMax = 0;

    /* 쪽 배치 결과를 문단별로 다시 모은다. */
    var byPara = {};
    for (var pg = 0; pg < hwPages.length; pg++) {
      var lines = hwPages[pg].lines;
      for (var i = 0; i < lines.length; i++) {
        var id = lines[i].para.id;
        if (!byPara[id]) byPara[id] = [];
        byPara[id].push(lines[i]);
      }
    }

    for (var si = 0; si < hwDoc.sections.length; si++) {
      var paras = hwDoc.sections[si].paras;
      for (var pi = 0; pi < paras.length; pi++) {
        var r = comparePara(paras[pi], byPara[paras[pi].id] || []);
        if (!r) continue;
        total++;
        if (r.ok) match++;
        if (r.maxDy >= 0) { dySum += r.maxDy; dyCount++; if (r.maxDy > dyMax) dyMax = r.maxDy; }
        if (!r.ok && details.length < 20) details.push(r);
      }
    }

    return {
      total: total,
      match: match,
      rate: total ? Math.round(match * 1000 / total) / 10 : 0,
      pages: hwPages.length,
      lines: countLines(),
      dyAvg: dyCount ? Math.round(dySum / dyCount) : 0,
      dyMax: dyMax,
      probe: (function () {
        var cs = { sizeHu: 1200, face: 1, ratio: 100, spacing: 0, bold: false, italic: false };
        return {
          hangul: Math.round(hwMeasure.charHu('가', cs)),
          space: Math.round(hwMeasure.charHu(' ', cs)),
          comma: Math.round(hwMeasure.charHu(',', cs)),
          latinA: Math.round(hwMeasure.charHu('A', cs))
        };
      })(),
      fontGothic: hwMeasure.fontLoaded('NanumGothicHW'),
      fontMyeongjo: hwMeasure.fontLoaded('NanumMyeongjoHW'),
      details: details
    };
  }

  function countLines() {
    var n = 0;
    for (var i = 0; i < hwPages.length; i++) n += hwPages[i].lines.length;
    return n;
  }

  return { check: check };
})();

function hwOracleCheck() { return hwOracle.check(); }

/* C# 이 화면 밖에서 부르는 통로 — 결과를 그대로 올려 보낸다. */
function hwReportOracle() {
  var r = hwOracleCheck();
  hwPost({ t: 'oracle', r: r });
}
