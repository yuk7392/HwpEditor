/* 단위 변환. HWPUNIT = 1/7200 인치.
   ★ 반올림하지 않는다 — 오라클 대조가 줄마다 어긋난다(계획 7절). */

var hwUnit = (function () {
  'use strict';

  var cZoom = 1;

  return {
    /* HWPUNIT → CSS px (96dpi 기준 hu/75) */
    hu2px: function (hu) { return hu / 75 * cZoom; },
    px2hu: function (px) { return px * 75 / cZoom; },

    /* HWPUNIT → pt (72dpi 기준 hu/100) */
    hu2pt: function (hu) { return hu / 100; },
    pt2hu: function (pt) { return pt * 100; },

    zoom: function (v) {
      if (v === undefined) return cZoom;
      cZoom = v;
      return cZoom;
    }
  };
})();

/* 전역 축약 — 레이아웃 코드에서 가장 많이 불린다. */
function hwHu2Px(hu) { return hwUnit.hu2px(hu); }
function hwPx2Hu(px) { return hwUnit.px2hu(px); }
