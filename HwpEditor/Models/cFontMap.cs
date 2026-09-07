using System;

namespace HwpEditor.Models
{
    /// <summary>
    /// 문서가 쓰는 글꼴을 이 PC 에 있는 것으로 바꿔 준다.
    ///
    /// ★ 이 PC 에 한글(Hancom Office)이 없어 <b>함초롬바탕·함초롬돋움이 아예 없다</b>. 그런데 샘플의
    ///   기본 글꼴이 대부분 그것이라, 대체를 안 하면 브라우저가 제멋대로 고른 글꼴로 폭을 재고
    ///   그러면 줄 나눔이 lineseg 오라클과 전부 어긋난다.
    ///
    /// ★ 패밀리 이름에 <c>HW</c> 접미사를 붙인다. 설치 글꼴과 같은 이름을 쓰면 @font-face 가
    ///   실패했을 때 브라우저가 조용히 설치 글꼴로 넘어가서, 폭 측정으로도 그 사실이 안 보인다.
    /// </summary>
    public static class cFontMap
    {
        public const string cGothic = "NanumGothicHW";
        public const string cMyeongjo = "NanumMyeongjoHW";

        /// <summary>
        /// 명조 계열로 볼 이름 조각. 나머지(돋움·고딕·굴림·함초롬돋움 등)는 전부 고딕으로 보낸다.
        /// ★ 굴림은 산세리프라 여기 넣지 않는다 — 이름만 보면 바탕과 헷갈리기 쉽다.
        /// </summary>
        private static readonly string[] cSerifHints =
            { "바탕", "명조", "궁서", "batang", "myeongjo", "gungsuh", "serif" };

        public static string Substitute(string pFaceName)
        {
            if (string.IsNullOrEmpty(pFaceName)) return cGothic;

            for (int i = 0; i < cSerifHints.Length; i++)
                if (pFaceName.IndexOf(cSerifHints[i], StringComparison.OrdinalIgnoreCase) >= 0)
                    return cMyeongjo;

            return cGothic;
        }
    }
}
