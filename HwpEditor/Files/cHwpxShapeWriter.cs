using System;
using System.Collections.Generic;
using System.Globalization;
using System.Xml;
using HwpEditor.Models;

namespace HwpEditor.Files
{
    /// <summary>
    /// 화면이 새로 만든 글자모양·문단모양을 .hwpx 의 <c>header.xml</c> 에 등록한다(4단계).
    /// hwp 쪽 <see cref="cShapeWriter"/> 와 같은 약속이다 — <b>원본 요소를 복제해서</b> 만들고,
    /// <b>같은 모양이 이미 있으면 그것을 쓴다</b>(G-10).
    ///
    /// ★ 같은지 보는 기준은 <b>요소 전체(id 만 빼고)</b>다. 우리가 모델에 안 담은 속성까지 같아야
    ///   같은 모양이다 — 일부 필드만 보고 같다고 하면 그림자나 외곽선이 다른 모양으로 글이 옮겨 붙는다.
    /// ★ <c>hp:switch</c> 안에 <c>hp:case</c>·<c>hp:default</c> 두 벌이 들어 있는 문단모양이 있다.
    ///   여백·줄간격은 <b>모든 갈래</b>를 같이 고쳐야 한다 — 한쪽만 고치면 여는 쪽이 어느 갈래를
    ///   고르느냐에 따라 결과가 달라진다.
    /// </summary>
    public static class cHwpxShapeWriter
    {
        public static int[] RegisterCharShapes(XmlDocument pHeader, IList<CharShapeModel> pList)
        {
            return Register(pHeader, "charProperties", "charPr", pList == null ? 0 : pList.Count,
                delegate (XmlElement el, int i) { ApplyChar(el, pList[i]); },
                delegate (int i) { return pList[i].Base; });
        }

        public static int[] RegisterParaShapes(XmlDocument pHeader, IList<ParaShapeModel> pList)
        {
            return Register(pHeader, "paraProperties", "paraPr", pList == null ? 0 : pList.Count,
                delegate (XmlElement el, int i) { ApplyPara(el, pList[i]); },
                delegate (int i) { return pList[i].Base; });
        }

        private delegate void cApply(XmlElement pElement, int pIndex);
        private delegate int cBaseOf(int pIndex);

        private static int[] Register(XmlDocument pHeader, string pGroupLocal, string pItemLocal,
                                      int pWanted, cApply pApply, cBaseOf pBase)
        {
            XmlElement group = Find(pHeader, pGroupLocal);
            List<XmlElement> have = ChildrenNamed(group, pItemLocal);

            int baseCount = have.Count;
            int[] map = new int[Math.Max(pWanted, baseCount)];
            for (int i = 0; i < map.Length; i++) map[i] = i < baseCount ? i : 0;
            if (group == null || pWanted <= baseCount) return map;

            for (int i = baseCount; i < pWanted; i++)
            {
                int from = pBase(i);
                if (from >= 0 && from < i && from < map.Length) from = map[from];
                if (from < 0 || from >= have.Count) from = 0;

                XmlElement want = (XmlElement)have[from].CloneNode(true);
                pApply(want, i);

                int same = FindSame(have, want);
                if (same >= 0) { map[i] = same; continue; }

                int id = have.Count;
                want.SetAttribute("id", id.ToString(CultureInfo.InvariantCulture));
                group.AppendChild(want);
                have.Add(want);
                map[i] = id;

                group.SetAttribute("itemCnt", have.Count.ToString(CultureInfo.InvariantCulture));
            }
            return map;
        }

        /// <summary>id 만 빼고 통째로 같은 요소의 번호. 없으면 -1.</summary>
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

        private static void ApplyChar(XmlElement pEl, CharShapeModel pModel)
        {
            pEl.SetAttribute("height", Str(pModel.SizeHu));
            if (!string.IsNullOrEmpty(pModel.Color)) pEl.SetAttribute("textColor", pModel.Color);

            SetForAll(Child(pEl, "fontRef"), pModel.Face);
            SetForAll(Child(pEl, "ratio"), pModel.Ratio);
            SetForAll(Child(pEl, "spacing"), pModel.Spacing);

            Toggle(pEl, "bold", pModel.Bold);
            Toggle(pEl, "italic", pModel.Italic);

            // ★ 요소가 없으면 <b>만들어서</b> 쓴다. 있을 때만 고치면, 원본에 밑줄 요소가 없는 글자모양에
            //   밑줄을 걸었을 때 아무 일도 안 일어난다 — 화면에는 밑줄이 그어지고 파일에만 안 들어간다.
            XmlElement ul = Need(pEl, "underline", cBeforeUnderline);
            ul.SetAttribute("type", pModel.Underline == 0 ? "NONE"
                                  : pModel.Underline == 2 ? "CENTER"
                                  : pModel.Underline == 3 ? "TOP" : "BOTTOM");
            if (ul.Attributes["shape"] == null) ul.SetAttribute("shape", "SOLID");
            if (ul.Attributes["color"] == null) ul.SetAttribute("color", "#000000");

            XmlElement st = Need(pEl, "strikeout", cBeforeStrikeout);
            st.SetAttribute("shape", pModel.Strike ? "SOLID" : "NONE");
            if (st.Attributes["color"] == null) st.SetAttribute("color", "#000000");
        }

        /* 스키마 차례상 이 요소들보다 앞에 와야 한다. 먼저 찾히는 것 앞에 끼운다. */
        private static readonly string[] cBeforeUnderline = { "strikeout", "outline", "shadow", "emboss", "engrave" };
        private static readonly string[] cBeforeStrikeout = { "outline", "shadow", "emboss", "engrave" };

        /// <summary>없으면 스키마 차례에 맞는 자리에 만들어서 돌려준다.</summary>
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
        private static void Toggle(XmlElement pParent, string pLocal, bool pOn)
        {
            XmlElement had = Child(pParent, pLocal);
            if (!pOn)
            {
                if (had != null) pParent.RemoveChild(had);
                return;
            }
            if (had != null) return;

            XmlElement made = pParent.OwnerDocument.CreateElement(pParent.Prefix, pLocal, pParent.NamespaceURI);
            XmlElement before = Child(pParent, "underline") ?? Child(pParent, "strikeout");
            if (before != null) pParent.InsertBefore(made, before);
            else pParent.AppendChild(made);
        }

        #endregion

        #region 문단모양

        private static void ApplyPara(XmlElement pEl, ParaShapeModel pModel)
        {
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
