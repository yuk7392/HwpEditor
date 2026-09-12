using System;
using System.Globalization;
using HwpEditor.Models;
using HwpLib.Object.DocInfo.BorderFill;
using HwpLib.Object.DocInfo.BorderFill.FillInfo;
using HwpLib.Object.DocInfo.CharShape;
using HwpLib.Object.Etc;

namespace HwpEditor.Files
{
    /// <summary>
    /// 테두리/배경·글자 효과 값의 이름표. ★ <b>네 파일이 같은 표를 써야 한다</b> — hwp 리더·hwp 되쓰기·
    /// hwpx 리더·hwpx 되쓰기. 한 곳만 이름을 달리 쓰면 저장 왕복 한 번에 선 모양이 바뀐다.
    ///
    /// 모델 값은 hwp 쪽 enum 번호를 그대로 쓰고, hwpx 이름은 여기서 그 번호로 옮긴다.
    /// </summary>
    public static class cBorderMap
    {
        /// <summary>hwp 는 "없음" 을 이 값으로 둔다(실측 2026-09-12 — 표본 3개 전부). 흰색이 아니다.</summary>
        public const uint cNoneColor = 0xFFFFFFFF;

        /// <summary>덤프 5-4 의 굵기 16단. 자리 번호가 곧 hwp <c>BorderThickness</c> 값이다.</summary>
        private static readonly string[] cMm =
        {
            "0.1", "0.12", "0.15", "0.2", "0.25", "0.3", "0.4", "0.5",
            "0.6", "0.7", "1.0", "1.5", "2.0", "3.0", "4.0", "5.0"
        };

        /// <summary>hwp <c>BorderType</c> 18종. 자리 번호가 곧 enum 값이다.</summary>
        private static readonly string[] cTypes =
        {
            "none", "solid", "dash", "dot", "dashDot", "dashDotDot", "longDash", "circleDot",
            "double", "thinThick", "thickThin", "thinThickThin", "wave", "doubleWave",
            "thick3D", "thick3DReverse", "solid3D", "solid3DReverse"
        };

        /// <summary>hwpx 쪽 이름. 자리 번호는 <see cref="cTypes"/> 와 같다.</summary>
        private static readonly string[] cHwpxTypes =
        {
            "NONE", "SOLID", "DASH", "DOT", "DASH_DOT", "DASH_DOT_DOT", "LONG_DASH", "CIRCLE",
            "DOUBLE_SLIM", "SLIM_THICK", "THICK_SLIM", "SLIM_THICK_SLIM", "WAVE", "DOUBLE_WAVE",
            "THICK_3D", "THICK_3D_REVERSE", "SOLID_3D", "SOLID_3D_REVERSE"
        };

        private static readonly string[] cPats =
        {
            "horz", "vert", "backSlash", "slash", "cross", "crossDiagonal"
        };

        private static readonly string[] cHwpxPats =
        {
            "HORIZONTAL", "VERTICAL", "BACK_SLASH", "SLASH", "CROSS", "CROSS_DIAGONAL"
        };

        public static string NameOf(BorderType pType)
        {
            int i = (int)pType;
            return i >= 0 && i < cTypes.Length ? cTypes[i] : "none";
        }

        public static BorderType TypeOf(string pName)
        {
            int i = IndexOf(cTypes, pName);
            return i < 0 ? BorderType.None : (BorderType)i;
        }

        public static string MmOf(BorderThickness pThick)
        {
            int i = (int)pThick;
            return i >= 0 && i < cMm.Length ? cMm[i] : "0.12";
        }

        public static BorderThickness ThickOf(string pMm)
        {
            int i = IndexOf(cMm, pMm);
            return i < 0 ? BorderThickness.MM0_12 : (BorderThickness)i;
        }

        /// <summary>
        /// 밑줄·취소선 모양은 <c>BorderType2</c> 다 — <b>None 이 없어 번호가 하나씩 밀려 있다</b>
        /// (Solid 가 0). 그대로 <c>BorderType</c> 으로 읽으면 실선이 "없음" 으로 보인다.
        /// </summary>
        public static string NameOf(BorderType2 pType)
        {
            return NameOf((BorderType)((int)pType + 1));
        }

        public static BorderType2 Type2Of(string pName)
        {
            int i = (int)TypeOf(pName) - 1;
            return (BorderType2)(i < 0 ? 0 : i);
        }

        public static string NameOf(PatternType pPat)
        {
            int i = (int)pPat;
            return i >= 0 && i < cPats.Length ? cPats[i] : "none";
        }

        public static PatternType PatOf(string pName)
        {
            int i = IndexOf(cPats, pName);
            return i < 0 ? PatternType.None : (PatternType)i;
        }

        public static string HwpxTypeOf(string pName)
        {
            int i = IndexOf(cTypes, pName);
            return i < 0 ? "NONE" : cHwpxTypes[i];
        }

        public static string TypeFromHwpx(string pName)
        {
            int i = IndexOf(cHwpxTypes, pName);
            return i < 0 ? "none" : cTypes[i];
        }

        public static string HwpxPatOf(string pName)
        {
            int i = IndexOf(cPats, pName);
            return i < 0 ? "NONE" : cHwpxPats[i];
        }

        public static string PatFromHwpx(string pName)
        {
            int i = IndexOf(cHwpxPats, pName);
            return i < 0 ? "none" : cPats[i];
        }

        /// <summary>hwpx 는 굵기를 <c>"0.12 mm"</c> 로 적는다.</summary>
        public static string HwpxWidthOf(string pMm)
        {
            return Mm(pMm) + " mm";
        }

        public static string MmFromHwpx(string pWidth)
        {
            if (string.IsNullOrEmpty(pWidth)) return "0.12";
            return Mm(pWidth.Replace("mm", "").Trim());
        }

        /// <summary>목록에 없는 굵기는 <b>가장 가까운 단</b>으로 붙인다 — 못 쓰는 값으로 두면 저장이 조용히 어긋난다.</summary>
        private static string Mm(string pText)
        {
            int exact = IndexOf(cMm, pText);
            if (exact >= 0) return cMm[exact];

            double want;
            if (!double.TryParse(pText, NumberStyles.Float, CultureInfo.InvariantCulture, out want)) return "0.12";

            int best = 1;
            double gap = double.MaxValue;
            for (int i = 0; i < cMm.Length; i++)
            {
                double d = Math.Abs(double.Parse(cMm[i], CultureInfo.InvariantCulture) - want);
                if (d < gap) { gap = d; best = i; }
            }
            return cMm[best];
        }

        private static int IndexOf(string[] pList, string pName)
        {
            if (pName == null) return -1;
            for (int i = 0; i < pList.Length; i++)
                if (string.Equals(pList[i], pName, StringComparison.OrdinalIgnoreCase)) return i;
            return -1;
        }

        /// <summary>강조점 — hwp <c>EmphasisSort</c> 13종. 자리 번호가 곧 enum 값이다.</summary>
        private static readonly string[] cHwpxEmph =
        {
            "NONE", "DOT_ABOVE", "RING_ABOVE", "TILDE", "CARON", "SIDE", "COLON",
            "GRAVE_ACCENT", "ACUTE_ACCENT", "CIRCUMFLEX", "MACRON", "HOOK_ABOVE", "DOT_BELOW"
        };

        /// <summary>외곽선 — hwp <c>OutterLineSort</c> 7종.</summary>
        private static readonly string[] cHwpxOutline =
        {
            "NONE", "SOLID", "DOT", "THICK", "DASH", "DASH_DOT", "DASH_DOT_DOT"
        };

        /// <summary>그림자 — hwp <c>ShadowSort</c> 3종.</summary>
        private static readonly string[] cHwpxShadow = { "NONE", "DROP", "CONTINUOUS" };

        public static int EmphOf(string pHwpx) { return Max(IndexOf(cHwpxEmph, pHwpx)); }
        public static string HwpxEmph(int pValue) { return At(cHwpxEmph, pValue); }

        public static int OutlineOf(string pHwpx) { return Max(IndexOf(cHwpxOutline, pHwpx)); }
        public static string HwpxOutline(int pValue) { return At(cHwpxOutline, pValue); }

        public static int ShadowOf(string pHwpx) { return Max(IndexOf(cHwpxShadow, pHwpx)); }
        public static string HwpxShadow(int pValue) { return At(cHwpxShadow, pValue); }

        private static int Max(int pIndex) { return pIndex < 0 ? 0 : pIndex; }

        private static string At(string[] pList, int pValue)
        {
            return pValue >= 0 && pValue < pList.Length ? pList[pValue] : pList[0];
        }

        public static string Hex(Color4Byte pColor)
        {
            if (pColor == null) return "#000000";
            return "#" + pColor.R.ToString("X2", CultureInfo.InvariantCulture)
                       + pColor.G.ToString("X2", CultureInfo.InvariantCulture)
                       + pColor.B.ToString("X2", CultureInfo.InvariantCulture);
        }

        /// <summary>"채우기 없음". ★ 흰색으로 두면 안 된다 — 여는 쪽이 흰 바탕을 실제로 칠한다.</summary>
        public static void SetNone(Color4Byte pColor)
        {
            if (pColor != null) pColor.Value = cNoneColor;
        }

        public static void SetHex(Color4Byte pColor, string pHex)
        {
            if (pColor == null || string.IsNullOrEmpty(pHex) || pHex.Length != 7 || pHex[0] != '#') return;

            byte r, g, b;
            if (!Byte2(pHex, 1, out r) || !Byte2(pHex, 3, out g) || !Byte2(pHex, 5, out b)) return;
            pColor.R = r; pColor.G = g; pColor.B = b;
        }

        private static bool Byte2(string pText, int pAt, out byte pValue)
        {
            pValue = 0;
            int v;
            if (!int.TryParse(pText.Substring(pAt, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out v)) return false;
            pValue = (byte)v;
            return true;
        }

        public static BorderLineModel Read(EachBorder pBorder)
        {
            BorderLineModel m = new BorderLineModel();
            if (pBorder == null) return m;
            m.Type = NameOf(pBorder.Type);
            m.W = MmOf(pBorder.Thickness);
            m.Color = Hex(pBorder.Color);
            return m;
        }

        public static void Write(EachBorder pBorder, BorderLineModel pModel)
        {
            if (pBorder == null || pModel == null) return;
            pBorder.Type = TypeOf(pModel.Type);
            pBorder.Thickness = ThickOf(pModel.W);
            SetHex(pBorder.Color, pModel.Color);
        }
    }
}
