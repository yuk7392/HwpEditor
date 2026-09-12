using System;
using System.Collections.Generic;
using System.Globalization;
using HwpEditor.Models;
using HwpLib.Object;
using HwpLib.Object.DocInfo;
using HwpLib.Object.DocInfo.BorderFill;
using HwpLib.Object.DocInfo.BorderFill.FillInfo;
using HwpLib.Object.DocInfo.CharShape;
using HwpLib.Object.DocInfo.Numbering;
using HwpLib.Object.DocInfo.ParaShape;
using HwpLib.Object.DocInfo.Style;

namespace HwpEditor.Files
{
    /// <summary>
    /// ★ <b>같은 모양이 이미 있으면 그것을 쓴다</b>. 안 그러면 굵게를 열 번 눌렀다 저장할 때마다
    ///   모양 목록이 열 개씩 늘고, 그 문서는 다시 열 때마다 조금씩 무거워진다.
    /// ★ 새 모양은 <b>갈라져 나온 원본을 복제해서</b> 만든다. 빈 것에서 채우면 우리가 모델에 안 담은
    ///   필드(그림자·외곽선·밑줄색·탭 정의·문단 머리)가 전부 기본값으로 바뀌어, 고친 적 없는 성질이
    ///   조용히 달라진다.
    /// </summary>
    public static class cShapeWriter
    {
        /// <summary>
        /// 화면 목록을 문서에 맞추고 <b>화면 번호 → 문서 번호</b> 표를 준다.
        /// 원본 범위(0 … 기존 개수-1)는 그대로다.
        /// </summary>
        public static int[] RegisterCharShapes(HWPFile pFile, IList<CharShapeModel> pList, int[] pBfMap)
        {
            IReadOnlyList<CharShapeInfo> have = pFile.DocInfo.CharShapeList;
            int baseCount = have.Count;
            if (pList == null || pList.Count <= baseCount) return Identity(baseCount);

            int[] map = new int[pList.Count];
            for (int i = 0; i < baseCount && i < map.Length; i++) map[i] = i;

            for (int i = baseCount; i < pList.Count; i++)
            {
                CharShapeModel m = pList[i];

                // 갈라져 나온 원본. 그것도 화면이 만든 것이면 이미 매겨진 문서 번호로 따라간다.
                int from = m.Base;
                if (from >= 0 && from < map.Length && from < i) from = map[from];
                if (from < 0 || from >= have.Count) from = 0;

                CharShapeInfo want = have.Count > 0 ? have[from].Clone() : new CharShapeInfo();
                ApplyChar(want, m, pBfMap, pFile.DocInfo.BorderFillList.Count);

                int same = FindChar(have, want);
                if (same >= 0) { map[i] = same; continue; }

                CharShapeInfo added = pFile.DocInfo.AddNewCharShape();
                CopyChar(want, added);
                map[i] = have.Count - 1;
            }
            return map;
        }

        /// <summary>
        /// 테두리/배경 표. ★ 번호가 <b>1부터</b>라 표의 0번 자리는 쓰지 않는다(실측 table.hwp —
        /// 목록이 2개인데 표가 2번을 가리킨다). <see cref="TableBorderFill"/> 을 여기로 올린 것이다.
        /// </summary>
        public static int[] RegisterBorderFills(HWPFile pFile, IList<BorderFillModel> pList)
        {
            IReadOnlyList<BorderFillInfo> have = pFile.DocInfo.BorderFillList;
            int baseCount = have.Count + 1;
            if (pList == null || pList.Count <= baseCount) return Identity(baseCount);

            int[] map = new int[pList.Count];
            for (int i = 0; i < baseCount && i < map.Length; i++) map[i] = i;

            for (int i = baseCount; i < pList.Count; i++)
            {
                BorderFillModel m = pList[i];

                int from = m.Base;
                if (from >= 0 && from < map.Length && from < i) from = map[from];
                if (from < 1 || from > have.Count) from = 1;

                BorderFillInfo want = have.Count > 0 ? have[from - 1].Clone() : new BorderFillInfo();
                ApplyBorderFill(want, m);

                int same = FindBorderFill(have, want);
                if (same >= 0) { map[i] = same + 1; continue; }

                BorderFillInfo added = pFile.DocInfo.AddNewBorderFill();
                CopyBorderFill(want, added);
                map[i] = have.Count;
            }
            return map;
        }

        private static void ApplyBorderFill(BorderFillInfo pTo, BorderFillModel pFrom)
        {
            cBorderMap.Write(pTo.LeftBorder, pFrom.L);
            cBorderMap.Write(pTo.RightBorder, pFrom.R);
            cBorderMap.Write(pTo.TopBorder, pFrom.T);
            cBorderMap.Write(pTo.BottomBorder, pFrom.B);
            cBorderMap.Write(pTo.DiagonalBorder, pFrom.D);

            // ★ 면 색·무늬는 <b>PatternFill 하나</b>에 들어 있고, 그것을 쓰려면 채우기 종류 비트도 켜야 한다.
            //   비트만 켜고 실물을 안 만들면 되쓰기가 널을 만진다.
            FillInfo fill = pTo.FillInfo;
            if (fill == null) return;

            if (pFrom.Fill == null && pFrom.Pat == "none")
            {
                // 그러데이션·그림 채우기는 원본에서 복제해 온 것이므로 건드리지 않는다.
                if (fill.PatternFill != null) cBorderMap.SetNone(fill.PatternFill.BackColor);
                return;
            }

            if (fill.PatternFill == null) fill.CreatePatternFill();
            if (fill.PatternFill == null) return;
            fill.Type.HasPatternFill = true;

            if (pFrom.Fill == null) cBorderMap.SetNone(fill.PatternFill.BackColor);
            else cBorderMap.SetHex(fill.PatternFill.BackColor, pFrom.Fill);

            fill.PatternFill.PatternType = cBorderMap.PatOf(pFrom.Pat);
            cBorderMap.SetHex(fill.PatternFill.PatternColor, pFrom.PatColor);
        }

        private static int FindBorderFill(IReadOnlyList<BorderFillInfo> pList, BorderFillInfo pWant)
        {
            for (int i = 0; i < pList.Count; i++) if (SameBorderFill(pList[i], pWant)) return i;
            return -1;
        }

        private static bool SameBorderFill(BorderFillInfo a, BorderFillInfo b)
        {
            return a.Property.Value == b.Property.Value
                && SameBorder(a.LeftBorder, b.LeftBorder)
                && SameBorder(a.RightBorder, b.RightBorder)
                && SameBorder(a.TopBorder, b.TopBorder)
                && SameBorder(a.BottomBorder, b.BottomBorder)
                && SameBorder(a.DiagonalBorder, b.DiagonalBorder)
                && SameFill(a.FillInfo, b.FillInfo);
        }

        private static bool SameBorder(EachBorder a, EachBorder b)
        {
            if (a == null || b == null) return a == b;
            return a.Type == b.Type && a.Thickness == b.Thickness && a.Color.Value == b.Color.Value;
        }

        private static bool SameFill(FillInfo a, FillInfo b)
        {
            if (a == null || b == null) return a == b;
            if (a.Type.Value != b.Type.Value) return false;

            PatternFill pa = a.PatternFill, pb = b.PatternFill;
            if (pa == null || pb == null) return pa == pb;
            return pa.BackColor.Value == pb.BackColor.Value
                && pa.PatternColor.Value == pb.PatternColor.Value
                && pa.PatternType == pb.PatternType;
        }

        /// <summary><c>AddNewBorderFill()</c> 은 빈 것을 붙여 주기만 한다 — 내용은 여기서 옮긴다.</summary>
        private static void CopyBorderFill(BorderFillInfo pFrom, BorderFillInfo pTo)
        {
            pTo.Property.Copy(pFrom.Property);
            pTo.LeftBorder.Copy(pFrom.LeftBorder);
            pTo.RightBorder.Copy(pFrom.RightBorder);
            pTo.TopBorder.Copy(pFrom.TopBorder);
            pTo.BottomBorder.Copy(pFrom.BottomBorder);
            pTo.DiagonalBorder.Copy(pFrom.DiagonalBorder);
            if (pFrom.FillInfo != null && pTo.FillInfo != null) pTo.FillInfo.Copy(pFrom.FillInfo);
        }

        /// <summary>
        /// 글머리표 표. ★ 테두리와 같이 <b>번호가 1부터</b>다. 표본 대부분이 글머리표를 하나도 안 갖기
        /// 때문에(hwp <c>bul=0</c>) "글머리 기호 켜기" 는 거의 언제나 이 길로 새로 만든다.
        /// </summary>
        public static int[] RegisterBullets(HWPFile pFile, IList<BulletModel> pList)
        {
            IReadOnlyList<Bullet> have = pFile.DocInfo.BulletList;
            int baseCount = have.Count + 1;
            if (pList == null || pList.Count <= baseCount) return Identity(baseCount);

            int[] map = new int[pList.Count];
            for (int i = 0; i < baseCount && i < map.Length; i++) map[i] = i;

            for (int i = baseCount; i < pList.Count; i++)
            {
                BulletModel m = pList[i];
                string ch = m.Ch ?? "";

                int same = FindBullet(have, ch);
                if (same >= 0) { map[i] = same + 1; continue; }

                // ★ 있는 것을 본떠서 만든다 — 빈 것에서 채우면 우리가 모델에 안 담은 성질
                //   (이미지 글머리표·체크 글자·글자모양 번호)이 전부 기본값이 된다.
                Bullet from = have.Count > 0 ? have[0] : null;
                Bullet added = pFile.DocInfo.AddNewBullet();
                if (from != null) added.ParagraphHeadInfo.Copy(from.ParagraphHeadInfo);
                added.BulletChar.FromUTF16LEString(ch);
                ApplyHead(added.ParagraphHeadInfo, m.Head);
                map[i] = have.Count;
            }
            return map;
        }

        /// <summary>
        /// 문단 번호 표. 화면은 수준 정의를 <b>안 고친다</b> — 있는 것을 가리키기만 하므로
        /// 여기서 새로 만드는 일은 없다(있어도 원본 첫 정의의 복제다).
        /// </summary>
        public static int[] RegisterNumberings(HWPFile pFile, IList<NumberingModel> pList)
        {
            int baseCount = pFile.DocInfo.NumberingList.Count + 1;
            if (pList == null || pList.Count <= baseCount) return Identity(baseCount);

            int[] map = new int[pList.Count];
            for (int i = 0; i < map.Length; i++) map[i] = i < baseCount ? i : 1;
            return map;
        }

        /// <summary>
        /// 스타일 표. ★ 반드시 <see cref="RegisterParaShapes"/>·<see cref="RegisterCharShapes"/> <b>뒤</b>다 —
        /// 스타일이 문단모양·글자모양 번호를 가리키므로 앞에 두면 옛 번호가 박힌다.
        /// ★ 있던 번호는 <b>덮어쓴다</b> — 그것이 "스타일 고치기" 이고, 그 스타일을 쓰는 문단이 같이 바뀐다.
        /// </summary>
        public static int[] RegisterStyles(HWPFile pFile, IList<StyleModel> pList, int[] pPsMap, int[] pCsMap)
        {
            int have = pFile.DocInfo.StyleList.Count;
            if (pList == null || pList.Count == 0) return Identity(have);

            int[] map = new int[pList.Count];
            for (int i = 0; i < pList.Count; i++)
            {
                StyleModel m = pList[i];
                StyleInfo to = i < pFile.DocInfo.StyleList.Count
                             ? pFile.DocInfo.StyleList[i] : pFile.DocInfo.AddNewStyle();
                if (to == null) { map[i] = i < have ? i : 0; continue; }

                if (!string.IsNullOrEmpty(m.Name)) to.HangulName = m.Name;
                if (i >= have)
                {
                    // 새 스타일은 영문 이름·다음 스타일·언어를 채워 둔다 — 비우면 한글 목록에 빈 줄로 뜬다.
                    to.EnglishName = m.Name;
                    to.NextStyleId = (short)i;
                    to.LanguageId = 1042;
                }
                if (to.Property != null)
                    to.Property.StyleSort = m.Sort == "char" ? StyleSort.CharStyle : StyleSort.ParaStyle;

                to.ParaShapeId = Map(pPsMap, m.Ps);
                to.CharShapeId = Map(pCsMap, m.Cs);
                map[i] = i;
            }
            return map;
        }

        private static int FindBullet(IReadOnlyList<Bullet> pList, string pChar)
        {
            for (int i = 0; i < pList.Count; i++)
            {
                string had = pList[i].BulletChar != null ? pList[i].BulletChar.ToUTF16LEString() : "";
                if (had == pChar) return i;
            }
            return -1;
        }

        private static void ApplyHead(ParagraphHeadInfo pTo, ParaHeadModel pFrom)
        {
            if (pTo == null || pFrom == null) return;
            pTo.DistanceFromBody = pFrom.Dist;
            if (pTo.Property == null) return;
            pTo.Property.ValueTypeForDistanceFromBody =
                pFrom.DistPct ? HwpLib.Object.DocInfo.Numbering.ValueType.RatioForLetter
                              : HwpLib.Object.DocInfo.Numbering.ValueType.Value;
            pTo.Property.ParagraphNumberFormat = cHeadMap.NumFmtOf(pFrom.NumFmt);
        }

        public static int[] RegisterParaShapes(HWPFile pFile, IList<ParaShapeModel> pList, int[] pBfMap,
                                               int[] pNumMap, int[] pBulMap)
        {
            IReadOnlyList<ParaShapeInfo> have = pFile.DocInfo.ParaShapeList;
            int baseCount = have.Count;
            if (pList == null || pList.Count <= baseCount) return Identity(baseCount);

            int[] map = new int[pList.Count];
            for (int i = 0; i < baseCount && i < map.Length; i++) map[i] = i;

            for (int i = baseCount; i < pList.Count; i++)
            {
                ParaShapeModel m = pList[i];

                int from = m.Base;
                if (from >= 0 && from < map.Length && from < i) from = map[from];
                if (from < 0 || from >= have.Count) from = 0;

                ParaShapeInfo want = have.Count > 0 ? have[from].Clone() : new ParaShapeInfo();
                ApplyPara(want, m, pBfMap, pFile.DocInfo.BorderFillList.Count, pNumMap, pBulMap);

                int same = FindPara(have, want);
                if (same >= 0) { map[i] = same; continue; }

                ParaShapeInfo added = pFile.DocInfo.AddNewParaShape();
                CopyPara(want, added);
                map[i] = have.Count - 1;
            }
            return map;
        }

        private static int[] Identity(int pCount)
        {
            int[] map = new int[pCount];
            for (int i = 0; i < pCount; i++) map[i] = i;
            return map;
        }

        /// <summary>
        /// 테두리/배경 번호를 옮기되 <b>문서에 없는 번호는 안 쓴다</b>. 화면이 테두리 표를 안 보냈는데
        /// (검사 통로가 빠뜨리면 그렇다) 문단·글자가 새 번호를 가리키면, 그대로 쓰면 문서에 없는
        /// 번호가 파일에 들어가 여는 쪽에서 테두리가 통째로 어긋난다 — 그때는 <b>원본 값을 지킨다</b>.
        /// </summary>
        private static int MapBf(int[] pMap, int pValue, int pHave, int pKeep)
        {
            int to = Map(pMap, pValue);
            return (to >= 0 && to <= pHave) ? to : pKeep;
        }

        /// <summary>표를 지나 번호를 옮긴다. 표 밖이면 그대로 둔다 — 못 옮기는 번호로 바꾸는 것이 더 나쁘다.</summary>
        public static int Map(int[] pMap, int pValue)
        {
            if (pMap == null || pValue < 0 || pValue >= pMap.Length) return pValue;
            return pMap[pValue];
        }

        private static bool SameInts(int[] a, int[] b)
        {
            if (a == null || b == null) return a == b;
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        private static bool SameShorts(short[] a, short[] b)
        {
            if (a == null || b == null) return a == b;
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        private static bool SameSBytes(sbyte[] a, sbyte[] b)
        {
            if (a == null || b == null) return a == b;
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        #region 글자모양

        private static void ApplyChar(CharShapeInfo pTo, CharShapeModel pFrom, int[] pBfMap, int pBfHave)
        {
            pTo.FaceNameIds.SetForAll(pFrom.Face);
            pTo.BaseSize = pFrom.SizeHu;
            pTo.Property.IsBold = pFrom.Bold;
            pTo.Property.IsItalic = pFrom.Italic;
            pTo.Property.UnderLineSort = ToUnderLine(pFrom.Underline);
            pTo.Property.IsStrikeLine = pFrom.Strike;
            pTo.Ratios.SetForAll((short)pFrom.Ratio);
            pTo.CharSpaces.SetForAll((sbyte)pFrom.Spacing);
            SetColor(pTo.CharColor, pFrom.Color);

            pTo.Property.IsSuperScript = pFrom.Sup;
            pTo.Property.IsSubScript = pFrom.Sub;
            if (pFrom.Shade == null) cBorderMap.SetNone(pTo.ShadeColor);
            else SetColor(pTo.ShadeColor, pFrom.Shade);
            pTo.Property.UnderLineShape = cBorderMap.Type2Of(pFrom.UlShape);
            SetColor(pTo.UnderLineColor, pFrom.UlColor);
            pTo.Property.EmphasisSort = (EmphasisSort)pFrom.Emph;
            pTo.Property.OutterLineSort = (OutterLineSort)pFrom.Outline;
            pTo.Property.ShadowSort = (ShadowSort)pFrom.Shadow;
            pTo.Property.IsEmboss = pFrom.Emboss;
            pTo.Property.IsEngrave = pFrom.Engrave;
            pTo.BorderFillId = MapBf(pBfMap, pFrom.Bf, pBfHave, pTo.BorderFillId);
        }

        private static UnderLineSort ToUnderLine(int pValue)
        {
            switch (pValue)
            {
                case 1: return UnderLineSort.Bottom;
                case 2: return UnderLineSort.Middle;
                case 3: return UnderLineSort.Top;
                default: return UnderLineSort.None;
            }
        }

        /// <summary>"#RRGGBB". 못 읽으면 손대지 않는다 — 검정으로 밀어 버리면 색이 조용히 사라진다.</summary>
        private static void SetColor(HwpLib.Object.Etc.Color4Byte pColor, string pHex)
        {
            if (pColor == null || string.IsNullOrEmpty(pHex) || pHex.Length != 7 || pHex[0] != '#') return;

            byte r, g, b;
            if (!Hex(pHex, 1, out r) || !Hex(pHex, 3, out g) || !Hex(pHex, 5, out b)) return;
            pColor.R = r; pColor.G = g; pColor.B = b;
        }

        private static bool Hex(string pText, int pAt, out byte pValue)
        {
            pValue = 0;
            int v;
            if (!int.TryParse(pText.Substring(pAt, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out v)) return false;
            pValue = (byte)v;
            return true;
        }

        private static int FindChar(IReadOnlyList<CharShapeInfo> pList, CharShapeInfo pWant)
        {
            for (int i = 0; i < pList.Count; i++) if (SameChar(pList[i], pWant)) return i;
            return -1;
        }

        private static bool SameChar(CharShapeInfo a, CharShapeInfo b)
        {
            return SameInts(a.FaceNameIds.Array, b.FaceNameIds.Array)
                && SameShorts(a.Ratios.Array, b.Ratios.Array)
                && SameSBytes(a.CharSpaces.Array, b.CharSpaces.Array)
                && SameShorts(a.RelativeSizes.Array, b.RelativeSizes.Array)
                && SameSBytes(a.CharOffsets.Array, b.CharOffsets.Array)
                && a.BaseSize == b.BaseSize
                && a.Property.Value == b.Property.Value
                && a.ShadowGap1 == b.ShadowGap1
                && a.ShadowGap2 == b.ShadowGap2
                && a.BorderFillId == b.BorderFillId
                && a.CharColor.Value == b.CharColor.Value
                && a.UnderLineColor.Value == b.UnderLineColor.Value
                && a.ShadeColor.Value == b.ShadeColor.Value
                && a.ShadowColor.Value == b.ShadowColor.Value
                && a.StrikeLineColor.Value == b.StrikeLineColor.Value;
        }

        /// <summary>
        /// <c>AddNewCharShape()</c> 는 빈 것을 붙여 주기만 한다 — 내용은 여기서 옮긴다.
        /// ★ 필드를 하나 빠뜨리면 그 성질만 기본값이 되고, 화면에는 안 보인다.
        /// </summary>
        private static void CopyChar(CharShapeInfo pFrom, CharShapeInfo pTo)
        {
            pTo.FaceNameIds.Copy(pFrom.FaceNameIds);
            pTo.Ratios.Copy(pFrom.Ratios);
            pTo.CharSpaces.Copy(pFrom.CharSpaces);
            pTo.RelativeSizes.Copy(pFrom.RelativeSizes);
            pTo.CharOffsets.Copy(pFrom.CharOffsets);
            pTo.BaseSize = pFrom.BaseSize;
            pTo.Property.Copy(pFrom.Property);
            pTo.ShadowGap1 = pFrom.ShadowGap1;
            pTo.ShadowGap2 = pFrom.ShadowGap2;
            pTo.CharColor.Copy(pFrom.CharColor);
            pTo.UnderLineColor.Copy(pFrom.UnderLineColor);
            pTo.ShadeColor.Copy(pFrom.ShadeColor);
            pTo.ShadowColor.Copy(pFrom.ShadowColor);
            pTo.BorderFillId = pFrom.BorderFillId;
            pTo.StrikeLineColor.Copy(pFrom.StrikeLineColor);
        }

        #endregion

        #region 문단모양

        /// <summary>
        /// ★ 여백·들여쓰기·줄간격은 파일에 <b>lineseg 좌표의 2배</b>로 들어 있다.
        ///   읽을 때 반으로 줄였으니 쓸 때 두 배로 되돌린다. 안 그러면 저장할 때마다 여백이 반씩 준다.
        /// </summary>
        private static void ApplyPara(ParaShapeInfo pTo, ParaShapeModel pFrom, int[] pBfMap, int pBfHave,
                                      int[] pNumMap, int[] pBulMap)
        {
            // ★ 머리 번호는 <b>글머리표냐 번호냐에 따라 다른 표</b>를 가리킨다. 표를 바꿔 매기면
            //   글머리표를 켠 문단이 번호 정의를 가리켜 엉뚱한 머리가 붙는다.
            //   개요는 번호가 0 이다(실측) — 그대로 둔다.
            pTo.Property1.ParaHeadShape = cHeadMap.HeadOf(pFrom.Head);
            pTo.Property1.ParaLevel = (byte)Math.Max(0, Math.Min(6, pFrom.Lvl));
            pTo.ParaHeadId = pFrom.Head == "bullet" ? Map(pBulMap, pFrom.HeadId)
                           : pFrom.Head == "number" ? Map(pNumMap, pFrom.HeadId)
                           : pFrom.HeadId;

            pTo.BorderFillId = MapBf(pBfMap, pFrom.Bf, pBfHave, pTo.BorderFillId);
            pTo.LeftBorderSpace = (short)pFrom.BsL;
            pTo.RightBorderSpace = (short)pFrom.BsR;
            pTo.TopBorderSpace = (short)pFrom.BsT;
            pTo.BottomBorderSpace = (short)pFrom.BsB;

            pTo.Property1.Alignment = ToAlign(pFrom.Align);
            pTo.Indent = pFrom.IndentHu * 2;
            pTo.LeftMargin = pFrom.MlHu * 2;
            pTo.RightMargin = pFrom.MrHu * 2;
            pTo.TopParaSpace = pFrom.MtHu * 2;
            pTo.BottomParaSpace = pFrom.MbHu * 2;
            pTo.Property1.LineSpaceSort = ToLineSpace(pFrom.LsType);
            pTo.LineSpace = pFrom.LsType == "percent" ? pFrom.Ls : pFrom.Ls * 2;
            pTo.Property1.LineDivideForEnglish = ToLatinBreak(pFrom.LatinBreak);
            pTo.Property1.LineDivideForHangul = pFrom.HangulByWord ? LineDivideForHangul.ByWord : LineDivideForHangul.ByLetter;
        }

        private static Alignment ToAlign(string pName)
        {
            switch (pName)
            {
                case "left": return Alignment.Left;
                case "right": return Alignment.Right;
                case "center": return Alignment.Center;
                case "distribute": return Alignment.Distribute;
                case "divide": return Alignment.Divide;
                default: return Alignment.Justify;
            }
        }

        private static LineSpaceSort ToLineSpace(string pName)
        {
            switch (pName)
            {
                case "fixed": return LineSpaceSort.FixedValue;
                case "margin": return LineSpaceSort.OnlyMargin;
                case "atLeast": return LineSpaceSort.AtLeast;
                default: return LineSpaceSort.RatioForLetter;
            }
        }

        private static LineDivideForEnglish ToLatinBreak(string pName)
        {
            switch (pName)
            {
                case "hyphen": return LineDivideForEnglish.ByHyphen;
                case "letter": return LineDivideForEnglish.ByLetter;
                default: return LineDivideForEnglish.ByWord;
            }
        }

        private static int FindPara(IReadOnlyList<ParaShapeInfo> pList, ParaShapeInfo pWant)
        {
            for (int i = 0; i < pList.Count; i++) if (SamePara(pList[i], pWant)) return i;
            return -1;
        }

        private static bool SamePara(ParaShapeInfo a, ParaShapeInfo b)
        {
            return a.Property1.Value == b.Property1.Value
                && a.Property2.Value == b.Property2.Value
                && a.Property3.Value == b.Property3.Value
                && a.LeftMargin == b.LeftMargin && a.RightMargin == b.RightMargin
                && a.Indent == b.Indent
                && a.TopParaSpace == b.TopParaSpace && a.BottomParaSpace == b.BottomParaSpace
                && a.LineSpace == b.LineSpace && a.LineSpace2 == b.LineSpace2
                && a.TabDefId == b.TabDefId && a.ParaHeadId == b.ParaHeadId
                && a.BorderFillId == b.BorderFillId
                && a.LeftBorderSpace == b.LeftBorderSpace && a.RightBorderSpace == b.RightBorderSpace
                && a.TopBorderSpace == b.TopBorderSpace && a.BottomBorderSpace == b.BottomBorderSpace
                && a.ParaLevel == b.ParaLevel;
        }

        private static void CopyPara(ParaShapeInfo pFrom, ParaShapeInfo pTo)
        {
            pTo.Property1.Copy(pFrom.Property1);
            pTo.Property2.Copy(pFrom.Property2);
            pTo.Property3.Copy(pFrom.Property3);
            pTo.LeftMargin = pFrom.LeftMargin;
            pTo.RightMargin = pFrom.RightMargin;
            pTo.Indent = pFrom.Indent;
            pTo.TopParaSpace = pFrom.TopParaSpace;
            pTo.BottomParaSpace = pFrom.BottomParaSpace;
            pTo.LineSpace = pFrom.LineSpace;
            pTo.LineSpace2 = pFrom.LineSpace2;
            pTo.TabDefId = pFrom.TabDefId;
            pTo.ParaHeadId = pFrom.ParaHeadId;
            pTo.BorderFillId = pFrom.BorderFillId;
            pTo.LeftBorderSpace = pFrom.LeftBorderSpace;
            pTo.RightBorderSpace = pFrom.RightBorderSpace;
            pTo.TopBorderSpace = pFrom.TopBorderSpace;
            pTo.BottomBorderSpace = pFrom.BottomBorderSpace;
            pTo.ParaLevel = pFrom.ParaLevel;
        }

        #endregion
    }
}
