using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Xml;
using HwpEditor.Models;

namespace HwpEditor.Files
{
    /// <summary>
    /// hwp 쪽 <see cref="cHwpWriter"/> 와 같은 약속이다 —
    /// <b>손댄 문단만</b> 다시 만들고 나머지 XML 은 읽은 그대로 다시 저장한다.
    ///
    /// ★ hwpx 는 위치 계산이 hwp 보다 쉽다 — 개체가 파일에서도 한 글자라 편집 인덱스가 곧 <c>textpos</c> 다
    ///   (hwp 는 확장 제어문자가 8글자라 변환표가 필요했다).
    /// ★ 대신 <c>hp:secPr</c>·<c>hp:ctrl</c> 처럼 <b>자리를 안 차지하는 요소</b>가 run 안에 섞여 있다.
    ///   이건 모델에 안 실리므로 문단을 다시 만들 때 따로 챙겨 두었다가 앞에 되돌려 놓는다.
    /// </summary>
    public static class cHwpxWriter
    {
        private const string cCoreNs = "http://www.hancom.co.kr/hwpml/2011/core";

        /// <summary>줄의 첫 조각이자 마지막 조각. hwp 의 lineseg 태그와 같은 값이다.</summary>
        private const string cSegFlags = "393216";

        public static void Apply(cHwpxDocument pDoc, cHwpxIndex pIndex, SaveRequest pReq, SaveResult pResult)
        {
            if (pDoc == null || pIndex == null || pReq == null || pReq.Ops == null) return;

            // ★ 모양을 먼저 등록한다. 화면 번호와 문서 번호가 다를 수 있고(같은 모양 재사용),
            //   그 표가 있어야 아래에서 cs·ps 를 옮겨 적을 수 있다.
            // ★ 테두리/배경 표가 맨 먼저다 — 문단모양과 칸이 그 번호를 가리킨다.
            cShapes = new cShapeMap();
            cShapes.Bf = cHwpxShapeWriter.RegisterBorderFills(pDoc.Header, pReq.BorderFills);
            cShapes.Cs = cHwpxShapeWriter.RegisterCharShapes(pDoc.Header, pReq.CharShapes, cShapes.Bf);
            cShapes.Ps = cHwpxShapeWriter.RegisterParaShapes(pDoc.Header, pReq.ParaShapes, cShapes.Bf);

            IList<EditOp> pOps = pReq.Ops;

            Dictionary<string, EditOp> images = new Dictionary<string, EditOp>();
            foreach (EditOp op in pOps)
                if ((op.Op == "addImage" || op.Op == "addTable") && !string.IsNullOrEmpty(op.TmpId)) images[op.TmpId] = op;

            foreach (EditOp op in pOps) if (op.Op == "replace") ApplyReplace(pDoc, pIndex, op, images, pResult);
            foreach (EditOp op in pOps) if (op.Op == "delete") ApplyDelete(pIndex, op);
            foreach (EditOp op in pOps) if (op.Op == "insertAfter") ApplyInsertAfter(pDoc, pIndex, op, images, pResult);

            // ★ 표 구조는 맨 마지막에 — 앞의 셀 문단 요청이 아직 옛 구조를 가리키고 있다.
            bool rebuilt = ApplyTableOps(pIndex, pOps);

            // ★ 서식은 구조 뒤다 — 표를 다시 세우면 칸 요소가 새것이라 앞서 건 서식이 사라진다.
            ApplyFormatOps(pIndex, pOps);

            if (pResult != null)
            {
                pResult.CsMap = cShapes.Cs;
                pResult.PsMap = cShapes.Ps;
                pResult.BfMap = cShapes.Bf;
                if (rebuilt) pResult.Reload = true;
            }
            cShapes = null;
        }

        /// <summary>
        /// 칸·표 서식(<c>cellFmt</c>·<c>tableFmt</c>). hwp 쪽 <c>cHwpWriter.ApplyFormatOps</c> 와 같은 규칙이다.
        /// </summary>
        private static void ApplyFormatOps(cHwpxIndex pIndex, IList<EditOp> pOps)
        {
            foreach (EditOp op in pOps)
            {
                if (op.Op != "cellFmt" && op.Op != "tableFmt") continue;

                XmlElement tbl;
                if (string.IsNullOrEmpty(op.Oid) || !pIndex.Objs.TryGetValue(op.Oid, out tbl)) continue;
                if (tbl.LocalName != "tbl") continue;

                if (op.Op == "tableFmt") { ApplyTableFmt(tbl, op); continue; }

                foreach (XmlElement tr in ChildElements(tbl, "tr"))
                    foreach (XmlElement tc in ChildElements(tr, "tc"))
                    {
                        XmlElement addr = Kid(tc, "cellAddr");
                        if (addr == null) continue;
                        int row = NumI(addr, "rowAddr", 0), col = NumI(addr, "colAddr", 0);
                        if (!InRect(op, row, col)) continue;

                        if (op.Bf.HasValue) tc.SetAttribute("borderFillIDRef", Str(cShapeWriter.Map(cShapes.Bf, op.Bf.Value)));
                        if (op.Head.HasValue) tc.SetAttribute("header", op.Head.Value ? "1" : "0");

                        XmlElement sub = Kid(tc, "subList");
                        if (op.Valign.HasValue && sub != null)
                            sub.SetAttribute("vertAlign", op.Valign.Value == 1 ? "CENTER" : op.Valign.Value == 2 ? "BOTTOM" : "TOP");

                        if (op.CmL.HasValue || op.CmR.HasValue || op.CmT.HasValue || op.CmB.HasValue)
                        {
                            XmlElement cmg = KidOrMake(tc, "cellMargin", "cellSz");
                            if (op.CmL.HasValue) cmg.SetAttribute("left", Str(op.CmL.Value));
                            if (op.CmR.HasValue) cmg.SetAttribute("right", Str(op.CmR.Value));
                            if (op.CmT.HasValue) cmg.SetAttribute("top", Str(op.CmT.Value));
                            if (op.CmB.HasValue) cmg.SetAttribute("bottom", Str(op.CmB.Value));
                            tc.SetAttribute("hasMargin", "1");
                        }
                    }
            }
        }

        private static void ApplyTableFmt(XmlElement pTbl, EditOp pOp)
        {
            if (pOp.Bf.HasValue) pTbl.SetAttribute("borderFillIDRef", Str(cShapeWriter.Map(cShapes.Bf, pOp.Bf.Value)));
            if (pOp.Divide.HasValue)
                pTbl.SetAttribute("pageBreak", pOp.Divide.Value == 1 ? "CELL" : pOp.Divide.Value == 2 ? "TABLE" : "NONE");
            if (pOp.RepeatHeader.HasValue) pTbl.SetAttribute("repeatHeader", pOp.RepeatHeader.Value ? "1" : "0");

            if (!pOp.OmL.HasValue && !pOp.OmR.HasValue && !pOp.OmT.HasValue && !pOp.OmB.HasValue) return;

            XmlElement om = KidOrMake(pTbl, "outMargin", "pos");
            if (pOp.OmL.HasValue) om.SetAttribute("left", Str(pOp.OmL.Value));
            if (pOp.OmR.HasValue) om.SetAttribute("right", Str(pOp.OmR.Value));
            if (pOp.OmT.HasValue) om.SetAttribute("top", Str(pOp.OmT.Value));
            if (pOp.OmB.HasValue) om.SetAttribute("bottom", Str(pOp.OmB.Value));
        }

        /// <summary>칸 사각형 안인가. 값이 안 온 변(-1)은 제한 없음이다.</summary>
        private static bool InRect(EditOp pOp, int pRow, int pCol)
        {
            if (pOp.R0 >= 0 && pRow < pOp.R0) return false;
            if (pOp.R1 >= 0 && pRow > pOp.R1) return false;
            if (pOp.C0 >= 0 && pCol < pOp.C0) return false;
            if (pOp.C1 >= 0 && pCol > pOp.C1) return false;
            return true;
        }

        private sealed class cShapeMap
        {
            public int[] Cs;
            public int[] Ps;
            public int[] Bf;
        }

        [ThreadStatic]
        private static cShapeMap cShapes;

        #region op 별 처리

        private static void ApplyReplace(cHwpxDocument pDoc, cHwpxIndex pIndex, EditOp pOp,
                                         Dictionary<string, EditOp> pImages, SaveResult pResult)
        {
            XmlElement p;
            if (string.IsNullOrEmpty(pOp.Id) || !pIndex.Paras.TryGetValue(pOp.Id, out p))
                throw new InvalidOperationException("고칠 문단을 못 찾았다: " + (pOp.Id ?? "(없음)"));

            Rewrite(pDoc, pIndex, p, pOp, pImages, pResult);
        }

        private static void ApplyDelete(cHwpxIndex pIndex, EditOp pOp)
        {
            XmlElement p;
            if (string.IsNullOrEmpty(pOp.Id)) return;
            if (!pIndex.Paras.TryGetValue(pOp.Id, out p)) return;
            if (p.ParentNode == null) return;

            // ★ 구역에 문단이 하나도 없으면 문서가 깨진다. 마지막 하나는 <b>비운다</b> —
            //   그냥 넘어가면 화면에서 지운 글이 파일에는 그대로 남는다.
            if (CountParagraphs(p.ParentNode) <= 1) { ClearButCarried(p); return; }

            p.ParentNode.RemoveChild(p);
            pIndex.Paras.Remove(pOp.Id);
        }

        private static void ApplyInsertAfter(cHwpxDocument pDoc, cHwpxIndex pIndex, EditOp pOp,
                                             Dictionary<string, EditOp> pImages, SaveResult pResult)
        {
            XmlElement refer;
            if (string.IsNullOrEmpty(pOp.Ref) || !pIndex.Paras.TryGetValue(pOp.Ref, out refer))
                throw new InvalidOperationException("기준 문단을 못 찾았다: " + (pOp.Ref ?? "(없음)"));
            if (refer.ParentNode == null)
                throw new InvalidOperationException("기준 문단이 문서에서 빠졌다: " + pOp.Ref);

            // ★ 기준 문단을 복제한다 — 새로 만들면 styleIDRef 같은 속성이 빠지고 그 문단만 다르게 보인다.
            XmlElement np = (XmlElement)refer.CloneNode(true);
            np.SetAttribute("id", NewParagraphId(refer));

            // ★ 단 <b>구역·단 정의는 떼어 낸다</b>. 복제본에 그대로 남으면 Rewrite 가 그것을 챙겨
            //   되돌려 놓고, 한 구역 안에 secPr 이 두 개 생긴다 — 여는 쪽은 두 번째를 새 구역으로 읽는다.
            StripCarried(np);

            refer.ParentNode.InsertAfter(np, refer);

            pIndex.Paras[pOp.Id] = np;
            Rewrite(pDoc, pIndex, np, pOp, pImages, pResult);
        }

        private static void ClearButCarried(XmlElement pPara)
        {
            List<XmlElement> carry = new List<XmlElement>();
            foreach (XmlElement run in ChildElements(pPara, "run"))
                foreach (XmlNode cn in run.ChildNodes)
                {
                    XmlElement c = cn as XmlElement;
                    if (c == null) continue;
                    if (c.LocalName == "secPr" || c.LocalName == "ctrl" || c.LocalName == "colPr") carry.Add(c);
                }

            List<XmlElement> runs = ChildElements(pPara, "run");
            string cs = runs.Count > 0 && runs[0].Attributes["charPrIDRef"] != null
                      ? runs[0].Attributes["charPrIDRef"].Value : "0";

            while (pPara.FirstChild != null) pPara.RemoveChild(pPara.FirstChild);

            XmlElement keep = pPara.OwnerDocument.CreateElement(pPara.Prefix, "run", pPara.NamespaceURI);
            keep.SetAttribute("charPrIDRef", cs);
            for (int i = 0; i < carry.Count; i++) keep.AppendChild(carry[i]);
            pPara.AppendChild(keep);

            WriteLineSeg(pPara, new EditOp());
        }

        private static void StripCarried(XmlElement pPara)
        {
            foreach (XmlElement run in ChildElements(pPara, "run"))
            {
                List<XmlElement> drop = new List<XmlElement>();
                foreach (XmlNode cn in run.ChildNodes)
                {
                    XmlElement c = cn as XmlElement;
                    if (c == null) continue;
                    if (c.LocalName == "secPr" || c.LocalName == "ctrl" || c.LocalName == "colPr") drop.Add(c);
                }
                for (int i = 0; i < drop.Count; i++) run.RemoveChild(drop[i]);
            }
        }

        private static List<XmlElement> ChildElements(XmlNode pNode, string pLocal)
        {
            List<XmlElement> outList = new List<XmlElement>();
            foreach (XmlNode n in pNode.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e != null && e.LocalName == pLocal) outList.Add(e);
            }
            return outList;
        }

        private static int CountParagraphs(XmlNode pParent)
        {
            int n = 0;
            foreach (XmlNode c in pParent.ChildNodes)
            {
                XmlElement e = c as XmlElement;
                if (e != null && e.LocalName == "p") n++;
            }
            return n;
        }

        /// <summary>
        /// ★ 표 칸 안의 문단까지 본다(<see cref="NextParagraphIdDeep"/>). 구역 루트의 직계만 보면
        ///   칸 문단 id 가 더 큰 문서(끝이 표로 끝나는 문서)에서 이미 있는 id 를 또 만든다.
        /// </summary>
        private static string NewParagraphId(XmlElement pNear)
        {
            return NextParagraphIdDeep(pNear.OwnerDocument).ToString(CultureInfo.InvariantCulture);
        }

        #endregion

        #region 문단 하나 되쓰기

        private sealed class cFlatChar
        {
            public char Ch;
            public int Cs;
        }

        private static void Rewrite(cHwpxDocument pDoc, cHwpxIndex pIndex, XmlElement pP, EditOp pOp,
                                    Dictionary<string, EditOp> pImages, SaveResult pResult)
        {
            // 자리를 안 차지하는 요소를 원래 순서대로 챙긴다(구역·단 정의). 안 챙기면 첫 문단을 한 번
            // 고치는 순간 그 구역의 용지 정의가 통째로 사라진다.
            List<XmlElement> carry = new List<XmlElement>();
            foreach (XmlNode rn in pP.ChildNodes)
            {
                XmlElement run = rn as XmlElement;
                if (run == null || run.LocalName != "run") continue;
                foreach (XmlNode cn in run.ChildNodes)
                {
                    XmlElement c = cn as XmlElement;
                    if (c == null) continue;
                    if (c.LocalName == "secPr" || c.LocalName == "ctrl" || c.LocalName == "colPr") carry.Add(c);
                }
            }

            // 글자가 안 남는 문단은 원래 쓰던 글자모양을 지킨다(0 으로 밀면 빈 줄의 높이·글꼴이 바뀐다).
            int keepCs = 0;
            List<XmlElement> runs0 = ChildElements(pP, "run");
            if (runs0.Count > 0)
            {
                XmlAttribute a = runs0[0].Attributes["charPrIDRef"];
                int v;
                if (a != null && int.TryParse(a.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) keepCs = v;
            }

            while (pP.FirstChild != null) pP.RemoveChild(pP.FirstChild);
            int ps = cShapes == null ? pOp.Ps : cShapeWriter.Map(cShapes.Ps, pOp.Ps);
            pP.SetAttribute("paraPrIDRef", ps.ToString(CultureInfo.InvariantCulture));
            pP.SetAttribute("pageBreak", pOp.Brk == "page" || pOp.Brk == "section" ? "1" : "0");
            pP.SetAttribute("columnBreak", pOp.Brk == "column" || pOp.Brk == "multicolumn" ? "1" : "0");

            List<cFlatChar> flat = Flatten(pOp.Runs);
            Dictionary<int, EditObj> objs = ByPosition(pOp.Objs, flat.Count, pOp.Id);
            int len = flat.Count + objs.Count;

            cRunBuilder b = new cRunBuilder(pP);
            b.SetShape(flat.Count > 0 ? flat[0].Cs : keepCs);
            for (int i = 0; i < carry.Count; i++) b.Element(carry[i]);

            int flatAt = 0;
            for (int edit = 0; edit < len; edit++)
            {
                EditObj eo;
                if (objs.TryGetValue(edit, out eo))
                {
                    XmlElement el = ObjectElement(pDoc, pIndex, pP, eo, pImages, pResult);
                    if (el != null) b.Element(el);
                    continue;
                }

                if (flatAt >= flat.Count) continue;

                cFlatChar it = flat[flatAt++];
                b.SetShape(it.Cs);
                if (it.Ch == '\t') b.Tab();
                else if (it.Ch == '\n') b.LineBreak();
                else b.Text(it.Ch);
            }

            b.Finish();
            WriteLineSeg(pP, pOp);
        }

        private static XmlElement ObjectElement(cHwpxDocument pDoc, cHwpxIndex pIndex, XmlElement pP,
                                                EditObj pObj, Dictionary<string, EditOp> pImages, SaveResult pResult)
        {
            XmlElement el;
            if (!string.IsNullOrEmpty(pObj.Oid) && pIndex.Objs.TryGetValue(pObj.Oid, out el))
            {
                ApplyGeom(el, pObj);
                return el;
            }

            EditOp img;
            if (!string.IsNullOrEmpty(pObj.TmpId) && pImages.TryGetValue(pObj.TmpId, out img))
            {
                bool isTable = img.Op == "addTable";
                XmlElement made = isTable ? MakeTable(pDoc, pIndex, pP, img, pImages, pResult)
                                          : MakePicture(pDoc, pP, img);
                // ★ 새 표도 문서를 다시 읽어야 한다 — 칸 문단을 여기서 만들었으므로 화면이 들고 있는
                //    칸 문단 id 는 문서에 없는 가짜다(hwp 쪽 PutObject 와 같은 이유).
                if (isTable && pResult != null) pResult.Reload = true;
                // 넣자마자 옮겼으면 그 자리로 (MakePicture 는 오프셋을 0 으로 둔다).
                // ★ 표는 뺀다 — 표의 바깥 크기는 칸 격자에서 나오므로 여기서 덮으면 칸 폭 합과 갈라진다.
                if (!isTable) ApplyGeom(made, pObj);
                string oid = pObj.TmpId + "@" + pIndex.Objs.Count.ToString(CultureInfo.InvariantCulture);
                pIndex.Objs[oid] = made;
                if (pResult != null) pResult.NewOids[pObj.TmpId] = oid;
                return made;
            }

            cLog.Write("hwpx 되쓰기: 짝 없는 개체를 건너뛴다 oid=" + pObj.Oid + " tmpId=" + pObj.TmpId);
            return null;
        }

        private static List<cFlatChar> Flatten(List<RunModel> pRuns)
        {
            List<cFlatChar> flat = new List<cFlatChar>();
            if (pRuns == null) return flat;

            foreach (RunModel run in pRuns)
            {
                if (run == null || run.Text == null) continue;
                int cs = cShapes == null ? run.Cs : cShapeWriter.Map(cShapes.Cs, run.Cs);
                for (int i = 0; i < run.Text.Length; i++)
                {
                    cFlatChar c = new cFlatChar();
                    c.Ch = run.Text[i];
                    c.Cs = cs;
                    flat.Add(c);
                }
            }
            return flat;
        }

        /// <summary>
        /// ★ 자리가 겹치거나 범위(글자 수 + 개체 수) 밖인 개체는 되쓰기 반복이 한 번도 안 지나 <b>조용히</b>
        ///   빠진다. 흔적을 남긴다 — 화면에는 있는데 저장본에서 사라진 개체를 되짚을 길이 이것뿐이다.
        /// </summary>
        private static Dictionary<int, EditObj> ByPosition(List<EditObj> pObjs, int pChars, string pParaId)
        {
            Dictionary<int, EditObj> map = new Dictionary<int, EditObj>();
            if (pObjs == null) return map;
            foreach (EditObj o in pObjs)
            {
                if (o == null) continue;
                if (map.ContainsKey(o.Pos))
                    cLog.Write("되쓰기: 자리가 겹친 개체를 건너뛴다 id=" + pParaId + " pos=" + o.Pos + " oid=" + map[o.Pos].Oid + " tmpId=" + map[o.Pos].TmpId);
                map[o.Pos] = o;
            }

            int len = pChars + map.Count;
            foreach (KeyValuePair<int, EditObj> kv in map)
                if (kv.Key < 0 || kv.Key >= len)
                    cLog.Write("되쓰기: 자리가 범위 밖인 개체를 건너뛴다 id=" + pParaId + " pos=" + kv.Key + " len=" + len
                             + " oid=" + kv.Value.Oid + " tmpId=" + kv.Value.TmpId);
            return map;
        }

        /// <summary>
        /// ★ 글은 <c>hp:t</c> 안에 모으고 탭·줄바꿈·개체가 끼면 그 자리에서 끊는다 — 한 <c>hp:t</c> 에
        ///   이어 붙이면 그 사이에 있던 탭이 사라진다.
        /// </summary>
        private sealed class cRunBuilder
        {
            private readonly XmlElement cPara;
            private readonly XmlDocument cXml;
            private readonly string cPrefix;
            private readonly string cNs;

            private XmlElement cRun;
            private int cCs = int.MinValue;
            private readonly StringBuilder cBuf = new StringBuilder();

            internal cRunBuilder(XmlElement pPara)
            {
                cPara = pPara;
                cXml = pPara.OwnerDocument;
                cPrefix = pPara.Prefix;
                cNs = pPara.NamespaceURI;
            }

            internal void SetShape(int pCs)
            {
                if (cRun != null && pCs == cCs) return;
                FlushText();
                cCs = pCs;
                cRun = cXml.CreateElement(cPrefix, "run", cNs);
                cRun.SetAttribute("charPrIDRef", pCs.ToString(CultureInfo.InvariantCulture));
                cPara.AppendChild(cRun);
            }

            internal void Text(char pCh) { cBuf.Append(pCh); }

            internal void Tab() { Simple("tab"); }

            internal void LineBreak() { Simple("lineBreak"); }

            private void Simple(string pLocal)
            {
                FlushText();
                cRun.AppendChild(cXml.CreateElement(cPrefix, pLocal, cNs));
            }

            /// <summary>이미 있는 요소를 이 run 으로 옮긴다(같은 문서 안이면 AppendChild 가 곧 이동이다).</summary>
            internal void Element(XmlElement pEl)
            {
                FlushText();
                cRun.AppendChild(pEl);
            }

            internal void Finish() { FlushText(); }

            private void FlushText()
            {
                if (cBuf.Length == 0) return;
                if (cRun == null) SetShape(cCs == int.MinValue ? 0 : cCs);

                XmlElement t = cXml.CreateElement(cPrefix, "t", cNs);
                t.AppendChild(cXml.CreateTextNode(cBuf.ToString()));
                cRun.AppendChild(t);
                cBuf.Length = 0;
            }
        }

        /// <summary>
        /// ★ hwpx 는 줄 간격이 <c>spacing</c> 으로 따로 실린다 — 다음 줄 vertpos = vertpos + textheight + spacing
        ///   (실측). 그래서 우리 줄 높이(다음 줄까지의 거리)에서 글자 높이를 뺀 값이 spacing 이다.
        /// </summary>
        private static void WriteLineSeg(XmlElement pP, EditOp pOp)
        {
            XmlDocument xd = pP.OwnerDocument;
            XmlElement arr = xd.CreateElement(pP.Prefix, "linesegarray", pP.NamespaceURI);

            List<SegModel> seg = pOp.Seg;
            if (seg == null || seg.Count == 0)
            {
                arr.AppendChild(Seg(xd, pP, 0, 0, 1000, 850, 600, 0, 42520));
            }
            else
            {
                foreach (SegModel s in seg)
                {
                    long th = s.Th > 0 ? s.Th : s.H;
                    arr.AppendChild(Seg(xd, pP, s.S, s.Y, th, s.B, Math.Max(0, s.H - th), s.X, s.W));
                }
            }

            pP.AppendChild(arr);
        }

        private static XmlElement Seg(XmlDocument pXml, XmlElement pP, long pPos, long pY, long pTh,
                                      long pBase, long pSpacing, long pX, long pW)
        {
            XmlElement e = pXml.CreateElement(pP.Prefix, "lineseg", pP.NamespaceURI);
            e.SetAttribute("textpos", Str(pPos));
            e.SetAttribute("vertpos", Str(pY));
            e.SetAttribute("vertsize", Str(pTh));
            e.SetAttribute("textheight", Str(pTh));
            e.SetAttribute("baseline", Str(pBase));
            e.SetAttribute("spacing", Str(pSpacing));
            e.SetAttribute("horzpos", Str(pX));
            e.SetAttribute("horzsize", Str(pW));
            e.SetAttribute("flags", cSegFlags);
            return e;
        }

        private static string Str(long pValue)
        {
            return pValue.ToString(CultureInfo.InvariantCulture);
        }

        #endregion

        #region 표 행·열

        /// <summary>
        /// 격자 계산은 <see cref="cTableWriter.EditGrid"/> 가 hwp 와 <b>같은 것</b>을 쓴다 —
        /// 두 벌로 짜면 병합된 표에서 두 형식의 결과가 갈리고, 갈린 것은 눈으로 안 보인다.
        ///
        /// ★ 넣거나 뺀 뒤 <c>cellAddr</c>·<c>cellSpan</c>·<c>cellSz</c> 와 <c>rowCnt</c>·<c>colCnt</c>·<c>hp:sz</c>
        ///   를 전부 다시 쓴다. 하나라도 빠지면 여는 쪽이 칸을 엉뚱한 자리에 그린다.
        /// </summary>
        private static bool ApplyTableOps(cHwpxIndex pIndex, IList<EditOp> pOps)
        {
            bool any = false;

            foreach (EditOp op in pOps)
            {
                if (!cTableWriter.IsTableOp(op.Op)) continue;

                XmlElement tbl;
                if (string.IsNullOrEmpty(op.Oid) || !pIndex.Objs.TryGetValue(op.Oid, out tbl)) continue;

                List<XmlElement> rows = ChildElements(tbl, "tr");
                if (rows.Count == 0) continue;

                List<cGridCell> cells = Snapshot(rows);
                if (cells.Count == 0) continue;

                long grow;                                  // 크기는 아래 Resize 가 격자에서 다시 낸다
                if (!cTableWriter.EditGrid(cells, op, out grow)) continue;

                foreach (cGridCell g in cells)
                    if (g.Made) g.Tag = EmptyCellLike((XmlElement)g.Seed.Tag);
                foreach (cGridCell g in cells) Absorb(g);

                Rebuild(tbl, rows, cells);
                Resize(tbl, cells);
                any = true;
            }
            return any;
        }

        /// <summary>
        /// 합쳐진 칸의 문단을 남는 칸 뒤로 <b>옮긴다</b>(복제가 아니다 — id 를 그대로 둬야 같은 저장 요청의
        /// replace 가 가리키는 문단과 같은 것이 남는다).
        /// </summary>
        private static void Absorb(cGridCell pCell)
        {
            if (pCell.Absorbed == null) return;
            XmlElement dst = Kid((XmlElement)pCell.Tag, "subList");
            if (dst == null) return;

            foreach (cGridCell a in pCell.Absorbed)
            {
                XmlElement src = Kid((XmlElement)a.Tag, "subList");
                if (src == null) continue;
                foreach (XmlElement p in ChildElements(src, "p")) { src.RemoveChild(p); dst.AppendChild(p); }
            }
        }

        /// <summary>tc 들을 격자 좌표째 떠 온다. 번호는 <b>파일이 들고 있던 것</b>을 그대로 쓴다.</summary>
        private static List<cGridCell> Snapshot(List<XmlElement> pRows)
        {
            List<cGridCell> all = new List<cGridCell>();
            for (int r = 0; r < pRows.Count; r++)
                foreach (XmlElement tc in ChildElements(pRows[r], "tc"))
                {
                    // ★ Find 를 쓰면 안 된다 — 그것은 자손까지 뒤져서, 칸 안에 표가 또 있으면
                    //   <b>안쪽 표의 칸 번호</b>를 집어 온다(tc 안에서 subList 가 cellAddr 보다 앞에 있다).
                    XmlElement addr = Kid(tc, "cellAddr");
                    XmlElement span = Kid(tc, "cellSpan");
                    XmlElement size = Kid(tc, "cellSz");

                    all.Add(new cGridCell
                    {
                        Tag = tc,
                        R = Attr(addr, "rowAddr", r),
                        C = Attr(addr, "colAddr", all.Count),
                        Rs = Math.Max(1, Attr(span, "rowSpan", 1)),
                        Cs = Math.Max(1, Attr(span, "colSpan", 1)),
                        W = Attr(size, "width", 1000),
                        H = Attr(size, "height", 1000)
                    });
                }
            return all;
        }

        private static int Attr(XmlElement pEl, string pName, int pFallback)
        {
            if (pEl == null) return pFallback;
            XmlAttribute a = pEl.Attributes[pName];
            int v;
            if (a == null || !int.TryParse(a.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) return pFallback;
            return v;
        }

        /// <summary>행을 전부 새로 쌓는다 — 넣고 뺀 뒤 행마다 칸 수가 달라져 자리바꿈으로는 안 맞는다.</summary>
        private static void Rebuild(XmlElement pTable, List<XmlElement> pRows, List<cGridCell> pCells)
        {
            long pNextId = NextParagraphIdDeep(pTable.OwnerDocument);
            cTableWriter.SortGrid(pCells);
            int rows = cTableWriter.GridRows(pCells), cols = cTableWriter.GridCols(pCells);

            // 행 껍데기의 본. 속성(있다면)을 물려받으려고 원본 하나를 빈 채로 복제해 둔다.
            XmlElement shell = (XmlElement)pRows[0].CloneNode(false);

            foreach (XmlElement tr in pRows)
            {
                // ★ 칸을 먼저 떼어 낸다. 행째 지우면 그 안의 tc 가 문서에서 같이 빠져 다시 못 쓴다.
                foreach (XmlElement tc in ChildElements(tr, "tc")) tr.RemoveChild(tc);
                pTable.RemoveChild(tr);
            }

            for (int r = 0; r < rows; r++)
            {
                XmlElement tr = (XmlElement)shell.CloneNode(false);
                foreach (cGridCell g in pCells)
                {
                    if (g.R != r) continue;
                    XmlElement tc = (XmlElement)g.Tag;

                    XmlElement addr = Kid(tc, "cellAddr"), span = Kid(tc, "cellSpan"), size = Kid(tc, "cellSz");
                    Set(addr, "rowAddr", g.R);
                    Set(addr, "colAddr", g.C);
                    Set(span, "rowSpan", g.Rs);
                    Set(span, "colSpan", g.Cs);
                    Set(size, "width", g.W);
                    Set(size, "height", g.H);

                    // ★ 새로 뜬 칸은 본뜬 칸을 통째로 복제한 것이라 <b>문단 id 까지 같다</b>.
                    //   그대로 두면 한 문서에 같은 hp:p@id 가 둘 생긴다.
                    // ★ 줄 폭도 고쳐야 한다 — ClearCell 은 기본값(쪽 폭)을 넣어 두므로,
                    //   폭 3000 짜리 칸에 쪽 폭짜리 줄이 박힌다.
                    if (g.Made) FixMadeCell(tc, g, ref pNextId);

                    tr.AppendChild(tc);
                }
                pTable.AppendChild(tr);
            }

            pTable.SetAttribute("rowCnt", Str(rows));
            pTable.SetAttribute("colCnt", Str(cols));
        }

        /// <summary>바로 아래 자식만 본다. 자손까지 뒤지는 <see cref="Find"/> 와 다르다.</summary>
        private static int NumI(XmlElement pEl, string pName, int pDefault)
        {
            if (pEl == null) return pDefault;
            XmlAttribute at = pEl.Attributes[pName];
            int v;
            return (at != null && int.TryParse(at.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) ? v : pDefault;
        }

        /* 여백 자식이 아예 없는 문서가 있다(hasMargin="0"). 없다고 건너뛰면 걸어 준 여백이 조용히 사라진다. */
        private static XmlElement KidOrMake(XmlElement pParent, string pLocal, string pAfter)
        {
            XmlElement got = Kid(pParent, pLocal);
            if (got != null) return got;

            XmlElement made = Margin(pParent.OwnerDocument, pParent.Prefix, pParent.NamespaceURI, pLocal, 0, 0, 0, 0);
            XmlElement at = Kid(pParent, pAfter);
            if (at != null) pParent.InsertAfter(made, at); else pParent.AppendChild(made);
            return made;
        }

        private static XmlElement Kid(XmlNode pNode, string pLocal)
        {
            foreach (XmlNode n in pNode.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e != null && e.LocalName == pLocal) return e;
            }
            return null;
        }

        private static void FixMadeCell(XmlElement pCell, cGridCell pGrid, ref long pNextId)
        {
            XmlElement mg = Kid(pCell, "cellMargin");
            long inner = pGrid.W - Attr(mg, "left", 0) - Attr(mg, "right", 0);
            if (inner < 200) inner = 200;

            XmlElement sub = Kid(pCell, "subList");
            if (sub == null) return;

            foreach (XmlElement p in ChildElements(sub, "p"))
            {
                p.SetAttribute("id", Str(pNextId++));
                foreach (XmlElement arr in ChildElements(p, "linesegarray"))
                    foreach (XmlElement seg in ChildElements(arr, "lineseg"))
                        seg.SetAttribute("horzsize", Str(inner));
            }
        }

        /// <summary>문서에 있는 가장 큰 <c>hp:p@id</c> 다음 값. ★ 칸 안까지 훑는다.</summary>
        private static long NextParagraphIdDeep(XmlDocument pDoc)
        {
            long max = 0;
            XmlNodeList all = pDoc.GetElementsByTagName("*");
            foreach (XmlNode n in all)
            {
                XmlElement e = n as XmlElement;
                if (e == null || e.LocalName != "p") continue;
                XmlAttribute a = e.Attributes["id"];
                long v;
                if (a != null && long.TryParse(a.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out v) && v > max) max = v;
            }
            return max + 1;
        }

        private static void Set(XmlElement pEl, string pName, long pValue)
        {
            if (pEl != null) pEl.SetAttribute(pName, Str(pValue));
        }

        /// <summary>
        /// 표 바깥 크기를 <b>격자에서 다시 낸다</b>(hwp 쪽 <c>cTableWriter.Resize</c> 와 같은 규칙).
        /// ★ "얼마 늘었다" 를 더하고 빼면 빈 행 접기까지 얹혔을 때 값이 갈래마다 달라진다.
        /// </summary>
        private static void Resize(XmlElement pTable, List<cGridCell> pCells)
        {
            XmlElement sz = Kid(pTable, "sz");
            if (sz == null) return;
            sz.SetAttribute("width", Str(cTableWriter.GridWidth(pCells)));
            sz.SetAttribute("height", Str(cTableWriter.GridHeight(pCells)));
        }

        private static XmlElement EmptyCellLike(XmlElement pCell)
        {
            XmlElement made = (XmlElement)pCell.CloneNode(true);
            ClearCell(made);
            return made;
        }

        private static void ClearCell(XmlElement pCell)
        {
            XmlElement sub = null;
            foreach (XmlElement e in ChildElements(pCell, "subList")) { sub = e; break; }
            if (sub == null) return;

            List<XmlElement> paras = ChildElements(sub, "p");
            for (int i = 1; i < paras.Count; i++) sub.RemoveChild(paras[i]);
            if (paras.Count == 0) return;

            XmlElement keep = paras[0];
            List<XmlElement> runs = ChildElements(keep, "run");
            string cs = runs.Count > 0 && runs[0].Attributes["charPrIDRef"] != null
                      ? runs[0].Attributes["charPrIDRef"].Value : "0";

            while (keep.FirstChild != null) keep.RemoveChild(keep.FirstChild);
            XmlElement run = keep.OwnerDocument.CreateElement(keep.Prefix, "run", keep.NamespaceURI);
            run.SetAttribute("charPrIDRef", cs);
            keep.AppendChild(run);
            WriteLineSeg(keep, new EditOp());
        }

        /// <summary>
        /// ★ <b>직계 자식만</b> 본다. <see cref="Find"/> 는 재귀라, 표나 묶음 개체에 걸면 안쪽 자식의
        ///   <c>sz</c> 를 고쳐 엉뚱한 개체가 늘어난다(리더가 표 칸 번호에서 겪은 함정과 같다).
        /// ★ 원본에 없는 요소는 <b>만들지 않는다</b>. OWPML 은 자식 차례가 정해져 있어서 아무 데나
        ///   끼워 넣으면 저장은 되고 여는 쪽에서만 깨진다.
        /// ★ 원본 그림의 사각형(<c>orgSz</c>·<c>imgRect</c>·<c>imgClip</c>·<c>imgDim</c>)은 그대로 둔다 —
        ///   같이 바꾸면 그림이 늘어난 게 아니라 잘린다.
        /// </summary>
        private static void ApplyGeom(XmlElement pEl, EditObj pObj)
        {
            if (pEl == null || pObj == null || !pObj.HasGeom) return;

            XmlElement sz = Kid(pEl, "sz");
            if (sz != null)
            {
                // 크기 기준이 RELATIVE 로 남아 있으면 우리가 적은 숫자가 무시된다.
                if (pObj.WHu.HasValue) { sz.SetAttribute("width", Str(pObj.WHu.Value)); sz.SetAttribute("widthRelTo", "ABSOLUTE"); }
                if (pObj.HHu.HasValue) { sz.SetAttribute("height", Str(pObj.HHu.Value)); sz.SetAttribute("heightRelTo", "ABSOLUTE"); }
            }

            XmlElement pos = Kid(pEl, "pos");
            if (pos != null)
            {
                if (pObj.XOffHu.HasValue) pos.SetAttribute("horzOffset", Str(pObj.XOffHu.Value));
                if (pObj.YOffHu.HasValue) pos.SetAttribute("vertOffset", Str(pObj.YOffHu.Value));

                // ★ 글자처럼 취급하는가. 기준(relTo)까지 같이 못 박는다 — 하나만 바꾸면
                //   저장은 되고 여는 쪽에서만 깨진다(MakePicture 가 새로 만들 때와 같은 조합).
                if (pObj.Inline.HasValue)
                {
                    pos.SetAttribute("treatAsChar", pObj.Inline.Value ? "1" : "0");
                    pos.SetAttribute("horzRelTo", "COLUMN");
                    pos.SetAttribute("vertRelTo", "PARA");
                }
            }

            if (!pObj.WHu.HasValue && !pObj.HHu.HasValue) return;

            XmlElement cur = Kid(pEl, "curSz");
            if (cur != null)
            {
                if (pObj.WHu.HasValue) cur.SetAttribute("width", Str(pObj.WHu.Value));
                if (pObj.HHu.HasValue) cur.SetAttribute("height", Str(pObj.HHu.Value));
            }

            XmlElement rot = Kid(pEl, "rotationInfo");
            if (rot != null)
            {
                if (pObj.WHu.HasValue) rot.SetAttribute("centerX", Str(pObj.WHu.Value / 2));
                if (pObj.HHu.HasValue) rot.SetAttribute("centerY", Str(pObj.HHu.Value / 2));
            }
        }

        private static XmlElement Find(XmlNode pNode, string pLocal)
        {
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

        #endregion

        #region 새 그림

        /// <summary>
        /// <c>hp:pic</c> 하나를 만든다. 실물은 <see cref="cHwpxDocument.AddImage"/> 가 묶음에 넣고
        /// 여기서는 그 id 를 <c>hc:img/@binaryItemIDRef</c> 로 가리킨다.
        ///
        /// ★ 우리 리더가 다시 읽을 때 크기를 보는 곳은 <c>hp:sz</c>, 글자처럼 취급인지 보는 곳은
        ///   <c>hp:pos/@treatAsChar</c> 다 — 이 둘이 틀리면 저장은 되는데 다시 열었을 때 자리가 어긋난다.
        /// </summary>
        /// <summary>
        /// 새 표 하나(<c>hp:tbl</c>). 격자·크기는 <b>화면이 보낸 칸 목록 그대로</b> 쓴다.
        ///
        /// ★ hwpx 표본에 표가 <b>하나도 없다</b>(TODO 2) — 이 요소들은 OWPML 명세를 보고 세운 것이고
        ///   우리 리더 왕복으로만 검증된다. 한글이 실제로 여는지는 그림이 든 hwpx 표본이 생겨야 잰다.
        /// ★ 문단 id 는 <b>한 번 받아 세어 나간다</b>. 칸마다 NextParagraphIdDeep 을 다시 부르면 아직
        ///   문서에 안 붙은 앞 칸의 문단을 못 봐서 같은 id 가 여럿 생긴다.
        /// </summary>
        private static XmlElement MakeTable(cHwpxDocument pDoc, cHwpxIndex pIndex, XmlElement pP, EditOp pOp,
                                            Dictionary<string, EditOp> pImages, SaveResult pResult)
        {
            List<CellModel> cells = pOp.Cells;
            if (cells == null || cells.Count == 0) throw new InvalidOperationException("새 표에 칸이 하나도 없다");

            int rows = Math.Max(1, pOp.Rows), cols = Math.Max(1, pOp.Cols);
            XmlDocument xd = pP.OwnerDocument;
            string px = pP.Prefix, ns = pP.NamespaceURI;

            long wAll = 0, hAll = 0;
            foreach (CellModel cm in cells)
            {
                if (cm.R == 0) wAll += cm.WHu;
                if (cm.C == 0) hAll += cm.HHu;
            }

            XmlElement tbl = xd.CreateElement(px, "tbl", ns);
            tbl.SetAttribute("id", NewObjectId(xd));
            tbl.SetAttribute("zOrder", "0");
            tbl.SetAttribute("numberingType", "TABLE");
            tbl.SetAttribute("textWrap", "TOP_AND_BOTTOM");
            tbl.SetAttribute("textFlow", "BOTH_SIDES");
            tbl.SetAttribute("lock", "0");
            tbl.SetAttribute("dropcapstyle", "None");
            /* ★ 표 서식도 여기서 받는다 — 새 표에는 tableFmt 를 보낼 길이 없다(oid 가 아직 없다). */
            tbl.SetAttribute("pageBreak", !pOp.Divide.HasValue ? "CELL"
                : pOp.Divide.Value == 1 ? "CELL" : pOp.Divide.Value == 2 ? "TABLE" : "NONE");
            tbl.SetAttribute("repeatHeader", pOp.RepeatHeader.HasValue && pOp.RepeatHeader.Value ? "1" : "0");
            tbl.SetAttribute("rowCnt", Str(rows));
            tbl.SetAttribute("colCnt", Str(cols));
            tbl.SetAttribute("cellSpacing", "0");
            tbl.SetAttribute("borderFillIDRef", pOp.Bf.HasValue && pOp.Bf.Value > 0
                ? Str(cShapeWriter.Map(cShapes == null ? null : cShapes.Bf, pOp.Bf.Value))
                : Str(cHwpxShapeWriter.TableBorderFill(pDoc.Header)));
            tbl.SetAttribute("noAdjust", "0");

            XmlElement sz = El(xd, px, ns, "sz", "width", Str(wAll), "height", Str(hAll));
            sz.SetAttribute("widthRelTo", "ABSOLUTE");
            sz.SetAttribute("heightRelTo", "ABSOLUTE");
            sz.SetAttribute("protect", "0");
            tbl.AppendChild(sz);

            XmlElement pos = xd.CreateElement(px, "pos", ns);
            pos.SetAttribute("treatAsChar", "1");
            pos.SetAttribute("affectLSpacing", "0");
            pos.SetAttribute("flowWithText", "1");
            pos.SetAttribute("allowOverlap", "0");
            pos.SetAttribute("holdAnchorAndSO", "0");
            pos.SetAttribute("vertRelTo", "PARA");
            pos.SetAttribute("horzRelTo", "COLUMN");
            pos.SetAttribute("vertAlign", "TOP");
            pos.SetAttribute("horzAlign", "LEFT");
            pos.SetAttribute("vertOffset", "0");
            pos.SetAttribute("horzOffset", "0");
            tbl.AppendChild(pos);

            tbl.AppendChild(Margin(xd, px, ns, "outMargin",
                pOp.OmL ?? 0, pOp.OmR ?? 0, pOp.OmT ?? 0, pOp.OmB ?? 0));
            tbl.AppendChild(Margin(xd, px, ns, "inMargin", 0, 0, 0, 0));

            long nextId = NextParagraphIdDeep(xd);
            for (int r = 0; r < rows; r++)
            {
                XmlElement tr = xd.CreateElement(px, "tr", ns);
                foreach (CellModel cm in cells)
                {
                    if (cm.R != r) continue;
                    tr.AppendChild(MakeCell(pDoc, pIndex, pP, cm, pImages, pResult, ref nextId));
                }
                tbl.AppendChild(tr);
            }
            return tbl;
        }

        private static XmlElement Margin(XmlDocument pXml, string pPrefix, string pNs, string pLocal,
                                         long pL, long pR, long pT, long pB)
        {
            XmlElement e = El(pXml, pPrefix, pNs, pLocal, "left", Str(pL), "right", Str(pR), "top", Str(pT));
            e.SetAttribute("bottom", Str(pB));
            return e;
        }

        private static XmlElement MakeCell(cHwpxDocument pDoc, cHwpxIndex pIndex, XmlElement pP, CellModel pModel,
                                           Dictionary<string, EditOp> pImages, SaveResult pResult, ref long pNextId)
        {
            XmlDocument xd = pP.OwnerDocument;
            string px = pP.Prefix, ns = pP.NamespaceURI;

            XmlElement tc = xd.CreateElement(px, "tc", ns);
            tc.SetAttribute("name", "");
            tc.SetAttribute("hasMargin", "0");
            tc.SetAttribute("protect", "0");
            tc.SetAttribute("editable", "0");
            tc.SetAttribute("dirty", "0");

            /* 칸이 자기 테두리를 들고 오면 그것을 쓴다 — 새 표에는 cellFmt 를 못 보낸다(oid 가 아직 없다). */
            tc.SetAttribute("borderFillIDRef", pModel.Bf > 0
                ? Str(cShapeWriter.Map(cShapes == null ? null : cShapes.Bf, pModel.Bf))
                : Str(cHwpxShapeWriter.TableBorderFill(pDoc.Header)));
            tc.SetAttribute("header", pModel.Head ? "1" : "0");

            tc.AppendChild(El(xd, px, ns, "cellAddr", "colAddr", Str(pModel.C), "rowAddr", Str(pModel.R)));
            tc.AppendChild(El(xd, px, ns, "cellSpan", "colSpan", Str(Math.Max(1, pModel.Cs)),
                                                     "rowSpan", Str(Math.Max(1, pModel.Rs))));
            tc.AppendChild(El(xd, px, ns, "cellSz", "width", Str(pModel.WHu), "height", Str(pModel.HHu)));
            tc.AppendChild(Margin(xd, px, ns, "cellMargin", pModel.MlHu, pModel.MrHu, pModel.MtHu, pModel.MbHu));

            XmlElement sub = xd.CreateElement(px, "subList", ns);
            sub.SetAttribute("id", "");
            sub.SetAttribute("textDirection", "HORIZONTAL");
            sub.SetAttribute("lineWrap", "BREAK");
            sub.SetAttribute("vertAlign", pModel.Valign == 1 ? "CENTER" : pModel.Valign == 2 ? "BOTTOM" : "TOP");
            sub.SetAttribute("linkListIDRef", "0");
            sub.SetAttribute("linkListNextIDRef", "0");
            sub.SetAttribute("textWidth", "0");
            sub.SetAttribute("textHeight", "0");
            sub.SetAttribute("hasTextRef", "0");
            sub.SetAttribute("hasNumRef", "0");
            tc.AppendChild(sub);

            long inner = Math.Max(200, pModel.WHu - pModel.MlHu - pModel.MrHu);
            List<ParagraphModel> paras = pModel.Paras;
            if (paras == null || paras.Count == 0) { paras = new List<ParagraphModel>(); paras.Add(new ParagraphModel()); }

            foreach (ParagraphModel pm in paras)
            {
                // ★ 새로 만들지 않고 <b>바깥 문단을 복제</b>한다 — styleIDRef 같은 속성이 빠지면 그 칸만
                //   다르게 보인다(ApplyInsertAfter 와 같은 이유). 구역·단 정의는 떼어 낸다.
                XmlElement np = (XmlElement)pP.CloneNode(true);
                StripCarried(np);
                np.SetAttribute("id", Str(pNextId++));
                sub.AppendChild(np);

                EditOp one = new EditOp { Op = "replace", Id = np.GetAttribute("id"), Ps = pm.Ps, Runs = pm.Runs };
                Rewrite(pDoc, pIndex, np, one, pImages, pResult);

                // 줄 폭은 칸 안쪽 폭이다 — WriteLineSeg 의 기본값(쪽 폭)이 그대로 박히면 안 된다.
                foreach (XmlElement arr in ChildElements(np, "linesegarray"))
                    foreach (XmlElement seg in ChildElements(arr, "lineseg"))
                        seg.SetAttribute("horzsize", Str(inner));
            }
            return tc;
        }

        private static XmlElement MakePicture(cHwpxDocument pDoc, XmlElement pP, EditOp pImg)
        {
            byte[] data = File.ReadAllBytes(pImg.File);
            string ext = (System.IO.Path.GetExtension(pImg.File) ?? ".png").TrimStart('.').ToLowerInvariant();
            string refId = pDoc.AddImage(data, ext);

            int pw, ph;
            cImageStore.PixelSize(data, out pw, out ph);

            // 화면 픽셀 → HWPUNIT 은 96dpi 기준 75배다.
            long natW = pw > 0 ? pw * 75L : 0;
            long natH = ph > 0 ? ph * 75L : 0;
            long w = pImg.WHu > 0 ? pImg.WHu : (natW > 0 ? natW : 20000);
            long h = pImg.HHu > 0 ? pImg.HHu : (natH > 0 ? natH : 15000);
            if (natW <= 0) natW = w;
            if (natH <= 0) natH = h;

            XmlDocument xd = pP.OwnerDocument;
            string px = pP.Prefix, ns = pP.NamespaceURI;
            string hcPrefix = xd.DocumentElement.GetPrefixOfNamespace(cCoreNs);
            if (string.IsNullOrEmpty(hcPrefix)) hcPrefix = "hc";

            XmlElement pic = xd.CreateElement(px, "pic", ns);
            pic.SetAttribute("id", NewObjectId(xd));
            pic.SetAttribute("zOrder", "0");
            pic.SetAttribute("numberingType", "PICTURE");
            pic.SetAttribute("textWrap", "TOP_AND_BOTTOM");
            pic.SetAttribute("textFlow", "BOTH_SIDES");
            pic.SetAttribute("lock", "0");
            pic.SetAttribute("dropcapstyle", "None");
            pic.SetAttribute("href", "");
            pic.SetAttribute("groupLevel", "0");
            pic.SetAttribute("instid", NewObjectId(xd));
            pic.SetAttribute("reverse", "0");

            pic.AppendChild(El(xd, px, ns, "offset", "x", "0", "y", "0"));
            pic.AppendChild(El(xd, px, ns, "orgSz", "width", Str(natW), "height", Str(natH)));
            pic.AppendChild(El(xd, px, ns, "curSz", "width", Str(w), "height", Str(h)));
            pic.AppendChild(El(xd, px, ns, "flip", "horizontal", "0", "vertical", "0"));

            XmlElement rot = El(xd, px, ns, "rotationInfo", "angle", "0", "centerX", Str(w / 2), "centerY", Str(h / 2));
            rot.SetAttribute("rotateimage", "1");
            pic.AppendChild(rot);

            XmlElement render = xd.CreateElement(px, "renderingInfo", ns);
            render.AppendChild(Matrix(xd, hcPrefix, "transMatrix"));
            render.AppendChild(Matrix(xd, hcPrefix, "scaMatrix"));
            render.AppendChild(Matrix(xd, hcPrefix, "rotMatrix"));
            pic.AppendChild(render);

            XmlElement img = xd.CreateElement(hcPrefix, "img", cCoreNs);
            img.SetAttribute("binaryItemIDRef", refId);
            img.SetAttribute("bright", "0");
            img.SetAttribute("contrast", "0");
            img.SetAttribute("effect", "REAL_PIC");
            img.SetAttribute("alpha", "0");
            pic.AppendChild(img);

            XmlElement rect = xd.CreateElement(px, "imgRect", ns);
            rect.AppendChild(El(xd, hcPrefix, cCoreNs, "pt0", "x", "0", "y", "0"));
            rect.AppendChild(El(xd, hcPrefix, cCoreNs, "pt1", "x", Str(natW), "y", "0"));
            rect.AppendChild(El(xd, hcPrefix, cCoreNs, "pt2", "x", Str(natW), "y", Str(natH)));
            rect.AppendChild(El(xd, hcPrefix, cCoreNs, "pt3", "x", "0", "y", Str(natH)));
            pic.AppendChild(rect);

            XmlElement clip = El(xd, px, ns, "imgClip", "left", "0", "right", Str(natW));
            clip.SetAttribute("top", "0");
            clip.SetAttribute("bottom", Str(natH));
            pic.AppendChild(clip);

            XmlElement inm = El(xd, px, ns, "inMargin", "left", "0", "right", "0");
            inm.SetAttribute("top", "0");
            inm.SetAttribute("bottom", "0");
            pic.AppendChild(inm);

            pic.AppendChild(El(xd, px, ns, "imgDim", "dimwidth", Str(natW), "dimheight", Str(natH)));

            XmlElement sz = El(xd, px, ns, "sz", "width", Str(w), "height", Str(h));
            sz.SetAttribute("widthRelTo", "ABSOLUTE");
            sz.SetAttribute("heightRelTo", "ABSOLUTE");
            sz.SetAttribute("protect", "0");
            pic.AppendChild(sz);

            XmlElement pos = xd.CreateElement(px, "pos", ns);
            pos.SetAttribute("treatAsChar", "1");
            pos.SetAttribute("affectLSpacing", "0");
            pos.SetAttribute("flowWithText", "1");
            pos.SetAttribute("allowOverlap", "0");
            pos.SetAttribute("holdAnchorAndSO", "0");
            pos.SetAttribute("vertRelTo", "PARA");
            pos.SetAttribute("horzRelTo", "COLUMN");
            pos.SetAttribute("vertAlign", "TOP");
            pos.SetAttribute("horzAlign", "LEFT");
            pos.SetAttribute("vertOffset", "0");
            pos.SetAttribute("horzOffset", "0");
            pic.AppendChild(pos);

            XmlElement outm = El(xd, px, ns, "outMargin", "left", "0", "right", "0");
            outm.SetAttribute("top", "0");
            outm.SetAttribute("bottom", "0");
            pic.AppendChild(outm);

            return pic;
        }

        private static XmlElement Matrix(XmlDocument pXml, string pPrefix, string pLocal)
        {
            XmlElement m = pXml.CreateElement(pPrefix, pLocal, cCoreNs);
            m.SetAttribute("e1", "1"); m.SetAttribute("e2", "0"); m.SetAttribute("e3", "0");
            m.SetAttribute("e4", "0"); m.SetAttribute("e5", "1"); m.SetAttribute("e6", "0");
            return m;
        }

        private static XmlElement El(XmlDocument pXml, string pPrefix, string pNs, string pLocal,
                                     string pA1, string pV1, string pA2, string pV2)
        {
            XmlElement e = pXml.CreateElement(pPrefix, pLocal, pNs);
            e.SetAttribute(pA1, pV1);
            e.SetAttribute(pA2, pV2);
            return e;
        }

        private static XmlElement El(XmlDocument pXml, string pPrefix, string pNs, string pLocal,
                                     string pA1, string pV1, string pA2, string pV2, string pA3, string pV3)
        {
            XmlElement e = El(pXml, pPrefix, pNs, pLocal, pA1, pV1, pA2, pV2);
            e.SetAttribute(pA3, pV3);
            return e;
        }

        private static string NewObjectId(XmlDocument pXml)
        {
            cObjIdSeed++;
            return (1000000000 + cObjIdSeed).ToString(CultureInfo.InvariantCulture);
        }

        private static int cObjIdSeed;

        #endregion
    }
}
