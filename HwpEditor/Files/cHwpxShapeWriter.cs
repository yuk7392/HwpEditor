using System;
using System.Collections.Generic;
using System.Globalization;
using System.Xml;
using HwpEditor.Models;

namespace HwpEditor.Files
{
    /// <summary>
    /// hwp 쪽 <see cref="cShapeWriter"/> 와 같은 약속이다 — <b>원본 요소를 복제해서</b> 만들고,
    /// <b>같은 모양이 이미 있으면 그것을 쓴다</b>.
    ///
    /// ★ 같은지 보는 기준은 <b>요소 전체(id 만 빼고)</b>다. 우리가 모델에 안 담은 속성까지 같아야
    ///   같은 모양이다 — 일부 필드만 보고 같다고 하면 그림자나 외곽선이 다른 모양으로 글이 옮겨 붙는다.
    /// ★ <c>hp:switch</c> 안에 <c>hp:case</c>·<c>hp:default</c> 두 벌이 들어 있는 문단모양이 있다.
    ///   여백·줄간격은 <b>모든 갈래</b>를 같이 고쳐야 한다 — 한쪽만 고치면 여는 쪽이 어느 갈래를
    ///   고르느냐에 따라 결과가 달라진다.
    /// </summary>
    public static class cHwpxShapeWriter
    {
        public static int[] RegisterCharShapes(XmlDocument pHeader, IList<CharShapeModel> pList, int[] pBfMap)
        {
            int have = BorderFillCount(pHeader);
            return Register(pHeader, "charProperties", "charPr", pList == null ? 0 : pList.Count, 0,
                delegate (XmlElement el, int i) { ApplyChar(el, pList[i], pBfMap, have); },
                delegate (int i) { return pList[i].Base; });
        }

        public static int[] RegisterParaShapes(XmlDocument pHeader, IList<ParaShapeModel> pList, int[] pBfMap)
        {
            int have = BorderFillCount(pHeader);
            return Register(pHeader, "paraProperties", "paraPr", pList == null ? 0 : pList.Count, 0,
                delegate (XmlElement el, int i) { ApplyPara(el, pList[i], pBfMap, have); },
                delegate (int i) { return pList[i].Base; });
        }

        private static int BorderFillCount(XmlDocument pHeader)
        {
            return ChildrenNamed(Find(pHeader, "borderFills"), "borderFill").Count;
        }

        /// <summary>
        /// ★ hwp 쪽 <c>cShapeWriter.MapBf</c> 와 같은 규칙 — 문서에 없는 번호는 안 쓰고 원본 값을 지킨다.
        /// </summary>
        private static string MapBf(XmlElement pEl, int[] pMap, int pValue, int pHave)
        {
            int to = cShapeWriter.Map(pMap, pValue);
            if (to >= 0 && to <= pHave) return Str(to);
            XmlAttribute had = pEl.Attributes["borderFillIDRef"];
            return had == null ? "1" : had.Value;
        }

        /// <summary>★ 테두리/배경만 <b>번호가 1부터</b>다 — 모델 목록의 0번 자리는 비어 있다.</summary>
        public static int[] RegisterBorderFills(XmlDocument pHeader, IList<BorderFillModel> pList)
        {
            return Register(pHeader, "borderFills", "borderFill", pList == null ? 0 : pList.Count, 1,
                delegate (XmlElement el, int i) { ApplyBorderFill(el, pList[i]); },
                delegate (int i) { return pList[i].Base; });
        }

        private delegate void cApply(XmlElement pElement, int pIndex);
        private delegate int cBaseOf(int pIndex);

        private static int[] Register(XmlDocument pHeader, string pGroupLocal, string pItemLocal,
                                      int pWanted, int pIdBase, cApply pApply, cBaseOf pBase)
        {
            XmlElement group = Find(pHeader, pGroupLocal);
            List<XmlElement> have = ChildrenNamed(group, pItemLocal);

            int baseCount = have.Count + pIdBase;
            int[] map = new int[Math.Max(pWanted, baseCount)];
            for (int i = 0; i < map.Length; i++) map[i] = i < baseCount ? i : pIdBase;
            if (group == null || pWanted <= baseCount) return map;

            for (int i = baseCount; i < pWanted; i++)
            {
                int from = pBase(i);
                if (from >= 0 && from < i && from < map.Length) from = map[from];
                if (from < pIdBase || from - pIdBase >= have.Count) from = pIdBase;

                XmlElement want = (XmlElement)have[from - pIdBase].CloneNode(true);
                pApply(want, i);

                int same = FindSame(have, want);
                if (same >= 0) { map[i] = same + pIdBase; continue; }

                int id = have.Count + pIdBase;
                want.SetAttribute("id", id.ToString(CultureInfo.InvariantCulture));
                group.AppendChild(want);
                have.Add(want);
                map[i] = id;

                group.SetAttribute("itemCnt", have.Count.ToString(CultureInfo.InvariantCulture));
            }
            return map;
        }

        private static int FindSame(List<XmlElement> pHave, XmlElement pWant)
        {
            string want = Normalized(pWant);
            for (int i = 0; i < pHave.Count; i++) if (Normalized(pHave[i]) == want) return i;
            return -1;
        }

        private static string Normalized(XmlElement pEl)
        {
            XmlElement copy = (XmlElement)pEl.CloneNode(true);
            copy.RemoveAttribute("id");
            return copy.OuterXml;
        }

        #region 글자모양

        private static void ApplyChar(XmlElement pEl, CharShapeModel pModel, int[] pBfMap, int pBfHave)
        {
            pEl.SetAttribute("height", Str(pModel.SizeHu));
            if (!string.IsNullOrEmpty(pModel.Color)) pEl.SetAttribute("textColor", pModel.Color);
            pEl.SetAttribute("shadeColor", pModel.Shade ?? "none");
            pEl.SetAttribute("symMark", cBorderMap.HwpxEmph(pModel.Emph));
            pEl.SetAttribute("borderFillIDRef", MapBf(pEl, pBfMap, pModel.Bf, pBfHave));

            SetForAll(Child(pEl, "fontRef"), pModel.Face);
            SetForAll(Child(pEl, "ratio"), pModel.Ratio);
            SetForAll(Child(pEl, "spacing"), pModel.Spacing);

            Toggle(pEl, "bold", pModel.Bold, cBeforeBold);
            Toggle(pEl, "italic", pModel.Italic, cBeforeBold);

            // ★ 요소가 없으면 <b>만들어서</b> 쓴다. 있을 때만 고치면, 원본에 밑줄 요소가 없는 글자모양에
            //   밑줄을 걸었을 때 아무 일도 안 일어난다 — 화면에는 밑줄이 그어지고 파일에만 안 들어간다.
            XmlElement ul = Need(pEl, "underline", cBeforeUnderline);
            ul.SetAttribute("type", pModel.Underline == 0 ? "NONE"
                                  : pModel.Underline == 2 ? "CENTER"
                                  : pModel.Underline == 3 ? "TOP" : "BOTTOM");
            ul.SetAttribute("shape", cBorderMap.HwpxTypeOf(pModel.UlShape));
            ul.SetAttribute("color", pModel.UlColor ?? "#000000");

            XmlElement st = Need(pEl, "strikeout", cBeforeStrikeout);
            st.SetAttribute("shape", pModel.Strike ? "SOLID" : "NONE");
            if (st.Attributes["color"] == null) st.SetAttribute("color", "#000000");

            XmlElement ol = Need(pEl, "outline", cBeforeOutline);
            ol.SetAttribute("type", cBorderMap.HwpxOutline(pModel.Outline));

            XmlElement sh = Need(pEl, "shadow", cBeforeShadow);
            sh.SetAttribute("type", cBorderMap.HwpxShadow(pModel.Shadow));
            if (sh.Attributes["color"] == null) sh.SetAttribute("color", "#B2B2B2");
            if (sh.Attributes["offsetX"] == null) sh.SetAttribute("offsetX", "10");
            if (sh.Attributes["offsetY"] == null) sh.SetAttribute("offsetY", "10");

            Toggle(pEl, "emboss", pModel.Emboss, cBeforeEmboss);
            Toggle(pEl, "engrave", pModel.Engrave, cBeforeEngrave);
            Toggle(pEl, "supscript", pModel.Sup, cBeforeSup);
            Toggle(pEl, "subscript", pModel.Sub, cNothingAfter);
        }

        /* 스키마 차례상 이 요소들보다 앞에 와야 한다. 먼저 찾히는 것 앞에 끼운다. */
        private static readonly string[] cBeforeUnderline = { "strikeout", "outline", "shadow", "emboss", "engrave" };
        private static readonly string[] cBeforeStrikeout = { "outline", "shadow", "emboss", "engrave" };
        private static readonly string[] cBeforeOutline = { "shadow", "emboss", "engrave", "supscript", "subscript" };
        private static readonly string[] cBeforeShadow = { "emboss", "engrave", "supscript", "subscript" };
        private static readonly string[] cBeforeBold = { "underline", "strikeout", "outline", "shadow" };
        private static readonly string[] cBeforeEmboss = { "engrave", "supscript", "subscript" };
        private static readonly string[] cBeforeEngrave = { "supscript", "subscript" };
        private static readonly string[] cBeforeSup = { "subscript" };
        private static readonly string[] cNothingAfter = { };

        private static XmlElement Need(XmlElement pParent, string pLocal, string[] pBefore)
        {
            XmlElement had = Child(pParent, pLocal);
            if (had != null) return had;

            XmlElement made = pParent.OwnerDocument.CreateElement(pParent.Prefix, pLocal, pParent.NamespaceURI);
            XmlElement before = null;
            for (int i = 0; i < pBefore.Length && before == null; i++) before = Child(pParent, pBefore[i]);

            if (before != null) pParent.InsertBefore(made, before);
            else pParent.AppendChild(made);
            return made;
        }

        /// <summary>7개 언어 속성을 한 값으로 맞춘다(한글만 따로 두지 않는다 — 모델이 하나뿐이다).</summary>
        private static void SetForAll(XmlElement pEl, int pValue)
        {
            if (pEl == null) return;
            string v = Str(pValue);
            string[] langs = { "hangul", "latin", "hanja", "japanese", "other", "symbol", "user" };
            for (int i = 0; i < langs.Length; i++) pEl.SetAttribute(langs[i], v);
        }

        /// <summary>
        /// 있으면 참, 없으면 거짓인 표시 요소(<c>hh:bold</c>·<c>hh:italic</c>).
        /// ★ 넣는 자리가 정해져 있다 — <c>offset</c> 뒤, <c>underline</c> 앞. 아무 데나 붙이면
        ///   여는 쪽이 스키마 차례를 어겼다고 볼 수 있다.
        /// </summary>
        private static void Toggle(XmlElement pParent, string pLocal, bool pOn, string[] pBefore)
        {
            XmlElement had = Child(pParent, pLocal);
            if (!pOn)
            {
                if (had != null) pParent.RemoveChild(had);
                return;
            }
            if (had != null) return;

            XmlElement made = pParent.OwnerDocument.CreateElement(pParent.Prefix, pLocal, pParent.NamespaceURI);
            XmlElement before = null;
            for (int i = 0; i < pBefore.Length && before == null; i++) before = Child(pParent, pBefore[i]);

            if (before != null) pParent.InsertBefore(made, before);
            else pParent.AppendChild(made);
        }

        #endregion

        #region 테두리/배경

        private static void ApplyBorderFill(XmlElement pEl, BorderFillModel pModel)
        {
            WriteBorder(Child(pEl, "leftBorder"), pModel.L);
            WriteBorder(Child(pEl, "rightBorder"), pModel.R);
            WriteBorder(Child(pEl, "topBorder"), pModel.T);
            WriteBorder(Child(pEl, "bottomBorder"), pModel.B);
            WriteBorder(Child(pEl, "diagonal"), pModel.D);

            XmlElement brush = Find(pEl, "winBrush");
            if (brush == null)
            {
                if (pModel.Fill == null && pModel.Pat == "none") return;
                brush = MakeBrush(pEl);
                if (brush == null) return;
            }

            brush.SetAttribute("faceColor", pModel.Fill ?? "none");
            brush.SetAttribute("hatchStyle", cBorderMap.HwpxPatOf(pModel.Pat));
            brush.SetAttribute("hatchColor", pModel.PatColor);
            if (brush.Attributes["alpha"] == null) brush.SetAttribute("alpha", "0");
        }

        private static void WriteBorder(XmlElement pEl, BorderLineModel pModel)
        {
            if (pEl == null || pModel == null) return;
            pEl.SetAttribute("type", cBorderMap.HwpxTypeOf(pModel.Type));
            pEl.SetAttribute("width", cBorderMap.HwpxWidthOf(pModel.W));
            pEl.SetAttribute("color", pModel.Color);
        }

        /// <summary>
        /// <c>hc:fillBrush/hc:winBrush</c> 를 만들어 붙인다. ★ 이름공간을 문서에서 가져온다 —
        /// 접두사만 맞춘 요소를 붙이면 여는 쪽이 아예 다른 요소로 본다.
        /// </summary>
        private static XmlElement MakeBrush(XmlElement pBorderFill)
        {
            XmlDocument doc = pBorderFill.OwnerDocument;
            string hc = doc.DocumentElement == null ? null : doc.DocumentElement.GetNamespaceOfPrefix("hc");
            if (string.IsNullOrEmpty(hc)) return null;

            XmlElement fillBrush = doc.CreateElement("hc", "fillBrush", hc);
            XmlElement winBrush = doc.CreateElement("hc", "winBrush", hc);
            fillBrush.AppendChild(winBrush);
            pBorderFill.AppendChild(fillBrush);
            return winBrush;
        }

        /// <summary>
        /// 새 표가 쓸 테두리. hwp 쪽 <c>cHwpWriter.TableBorderFill</c> 과 <b>같은 규칙</b>이다 —
        /// 문서에 있는 "네 변 실선" 을 다시 쓰고, 없을 때만 만든다.
        /// ★ 예전에는 <c>"1"</c> 고정이었다. 그 문서의 1번이 테두리가 아니면 표가 선 없이 보인다.
        /// </summary>
        public static int TableBorderFill(XmlDocument pHeader)
        {
            XmlElement group = Find(pHeader, "borderFills");
            List<XmlElement> have = ChildrenNamed(group, "borderFill");

            for (int i = 0; i < have.Count; i++)
                if (AllSolid(have[i])) return i + 1;

            if (group == null || have.Count == 0) return 1;

            XmlElement made = (XmlElement)have[0].CloneNode(true);
            string[] sides = { "leftBorder", "rightBorder", "topBorder", "bottomBorder" };
            for (int i = 0; i < sides.Length; i++)
            {
                XmlElement side = Child(made, sides[i]);
                if (side == null) continue;
                side.SetAttribute("type", "SOLID");
                side.SetAttribute("width", "0.12 mm");
                side.SetAttribute("color", "#000000");
            }

            int id = have.Count + 1;
            made.SetAttribute("id", id.ToString(CultureInfo.InvariantCulture));
            group.AppendChild(made);
            group.SetAttribute("itemCnt", id.ToString(CultureInfo.InvariantCulture));
            return id;
        }

        private static bool AllSolid(XmlElement pEl)
        {
            string[] sides = { "leftBorder", "rightBorder", "topBorder", "bottomBorder" };
            for (int i = 0; i < sides.Length; i++)
            {
                XmlElement side = Child(pEl, sides[i]);
                if (side == null || side.GetAttribute("type") != "SOLID") return false;
            }
            return true;
        }

        #endregion

        #region 문단모양

        private static void ApplyPara(XmlElement pEl, ParaShapeModel pModel, int[] pBfMap, int pBfHave)
        {
            foreach (XmlElement bd in AllNamed(pEl, "border"))
            {
                bd.SetAttribute("borderFillIDRef", MapBf(bd, pBfMap, pModel.Bf, pBfHave));
                bd.SetAttribute("offsetLeft", Str(pModel.BsL));
                bd.SetAttribute("offsetRight", Str(pModel.BsR));
                bd.SetAttribute("offsetTop", Str(pModel.BsT));
                bd.SetAttribute("offsetBottom", Str(pModel.BsB));
            }

            foreach (XmlElement al in AllNamed(pEl, "align"))
                al.SetAttribute("horizontal", AlignName(pModel.Align));

            foreach (XmlElement bs in AllNamed(pEl, "breakSetting"))
            {
                bs.SetAttribute("breakLatinWord", pModel.LatinBreak == "letter" ? "BREAK_WORD"
                                                : pModel.LatinBreak == "hyphen" ? "HYPHENATION" : "KEEP_WORD");
                bs.SetAttribute("breakNonLatinWord", pModel.HangulByWord ? "KEEP_WORD" : "BREAK_WORD");
            }

            // ★ hp:switch 갈래마다 한 벌씩 있다 — 전부 고친다.
            foreach (XmlElement mg in AllNamed(pEl, "margin"))
            {
                Value(mg, "intent", pModel.IndentHu);
                Value(mg, "left", pModel.MlHu);
                Value(mg, "right", pModel.MrHu);
                Value(mg, "prev", pModel.MtHu);
                Value(mg, "next", pModel.MbHu);
            }

            foreach (XmlElement ls in AllNamed(pEl, "lineSpacing"))
            {
                ls.SetAttribute("type", LineSpaceName(pModel.LsType));
                ls.SetAttribute("value", Str(pModel.Ls));
            }
        }

        private static void Value(XmlElement pParent, string pLocal, int pValue)
        {
            XmlElement e = Find(pParent, pLocal);
            if (e != null) e.SetAttribute("value", Str(pValue));
        }

        private static string AlignName(string pAlign)
        {
            switch (pAlign)
            {
                case "left": return "LEFT";
                case "right": return "RIGHT";
                case "center": return "CENTER";
                case "distribute": return "DISTRIBUTE";
                case "divide": return "DIVISION";
                default: return "JUSTIFY";
            }
        }

        private static string LineSpaceName(string pType)
        {
            switch (pType)
            {
                case "fixed": return "FIXED";
                case "margin": return "BETWEEN_LINES";
                case "atLeast": return "AT_LEAST";
                default: return "PERCENT";
            }
        }

        #endregion

        #region xml 유틸 — 이름공간 접두사를 안 믿고 LocalName 만 본다

        private static XmlElement Child(XmlNode pNode, string pLocal)
        {
            if (pNode == null) return null;
            foreach (XmlNode n in pNode.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e != null && e.LocalName == pLocal) return e;
            }
            return null;
        }

        private static List<XmlElement> ChildrenNamed(XmlNode pNode, string pLocal)
        {
            List<XmlElement> outList = new List<XmlElement>();
            if (pNode == null) return outList;
            foreach (XmlNode n in pNode.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e != null && e.LocalName == pLocal) outList.Add(e);
            }
            return outList;
        }

        private static XmlElement Find(XmlNode pNode, string pLocal)
        {
            if (pNode == null) return null;
            foreach (XmlNode n in pNode.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e == null) continue;
                if (e.LocalName == pLocal) return e;
                XmlElement deep = Find(e, pLocal);
                if (deep != null) return deep;
            }
            return null;
        }

        private static List<XmlElement> AllNamed(XmlNode pNode, string pLocal)
        {
            List<XmlElement> outList = new List<XmlElement>();
            Collect(pNode, pLocal, outList);
            return outList;
        }

        private static void Collect(XmlNode pNode, string pLocal, List<XmlElement> pOut)
        {
            foreach (XmlNode n in pNode.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e == null) continue;
                if (e.LocalName == pLocal) pOut.Add(e);
                Collect(e, pLocal, pOut);
            }
        }

        private static string Str(int pValue)
        {
            return pValue.ToString(CultureInfo.InvariantCulture);
        }

        #endregion
    }
}
