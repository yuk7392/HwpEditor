using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Xml;
using HwpEditor.Models;

namespace HwpEditor.Files
{
    /// <summary>
    /// .hwpx(OWPML) → <see cref="DocModel"/>. hwp 리더와 <b>같은 모델</b>을 채운다 — 화면·레이아웃·
    /// 오라클이 형식을 몰라도 되게 하려는 것이 이 구조의 목적이다(사용자 지시로 1단계에 편입).
    ///
    /// ★ 네임스페이스 접두사(hp/hh/hc/hs)는 파일마다 바뀔 수 있으므로 <b>LocalName 으로만</b> 찾는다.
    /// ★ hwpx 는 hwp 와 달리 길이·간격에 <c>unit</c> 이 붙어 있고 값이 2배가 아니다 — 그대로 쓴다
    ///   (hwp 의 ParaShape 여백이 2배였던 것은 그 형식의 사정이다).
    /// </summary>
    public static class cHwpxReader
    {
        public static DocModel Read(string pPath)
        {
            using (ZipArchive zip = ZipFile.OpenRead(pPath))
            {
                XmlDocument header = LoadXml(zip, "Contents/header.xml");
                if (header == null) throw new InvalidDataException("hwpx 에 Contents/header.xml 이 없다");

                List<XmlDocument> sections = new List<XmlDocument>();
                foreach (string name in SectionNames(zip))
                {
                    XmlDocument sec = LoadXml(zip, name);
                    if (sec != null) sections.Add(sec);
                }

                return ReadOpened(header, sections, pPath, null);
            }
        }

        /// <summary>
        /// 이미 읽어 둔 XML 로 모델을 만든다. 편집·저장 통로(<see cref="cHwpxDocument"/>)는
        /// <b>같은 XmlDocument 를 계속 들고 있어야</b> 편집분을 그 자리에 되쓸 수 있어서 이 문으로 들어온다.
        /// </summary>
        public static DocModel ReadOpened(XmlDocument pHeader, IList<XmlDocument> pSections, string pPath, cHwpxIndex pIndex)
        {
            DocModel doc = new DocModel();
            doc.Format = "hwpx";
            doc.Path = pPath;
            doc.Rev = 1;

            if (pIndex != null) pIndex.Clear();

            ReadFaceNames(pHeader, doc);
            ReadCharShapes(pHeader, doc);
            ReadParaShapes(pHeader, doc);

            for (int i = 0; i < pSections.Count; i++)
                doc.Sections.Add(ReadSection(pSections[i], i, pIndex));

            MarkPageBreaks(doc);
            return doc;
        }

        /// <summary>Contents/section0.xml, section1.xml … 을 번호 순으로. 저장할 때도 같은 순서를 쓴다.</summary>
        public static List<string> SectionEntryNames(ZipArchive pZip)
        {
            return SectionNames(pZip);
        }

        #region zip · xml 유틸

        private static XmlDocument LoadXml(ZipArchive pZip, string pEntry)
        {
            ZipArchiveEntry e = null;
            foreach (ZipArchiveEntry x in pZip.Entries)
                if (string.Equals(x.FullName, pEntry, StringComparison.OrdinalIgnoreCase)) { e = x; break; }
            if (e == null) return null;

            using (Stream s = e.Open())
            {
                XmlDocument d = new XmlDocument();
                d.XmlResolver = null;   // 외부 참조를 타지 않는다

                // ★ 이걸 켜지 않으면 <hp:t> </hp:t> 처럼 <b>공백뿐인 글자 마디가 통째로 사라진다</b>.
                //   XmlDocument 는 기본값에서 공백만 든 텍스트 노드를 버린다 — 읽기에서는 그 문단이
                //   빈 줄로 보이고, 저장에서는 원본에 있던 공백이 파일에서 없어진다(실측 —
                //   complaint-form.hwpx 를 그냥 다시 저장했더니 변환기가 세는 줄이 67 에서 64 로 줄었다).
                d.PreserveWhitespace = true;
                using (StreamReader r = new StreamReader(s, Encoding.UTF8)) d.LoadXml(r.ReadToEnd());
                return d;
            }
        }

        /// <summary>section0.xml, section1.xml … 을 번호 순으로. 10개를 넘는 문서에서 문자열 정렬은 틀린다.</summary>
        private static List<string> SectionNames(ZipArchive pZip)
        {
            List<string> names = new List<string>();
            foreach (ZipArchiveEntry e in pZip.Entries)
            {
                string n = e.FullName;
                if (n.StartsWith("Contents/section", StringComparison.OrdinalIgnoreCase)
                 && n.EndsWith(".xml", StringComparison.OrdinalIgnoreCase))
                    names.Add(n);
            }
            names.Sort(delegate (string a, string b) { return NumIn(a).CompareTo(NumIn(b)); });
            return names;
        }

        private static int NumIn(string pName)
        {
            int v = 0; bool any = false;
            for (int i = 0; i < pName.Length; i++)
                if (pName[i] >= '0' && pName[i] <= '9') { v = v * 10 + (pName[i] - '0'); any = true; }
                else if (any) break;
            return any ? v : int.MaxValue;
        }

        /// <summary>이름공간을 무시하고 자식에서 LocalName 이 맞는 첫 요소.</summary>
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

        /// <summary>깊이 상관없이 LocalName 이 맞는 첫 요소.</summary>
        /// <summary>바로 아래 자식만 본다. 자손까지 뒤지는 <see cref="Find"/> 와 다르다.</summary>
        private static XmlElement Kid(XmlNode pNode, string pLocal)
        {
            foreach (XmlNode n in pNode.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e != null && e.LocalName == pLocal) return e;
            }
            return null;
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

        private static List<XmlElement> FindAll(XmlNode pNode, string pLocal)
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

        private static string Attr(XmlElement pEl, string pName)
        {
            if (pEl == null) return null;
            XmlAttribute a = pEl.Attributes[pName];
            return a == null ? null : a.Value;
        }

        private static long Num(XmlElement pEl, string pName, long pDefault)
        {
            string s = Attr(pEl, pName);
            long v;
            return (s != null && long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) ? v : pDefault;
        }

        private static int NumI(XmlElement pEl, string pName, int pDefault)
        {
            return (int)Num(pEl, pName, pDefault);
        }

        private static bool Flag(XmlElement pEl, string pName)
        {
            string s = Attr(pEl, pName);
            return s == "1" || s == "true" || s == "TRUE";
        }

        /// <summary>&lt;hc:left value="0" unit="HWPUNIT"/&gt; 꼴에서 value 를 꺼낸다.</summary>
        private static int ValueOf(XmlNode pParent, string pLocal, int pDefault)
        {
            XmlElement e = Find(pParent, pLocal);
            if (e == null) return pDefault;
            return NumI(e, "value", pDefault);
        }

        #endregion

        #region header.xml

        private static void ReadFaceNames(XmlDocument pHeader, DocModel pDoc)
        {
            // 한글용 fontface 묶음만 쓴다. lang 속성이 HANGUL 인 것이 있으면 그것, 없으면 첫 묶음.
            List<XmlElement> groups = FindAll(pHeader, "fontface");
            XmlElement use = null;
            for (int i = 0; i < groups.Count; i++)
            {
                string lang = Attr(groups[i], "lang");
                if (lang == null || lang.IndexOf("HANGUL", StringComparison.OrdinalIgnoreCase) >= 0) { use = groups[i]; break; }
            }
            if (use == null && groups.Count > 0) use = groups[0];
            if (use == null) return;

            List<XmlElement> fonts = FindAll(use, "font");
            for (int i = 0; i < fonts.Count; i++)
            {
                FaceNameModel m = new FaceNameModel();
                m.Id = NumI(fonts[i], "id", i);
                m.Name = Attr(fonts[i], "face");
                m.Sub = cFontMap.Substitute(m.Name);
                while (pDoc.FaceNames.Count <= m.Id) pDoc.FaceNames.Add(new FaceNameModel { Id = pDoc.FaceNames.Count, Name = "", Sub = cFontMap.cGothic });
                pDoc.FaceNames[m.Id] = m;
            }
        }

        /// <summary>글자모양 목록만 따로. 저장 뒤 화면에 최종 목록을 돌려줄 때 쓴다(4단계).</summary>
        public static List<CharShapeModel> CharShapesOf(XmlDocument pHeader)
        {
            DocModel tmp = new DocModel();
            ReadCharShapes(pHeader, tmp);
            return tmp.CharShapes;
        }

        public static List<ParaShapeModel> ParaShapesOf(XmlDocument pHeader)
        {
            DocModel tmp = new DocModel();
            ReadParaShapes(pHeader, tmp);
            return tmp.ParaShapes;
        }

        private static void ReadCharShapes(XmlDocument pHeader, DocModel pDoc)
        {
            List<XmlElement> list = FindAll(pHeader, "charPr");
            for (int i = 0; i < list.Count; i++)
            {
                XmlElement c = list[i];
                CharShapeModel m = new CharShapeModel();
                m.Id = NumI(c, "id", i);
                m.SizeHu = NumI(c, "height", 1000);
                m.Color = Attr(c, "textColor") ?? "#000000";
                if (!m.Color.StartsWith("#")) m.Color = "#000000";

                XmlElement fontRef = Child(c, "fontRef");
                m.Face = NumI(fontRef, "hangul", 0);

                XmlElement ratio = Child(c, "ratio");
                m.Ratio = NumI(ratio, "hangul", 100);

                XmlElement spacing = Child(c, "spacing");
                m.Spacing = NumI(spacing, "hangul", 0);

                m.Bold = Child(c, "bold") != null;
                m.Italic = Child(c, "italic") != null;

                XmlElement ul = Child(c, "underline");
                string ulType = Attr(ul, "type");
                m.Underline = (ulType != null && ulType != "NONE") ? 1 : 0;

                XmlElement st = Child(c, "strikeout");
                string stShape = Attr(st, "shape");
                m.Strike = stShape != null && stShape != "NONE";

                while (pDoc.CharShapes.Count <= m.Id) pDoc.CharShapes.Add(new CharShapeModel { Id = pDoc.CharShapes.Count, SizeHu = 1000, Color = "#000000" });
                pDoc.CharShapes[m.Id] = m;
            }
        }

        private static void ReadParaShapes(XmlDocument pHeader, DocModel pDoc)
        {
            List<XmlElement> list = FindAll(pHeader, "paraPr");
            for (int i = 0; i < list.Count; i++)
            {
                XmlElement p = list[i];
                ParaShapeModel m = new ParaShapeModel();
                m.Id = NumI(p, "id", i);

                XmlElement align = Find(p, "align");
                m.Align = AlignName(Attr(align, "horizontal"));

                XmlElement margin = Find(p, "margin");
                if (margin != null)
                {
                    m.IndentHu = ValueOf(margin, "intent", 0);
                    m.MlHu = ValueOf(margin, "left", 0);
                    m.MrHu = ValueOf(margin, "right", 0);
                    m.MtHu = ValueOf(margin, "prev", 0);
                    m.MbHu = ValueOf(margin, "next", 0);
                }

                XmlElement ls = Find(p, "lineSpacing");
                if (ls != null)
                {
                    string type = Attr(ls, "type");
                    m.LsType = LineSpaceName(type);
                    m.Ls = NumI(ls, "value", 160);
                }

                XmlElement bs = Find(p, "breakSetting");
                m.LatinBreak = LatinBreakName(Attr(bs, "breakLatinWord"));
                m.HangulByWord = Attr(bs, "breakNonLatinWord") == "KEEP_WORD";

                while (pDoc.ParaShapes.Count <= m.Id) pDoc.ParaShapes.Add(new ParaShapeModel { Id = pDoc.ParaShapes.Count });
                pDoc.ParaShapes[m.Id] = m;
            }
        }

        private static string AlignName(string pHorizontal)
        {
            if (pHorizontal == null) return "justify";
            switch (pHorizontal.ToUpperInvariant())
            {
                case "LEFT": return "left";
                case "RIGHT": return "right";
                case "CENTER": return "center";
                case "DISTRIBUTE": return "distribute";
                case "DIVISION": return "divide";
                default: return "justify";
            }
        }

        private static string LineSpaceName(string pType)
        {
            if (pType == null) return "percent";
            switch (pType.ToUpperInvariant())
            {
                case "FIXED": return "fixed";
                case "BETWEEN_LINES": return "margin";
                case "AT_LEAST": return "atLeast";
                default: return "percent";
            }
        }

        private static string LatinBreakName(string pBreak)
        {
            if (pBreak == null) return "word";
            switch (pBreak.ToUpperInvariant())
            {
                case "BREAK_WORD": return "letter";
                case "HYPHENATION": return "hyphen";
                default: return "word";
            }
        }

        #endregion

        #region section*.xml

        private static SectionModel ReadSection(XmlDocument pSec, int pIdx, cHwpxIndex pIndex)
        {
            SectionModel sec = new SectionModel();
            sec.Idx = pIdx;

            XmlElement secPr = Find(pSec, "secPr");
            if (secPr != null)
            {
                XmlElement pagePr = Find(secPr, "pagePr");
                if (pagePr != null)
                {
                    sec.Page.WHu = Num(pagePr, "width", 59528);
                    sec.Page.HHu = Num(pagePr, "height", 84188);
                    sec.Page.Landscape = string.Equals(Attr(pagePr, "landscape"), "NARROWLY", StringComparison.OrdinalIgnoreCase);

                    XmlElement mg = Find(pagePr, "margin");
                    if (mg != null)
                    {
                        sec.Page.MlHu = Num(mg, "left", 0);
                        sec.Page.MrHu = Num(mg, "right", 0);
                        sec.Page.MtHu = Num(mg, "top", 0);
                        sec.Page.MbHu = Num(mg, "bottom", 0);
                        sec.Page.MhHu = Num(mg, "header", 0);
                        sec.Page.MfHu = Num(mg, "footer", 0);
                        sec.Page.GutHu = Num(mg, "gutter", 0);
                    }
                }
            }

            XmlElement colPr = Find(pSec, "colPr");
            if (colPr != null)
            {
                sec.Cols.Count = Math.Max(1, NumI(colPr, "colCount", 1));
                sec.Cols.GapHu = Num(colPr, "spaceColumns", 0);
                if (sec.Cols.GapHu == 0 && secPr != null) sec.Cols.GapHu = Num(secPr, "spaceColumns", 0);
            }

            // 문단은 문서 루트의 직계 hp:p 만 센다 — 표 셀 안의 hp:p 는 개체 안에서 따로 읽는다.
            XmlElement root = pSec.DocumentElement;
            int pi = 0;
            foreach (XmlNode n in root.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e == null || e.LocalName != "p") continue;
                sec.Paras.Add(ReadParagraph(e, "s" + pIdx + "p" + pi, pIndex));
                pi++;
            }

            return sec;
        }

        private static ParagraphModel ReadParagraph(XmlElement pP, string pId, cHwpxIndex pIndex)
        {
            ParagraphModel m = new ParagraphModel();
            m.Id = pId;

            if (pIndex != null) pIndex.Paras[pId] = pP;
            m.Ps = NumI(pP, "paraPrIDRef", 0);

            if (Flag(pP, "pageBreak")) m.Brk = "page";
            else if (Flag(pP, "columnBreak")) m.Brk = "column";

            int pos = 0;
            int objIdx = 0;

            foreach (XmlNode rn in pP.ChildNodes)
            {
                XmlElement run = rn as XmlElement;
                if (run == null || run.LocalName != "run") continue;

                int cs = NumI(run, "charPrIDRef", 0);
                StringBuilder buf = new StringBuilder();

                foreach (XmlNode cn in run.ChildNodes)
                {
                    XmlElement c = cn as XmlElement;
                    if (c == null) continue;

                    switch (c.LocalName)
                    {
                        case "t":
                            buf.Append(c.InnerText);
                            pos += c.InnerText.Length;
                            break;

                        case "tab":
                            buf.Append('\t');
                            pos++;
                            break;

                        case "lineBreak":
                            buf.Append('\n');
                            pos++;
                            break;

                        case "secPr":
                        case "ctrl":
                        case "colPr":
                            // 구역·단 정의는 화면에 그릴 개체가 아니다.
                            break;

                        default:
                            {
                                InlineObjModel o = ToObject(c, pId, objIdx, pos, pIndex);
                                if (o != null)
                                {
                                    if (buf.Length > 0) { m.Runs.Add(NewRun(cs, buf)); }
                                    m.Objs.Add(o);
                                    objIdx++;
                                    pos++;
                                }
                                break;
                            }
                    }
                }

                if (buf.Length > 0) m.Runs.Add(NewRun(cs, buf));
            }

            m.Len = pos;
            m.Seg = ReadLineSeg(pP);
            return m;
        }

        private static RunModel NewRun(int pCs, StringBuilder pBuf)
        {
            RunModel r = new RunModel();
            r.Cs = pCs;
            r.Text = pBuf.ToString();
            pBuf.Length = 0;
            return r;
        }

        /// <summary>hwpx 의 개체. 표·그림만 갈라 보고 나머지는 opaque 로 둔다(계획 B-4).</summary>
        private static InlineObjModel ToObject(XmlElement pEl, string pParaId, int pIndex, int pPos, cHwpxIndex pMap)
        {
            string local = pEl.LocalName;
            if (local == "linesegarray") return null;

            InlineObjModel o = new InlineObjModel();
            o.Pos = pPos;
            o.Oid = pParaId + "#" + pIndex;

            XmlElement sz = Find(pEl, "sz");
            if (sz != null)
            {
                o.WHu = Num(sz, "width", 0);
                o.HHu = Num(sz, "height", 0);
            }

            XmlElement posEl = Find(pEl, "pos");
            if (posEl != null)
            {
                o.XOffHu = Num(posEl, "horzOffset", 0);
                o.YOffHu = Num(posEl, "vertOffset", 0);
                o.RelH = RelName(Attr(posEl, "horzRelTo"));
                o.RelV = RelName(Attr(posEl, "vertRelTo"));
                o.Flow = FlowName(Attr(posEl, "textWrap"));
                o.Inline = Flag(posEl, "treatAsChar");
            }
            else
            {
                o.Inline = true;
            }

            if (pMap != null) pMap.Objs[o.Oid] = pEl;

            if (local == "pic") { o.Kind = "image"; return o; }
            if (local == "tbl") { o.Kind = "table"; o.Table = ToTable(pEl, o.Oid, pMap); return o; }

            o.Kind = "opaque";
            o.Ctrl = local;
            o.Label = OpaqueLabel(local);
            return o;
        }

        private static string RelName(string pRel)
        {
            if (pRel == null) return "para";
            switch (pRel.ToUpperInvariant())
            {
                case "PAPER": return "paper";
                case "PAGE": return "page";
                case "COLUMN": return "column";
                default: return "para";
            }
        }

        private static string FlowName(string pWrap)
        {
            if (pWrap == null) return "fit";
            switch (pWrap.ToUpperInvariant())
            {
                case "TOP_AND_BOTTOM":
                case "SQUARE": return "takePlace";
                case "BEHIND_TEXT": return "behind";
                case "IN_FRONT_OF_TEXT": return "front";
                default: return "fit";
            }
        }

        private static string OpaqueLabel(string pLocal)
        {
            switch (pLocal)
            {
                case "equation": return "수식";
                case "footNote": return "각주";
                case "endNote": return "미주";
                case "header": return "머리말";
                case "footer": return "꼬리말";
                case "rect":
                case "ellipse":
                case "line":
                case "polygon":
                case "curve":
                case "arc":
                case "container": return "그리기";
                case "textart": return "글맵시";
                case "ole": return "OLE";
                default: return pLocal;
            }
        }

        private static TableModel ToTable(XmlElement pTbl, string pOid, cHwpxIndex pMap)
        {
            TableModel t = new TableModel();
            t.Rows = NumI(pTbl, "rowCnt", 0);
            t.Cols = NumI(pTbl, "colCnt", 0);

            List<XmlElement> rows = new List<XmlElement>();
            foreach (XmlNode n in pTbl.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e != null && e.LocalName == "tr") rows.Add(e);
            }
            if (t.Rows == 0) t.Rows = rows.Count;

            for (int r = 0; r < rows.Count; r++)
            {
                int c = 0;
                foreach (XmlNode n in rows[r].ChildNodes)
                {
                    XmlElement tc = n as XmlElement;
                    if (tc == null || tc.LocalName != "tc") continue;

                    CellModel cm = new CellModel();

                    // ★ 여기서 Find(자손까지 뒤짐)를 쓰면 안 된다. tc 안에서 subList 가 cellAddr 보다
                    //   <b>앞</b>이라, 칸 안에 표가 또 있으면 <b>안쪽 표 첫 칸의 번호·크기</b>를 집어 온다.
                    //   그러면 화면이 보는 격자와 저장하는 쪽이 보는 격자가 갈리고, 문단 id 까지
                    //   r0c0 으로 겹쳐 <b>엉뚱한 칸의 글이 덮어써진다</b>(되쓰기 쪽은 이미 Kid 로 고쳐 뒀다).
                    XmlElement addr = Kid(tc, "cellAddr");
                    cm.R = addr != null ? NumI(addr, "rowAddr", r) : r;
                    cm.C = addr != null ? NumI(addr, "colAddr", c) : c;

                    XmlElement span = Kid(tc, "cellSpan");
                    cm.Rs = span != null ? Math.Max(1, NumI(span, "rowSpan", 1)) : 1;
                    cm.Cs = span != null ? Math.Max(1, NumI(span, "colSpan", 1)) : 1;

                    XmlElement csz = Kid(tc, "cellSz");
                    if (csz != null) { cm.WHu = Num(csz, "width", 0); cm.HHu = Num(csz, "height", 0); }

                    // 칸 안쪽 여백. 속성으로 오는 문서와 자식 요소로 오는 문서가 둘 다 있어 양쪽을 본다.
                    XmlElement cmg = Kid(tc, "cellMargin");
                    if (cmg != null)
                    {
                        cm.MlHu = Num(cmg, "left", ValueOf(cmg, "left", 0));
                        cm.MrHu = Num(cmg, "right", ValueOf(cmg, "right", 0));
                        cm.MtHu = Num(cmg, "top", ValueOf(cmg, "top", 0));
                        cm.MbHu = Num(cmg, "bottom", ValueOf(cmg, "bottom", 0));
                    }

                    XmlElement sub = Kid(tc, "subList");
                    if (sub != null)
                    {
                        int k = 0;
                        foreach (XmlNode sn in sub.ChildNodes)
                        {
                            XmlElement sp = sn as XmlElement;
                            if (sp == null || sp.LocalName != "p") continue;
                            cm.Paras.Add(ReadParagraph(sp, pOid + "r" + cm.R + "c" + cm.C + "p" + k, pMap));
                            k++;
                        }
                    }

                    t.Cells.Add(cm);
                    c++;
                }
            }

            if (t.Cols == 0)
                foreach (CellModel cm in t.Cells) if (cm.C + 1 > t.Cols) t.Cols = cm.C + 1;

            return t;
        }

        /// <summary>
        /// <c>&lt;hp:lineseg textpos vertpos vertsize textheight baseline spacing horzpos horzsize/&gt;</c>.
        /// ★ hwpx 는 hwp 와 달리 <c>spacing</c>(줄 사이 여분)이 따로 실려 있어 줄 간격을 추측할 필요가 없다 —
        ///   다음 줄 vertpos = vertpos + textheight + spacing 이다(실측).
        /// </summary>
        private static List<SegModel> ReadLineSeg(XmlElement pP)
        {
            XmlElement arr = null;
            foreach (XmlNode n in pP.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e != null && e.LocalName == "linesegarray") { arr = e; break; }
            }
            if (arr == null) return null;

            List<SegModel> list = new List<SegModel>();
            foreach (XmlNode n in arr.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e == null || e.LocalName != "lineseg") continue;

                SegModel m = new SegModel();
                m.S = NumI(e, "textpos", 0);
                m.Y = Num(e, "vertpos", 0);
                m.H = Num(e, "textheight", 0);
                m.Th = m.H;
                m.B = Num(e, "baseline", 0);
                m.X = Num(e, "horzpos", 0);
                m.W = Num(e, "horzsize", 0);
                list.Add(m);
            }
            return list.Count > 0 ? list : null;
        }

        /// <summary>hwp 리더와 같은 규칙 — y 가 되감기면 쪽이 넘어간 것으로 본다.</summary>
        private static void MarkPageBreaks(DocModel pDoc)
        {
            long prevY = -1;
            for (int si = 0; si < pDoc.Sections.Count; si++)
            {
                bool sectionStart = si > 0;
                foreach (ParagraphModel p in pDoc.Sections[si].Paras)
                {
                    if (p.Seg == null) continue;
                    foreach (SegModel s in p.Seg)
                    {
                        if (sectionStart) { s.NewPage = true; sectionStart = false; }
                        else if (prevY >= 0 && s.Y < prevY) s.NewPage = true;
                        prevY = s.Y;
                    }
                }
            }
        }

        #endregion
    }
}
