using HwpEditor.Models;
using HwpLib.Object.DocInfo.Numbering;

namespace HwpEditor.Files
{
    /// <summary>
    /// 문단 머리(번호·글머리표) 값의 이름표. <see cref="cBorderMap"/> 과 같은 약속이다 —
    /// <b>네 파일이 같은 표를 써야 한다</b>(hwp 리더·hwp 되쓰기·hwpx 리더·hwpx 되쓰기).
    ///
    /// 자리 번호가 곧 hwp <c>ParagraphNumberFormat</c> 값이다.
    /// </summary>
    public static class cHeadMap
    {
        private static readonly string[] cNumFmt =
        {
            "digit", "circledDigit", "romanUpper", "romanLower", "alphaUpper", "alphaLower",
            "circledAlphaUpper", "circledAlphaLower", "hangul", "circledHangul", "jamo",
            "circledJamo", "hangulNum", "hanjaNum", "circledHanjaNum", "sibganHangul", "sibganHanja"
        };

        /// <summary>hwpx <c>numFmt</c> 이름. 자리 번호는 <see cref="cNumFmt"/> 와 같다.</summary>
        private static readonly string[] cHwpxNumFmt =
        {
            "DIGIT", "CIRCLED_DIGIT", "ROMAN_CAPITAL", "ROMAN_SMALL", "LATIN_CAPITAL", "LATIN_SMALL",
            "CIRCLED_LATIN_CAPITAL", "CIRCLED_LATIN_SMALL", "HANGUL_SYLLABLE", "CIRCLED_HANGUL_SYLLABLE",
            "HANGUL_JAMO", "CIRCLED_HANGUL_JAMO", "HANGUL_PHONETIC", "IDEOGRAPH", "CIRCLED_IDEOGRAPH",
            "DECAGON_CIRCLE", "DECAGON_CIRCLE_HANJA"
        };

        public static string NumFmtOf(ParagraphNumberFormat pValue)
        {
            int i = (int)pValue;
            return i >= 0 && i < cNumFmt.Length ? cNumFmt[i] : "digit";
        }

        public static ParagraphNumberFormat NumFmtOf(string pName)
        {
            return (ParagraphNumberFormat)IndexOf(cNumFmt, pName);
        }

        public static string HwpxNumFmt(string pName)
        {
            return cHwpxNumFmt[IndexOf(cNumFmt, pName)];
        }

        public static string NumFmtOfHwpx(string pName)
        {
            return cNumFmt[IndexOf(cHwpxNumFmt, pName)];
        }

        /// <summary>hwp <c>ParaHeadShape</c> 자리 번호 그대로 — 0=없음 1=개요 2=번호 3=글머리표.</summary>
        public static string HeadOf(HwpLib.Object.DocInfo.ParaShape.ParaHeadShape pValue)
        {
            switch (pValue)
            {
                case HwpLib.Object.DocInfo.ParaShape.ParaHeadShape.Outline: return "outline";
                case HwpLib.Object.DocInfo.ParaShape.ParaHeadShape.Numbering: return "number";
                case HwpLib.Object.DocInfo.ParaShape.ParaHeadShape.Bullet: return "bullet";
                default: return "none";
            }
        }

        public static HwpLib.Object.DocInfo.ParaShape.ParaHeadShape HeadOf(string pName)
        {
            switch (pName)
            {
                case "outline": return HwpLib.Object.DocInfo.ParaShape.ParaHeadShape.Outline;
                case "number": return HwpLib.Object.DocInfo.ParaShape.ParaHeadShape.Numbering;
                case "bullet": return HwpLib.Object.DocInfo.ParaShape.ParaHeadShape.Bullet;
                default: return HwpLib.Object.DocInfo.ParaShape.ParaHeadShape.None;
            }
        }

        /// <summary>hwpx <c>hh:heading@type</c>.</summary>
        public static string HwpxHead(string pName)
        {
            switch (pName)
            {
                case "outline": return "OUTLINE";
                case "number": return "NUMBER";
                case "bullet": return "BULLET";
                default: return "NONE";
            }
        }

        public static string HeadOfHwpx(string pType)
        {
            switch (pType)
            {
                case "OUTLINE": return "outline";
                case "NUMBER": return "number";
                case "BULLET": return "bullet";
                default: return "none";
            }
        }

        /// <summary>
        /// 머리 정보를 모델로. hwp 는 간격 종류가 <c>RatioForLetter</c> 일 때만 %다
        /// (실측 표본은 전부 <c>dist=50</c>·%).
        /// </summary>
        public static ParaHeadModel Read(ParagraphHeadInfo pInfo)
        {
            ParaHeadModel m = new ParaHeadModel();
            if (pInfo == null) return m;
            m.Dist = pInfo.DistanceFromBody;
            m.DistPct = pInfo.Property != null
                     && pInfo.Property.ValueTypeForDistanceFromBody == HwpLib.Object.DocInfo.Numbering.ValueType.RatioForLetter;
            if (pInfo.Property != null) m.NumFmt = NumFmtOf(pInfo.Property.ParagraphNumberFormat);
            return m;
        }

        private static int IndexOf(string[] pList, string pName)
        {
            for (int i = 0; i < pList.Length; i++) if (pList[i] == pName) return i;
            return 0;
        }
    }
}
