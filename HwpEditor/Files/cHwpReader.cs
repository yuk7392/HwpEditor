using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using HwpEditor.Models;
using HwpLib.Object;
using HwpLib.Object.BodyText;
using HwpLib.Object.BodyText.Control;
using HwpLib.Object.BodyText.Control.CtrlHeader;
using HwpLib.Object.BodyText.Control.Gso;
using HwpLib.Object.BodyText.Control.SectionDefine;
using HwpLib.Object.BodyText.Control.Table;
using HwpLib.Object.BodyText.Paragraph;
using HwpLib.Object.BodyText.Paragraph.CharShape;
using HwpLib.Object.BodyText.Paragraph.LineSeg;
using HwpLib.Object.BodyText.Paragraph.Text;
using HwpLib.Object.DocInfo;
using HwpLib.Object.DocInfo.ParaShape;

namespace HwpEditor.Files
{
    /// <summary>.hwp(5.0 바이너리) → <see cref="DocModel"/>.</summary>
    public static class cHwpReader
    {
        public static DocModel Read(HWPFile pFile, string pPath)
        {
            DocModel doc = new DocModel();
            doc.Format = "hwp5";
            doc.Path = pPath;
            doc.Rev = 1;

            ReadFaceNames(pFile.DocInfo, doc);
            ReadCharShapes(pFile.DocInfo, doc);
            ReadParaShapes(pFile.DocInfo, doc);

            for (int i = 0; i < pFile.BodyText.SectionList.Count; i++)
                doc.Sections.Add(ReadSection(pFile.BodyText.SectionList[i], i));

            // ★ 쪽 넘김은 문서 전체로 이어서 센다. 섹션마다 기준을 리셋하면 섹션 경계의 쪽 넘김을
            //   놓친다(실측 — lists.hwp 는 2섹션이라 3쪽인데 2쪽으로 셌다).
            MarkPageBreaks(doc);
            return doc;
        }

        #region DocInfo

        private static void ReadFaceNames(DocInfo pInfo, DocModel pDoc)
        {
            IReadOnlyList<FaceNameInfo> list = pInfo.HangulFaceNameList;
            for (int i = 0; i < list.Count; i++)
            {
                FaceNameModel m = new FaceNameModel();
                m.Id = i;
                m.Name = list[i].Name;
                m.Sub = cFontMap.Substitute(list[i].Name);
                pDoc.FaceNames.Add(m);
            }
        }

        private static void ReadCharShapes(DocInfo pInfo, DocModel pDoc)
        {
            IReadOnlyList<CharShapeInfo> list = pInfo.CharShapeList;
            for (int i = 0; i < list.Count; i++)
            {
                CharShapeInfo s = list[i];
                CharShapeModel m = new CharShapeModel();
                m.Id = i;
                m.Face = s.FaceNameIds.Hangul;
                m.SizeHu = s.BaseSize;
                m.Bold = s.Property.IsBold;
                m.Italic = s.Property.IsItalic;
                m.Underline = (int)s.Property.UnderLineSort;
                m.Strike = s.Property.IsStrikeLine;
                m.Color = Hex(s.CharColor);
                m.Ratio = s.Ratios.Hangul;
                m.Spacing = s.CharSpaces.Hangul;
                pDoc.CharShapes.Add(m);
            }
        }

        private static void ReadParaShapes(DocInfo pInfo, DocModel pDoc)
        {
            IReadOnlyList<ParaShapeInfo> list = pInfo.ParaShapeList;
            for (int i = 0; i < list.Count; i++)
            {
                ParaShapeInfo s = list[i];
                ParaShapeModel m = new ParaShapeModel();
                m.Id = i;
                m.Align = AlignName(s.Property1.Alignment);
                m.IndentHu = Half(s.Indent);
                m.MlHu = Half(s.LeftMargin);
                m.MrHu = Half(s.RightMargin);
                m.MtHu = Half(s.TopParaSpace);
                m.MbHu = Half(s.BottomParaSpace);
                m.LsType = LineSpaceName(s.Property1.LineSpaceSort);

                // ★ 줄간격 값도 여백과 같은 2배 단위다(실측 — linespacing.hwp 에서 고정 2000 인 문단의
                //   실제 줄 간격이 1000, 고정 3000 이 1500, 여백 1000 이 글자높이+500 이었다).
                //   단 percent 는 길이가 아니라 백분율이라 그대로 둔다.
                m.Ls = m.LsType == "percent" ? s.LineSpace : Half(s.LineSpace);
                m.LatinBreak = LatinBreakName(s.Property1.LineDivideForEnglish);
                m.HangulByWord = s.Property1.LineDivideForHangul == LineDivideForHangul.ByWord;
                pDoc.ParaShapes.Add(m);
            }
        }

        /// <summary>
        /// 문단 앞의 강제 나눔. 섹션 &gt; 쪽 &gt; 단 순으로 센 것을 하나만 준다 — 섹션 나눔이면
        /// 쪽도 같이 넘어가므로 둘을 다 표시할 필요가 없다.
        /// </summary>
        private static string DivideName(HwpLib.Object.BodyText.Paragraph.Header.DivideSort pSort)
        {
            if (pSort == null) return null;
            if (pSort.IsDivideSection) return "section";
            if (pSort.IsDividePage) return "page";
            if (pSort.IsDivideColumn || pSort.IsDivideMultiColumn) return "column";
            return null;
        }

        /// <summary>
        /// 문단모양의 여백·들여쓰기를 lineseg 와 같은 좌표계(HWPUNIT)로 바꾼다.
        ///
        /// ★ <b>실측(2026-09-07)</b>: ParaShape 의 왼쪽·오른쪽 여백과 문단 위·아래 간격은
        ///   lineseg 좌표의 <b>정확히 2배</b>로 들어 있다. 샘플 36개에서 왼쪽 여백이 0 이 아닌
        ///   문단 90개를 훑어 <c>seg[0].x</c> 와 비교했더니 <b>71개가 ml/2 와 일치, ml 과 일치는 0개</b>였다
        ///   (나머지 19개는 basicsReport 의 번호 문단이라 문단 머리 들여쓰기가 따로 얹혀 있다).
        ///   parashape.hwp 한 문단에서 네 필드가 동시에 맞아떨어진 것도 같은 결론이다 —
        ///   ml 2200→x 1100, mr 2400→폭 40220, mt 2600→첫 y 1300, mb 2800→문단 사이 +1400.
        ///
        /// ★ 들여쓰기(Indent)는 seg 에 안 실려 직접 대조할 수 없다. 같은 레코드의 이웃 필드이고
        ///   단위가 갈릴 이유가 없어 같이 반으로 줄인다.
        /// </summary>
        private static int Half(int pValue)
        {
            return pValue / 2;
        }

        private static string Hex(HwpLib.Object.Etc.Color4Byte pColor)
        {
            if (pColor == null) return "#000000";
            return "#" + pColor.R.ToString("X2", CultureInfo.InvariantCulture)
                       + pColor.G.ToString("X2", CultureInfo.InvariantCulture)
                       + pColor.B.ToString("X2", CultureInfo.InvariantCulture);
        }

        private static string AlignName(Alignment pAlign)
        {
            switch (pAlign)
            {
                case Alignment.Left: return "left";
                case Alignment.Right: return "right";
                case Alignment.Center: return "center";
                case Alignment.Distribute: return "distribute";
                case Alignment.Divide: return "divide";
                default: return "justify";
            }
        }

        private static string LineSpaceName(LineSpaceSort pSort)
        {
            switch (pSort)
            {
                case LineSpaceSort.FixedValue: return "fixed";
                case LineSpaceSort.OnlyMargin: return "margin";
                case LineSpaceSort.AtLeast: return "atLeast";
                default: return "percent";
            }
        }

        private static string LatinBreakName(LineDivideForEnglish pSort)
        {
            switch (pSort)
            {
                case LineDivideForEnglish.ByHyphen: return "hyphen";
                case LineDivideForEnglish.ByLetter: return "letter";
                default: return "word";
            }
        }

        #endregion

        #region 섹션 · 문단

        private static SectionModel ReadSection(Section pSection, int pIdx)
        {
            SectionModel sec = new SectionModel();
            sec.Idx = pIdx;

            for (int i = 0; i < pSection.ParagraphCount; i++)
            {
                Paragraph p = pSection.GetParagraph(i);
                ApplySectionDefine(p, sec);
                sec.Paras.Add(ReadParagraph(p, "s" + pIdx + "p" + i));
            }

            return sec;
        }

        /// <summary>용지·단 정의는 문단에 붙은 secd·cold 컨트롤에 들어 있다.</summary>
        private static void ApplySectionDefine(Paragraph pPara, SectionModel pSec)
        {
            if (pPara.ControlList == null) return;
            foreach (Control c in pPara.ControlList)
            {
                ControlSectionDefine sd = c as ControlSectionDefine;
                if (sd != null && sd.PageDef != null)
                {
                    PageDef d = sd.PageDef;
                    pSec.Page.WHu = d.PaperWidth;
                    pSec.Page.HHu = d.PaperHeight;
                    pSec.Page.MlHu = d.LeftMargin;
                    pSec.Page.MrHu = d.RightMargin;
                    pSec.Page.MtHu = d.TopMargin;
                    pSec.Page.MbHu = d.BottomMargin;
                    pSec.Page.MhHu = d.HeaderMargin;
                    pSec.Page.MfHu = d.FooterMargin;
                    pSec.Page.GutHu = d.GutterMargin;
                    pSec.Page.Landscape = d.Property != null && d.Property.PaperDirection == PaperDirection.Landscape;
                    continue;
                }

                ControlColumnDefine cd = c as ControlColumnDefine;
                if (cd != null)
                {
                    CtrlHeaderColumnDefine h = cd.GetHeader();
                    if (h != null && h.Property != null)
                    {
                        short n = h.Property.GetColumnCount();
                        pSec.Cols.Count = n > 0 ? n : 1;
                        pSec.Cols.GapHu = h.GapBetweenColumn;
                    }
                }
            }
        }

        private static ParagraphModel ReadParagraph(Paragraph pPara, string pId)
        {
            ParagraphModel m = new ParagraphModel();
            m.Id = pId;
            m.Ps = pPara.Header.ParaShapeId;
            m.Brk = DivideName(pPara.Header.DivideSort);

            int[] rawToEdit;
            int editLen;
            BuildRuns(pPara, m, out rawToEdit, out editLen);
            m.Len = editLen;

            ReadObjects(pPara, m, rawToEdit);
            m.Seg = ReadLineSeg(pPara, rawToEdit);
            return m;
        }

        #endregion

        #region B-2 원시 인덱스 ↔ 편집 인덱스

        /// <summary>
        /// 문단 텍스트를 runs 로 만들면서 <b>원시 → 편집</b> 인덱스 변환표를 같이 만든다.
        ///
        /// ★ 계획 B-2 의 핵심이다. HWP 원시 인덱스에서 확장·인라인 컨트롤 문자는 <b>8글자</b>를 차지하지만
        ///   화면에서 개체는 <b>1글자</b>다. 이 표가 없으면 lineseg 의 시작 위치와 개체 위치가 통째로 밀려
        ///   긴 문단일수록 줄이 어긋난다(convert2pdf 의 Hwp5Parser.cs 가 같은 자리에서 겪은 버그).
        ///
        /// 반환하는 <paramref name="pRawToEdit"/>[i] 는 원시 인덱스 i 에 대응하는 편집 인덱스다.
        /// 배열 길이는 원시 글자 수 + 1 이고 마지막 칸이 곧 편집 길이다.
        /// </summary>
        private static void BuildRuns(Paragraph pPara, ParagraphModel pModel, out int[] pRawToEdit, out int pEditLen)
        {
            ParaText text = pPara.Text;
            IReadOnlyList<CharPositionShapeIdPair> shapes =
                pPara.CharShape == null ? null : pPara.CharShape.PositionShapeIdPairList;

            if (text == null || text.CharList.Count == 0)
            {
                pRawToEdit = new int[1];
                pEditLen = 0;
                return;
            }

            IReadOnlyList<HWPChar> chars = text.CharList;

            // 원시 인덱스는 글자 하나가 1 또는 8 을 차지한다 — 자리마다 누적해야 한다.
            int rawLen = 0;
            for (int i = 0; i < chars.Count; i++) rawLen += chars[i].CharSize;

            pRawToEdit = new int[rawLen + 1];

            StringBuilder buf = new StringBuilder();
            int curShape = shapes != null && shapes.Count > 0 ? (int)shapes[0].ShapeId : 0;
            int shapeIdx = 0;
            int raw = 0, edit = 0;

            for (int i = 0; i < chars.Count; i++)
            {
                HWPChar ch = chars[i];

                // 글자모양이 바뀌는 자리에서 run 을 끊는다. 위치는 원시 인덱스 기준이다.
                if (shapes != null)
                {
                    while (shapeIdx + 1 < shapes.Count && shapes[shapeIdx + 1].Position <= raw)
                    {
                        shapeIdx++;
                        int next = (int)shapes[shapeIdx].ShapeId;
                        if (next != curShape)
                        {
                            if (buf.Length > 0) { pModel.Runs.Add(NewRun(curShape, buf)); }
                            curShape = next;
                        }
                    }
                }

                for (int k = 0; k < ch.CharSize; k++) pRawToEdit[raw + k] = edit;

                switch (ch.Type)
                {
                    case HWPCharType.Normal:
                        buf.Append((char)ch.Code);
                        edit++;
                        break;

                    case HWPCharType.ControlChar:
                        // 9=탭, 10=줄바꿈, 13=문단 끝. 문단 끝은 모델에 담지 않는다.
                        if (ch.Code == 9) { buf.Append('\t'); edit++; }
                        else if (ch.Code == 10) { buf.Append('\n'); edit++; }
                        else if (ch.Code != 13) { edit++; buf.Append(' '); }
                        break;

                    default:
                        // 인라인·확장 컨트롤 = 개체 한 자리. 텍스트에는 안 넣고 편집 인덱스만 1 늘린다.
                        if (buf.Length > 0) { pModel.Runs.Add(NewRun(curShape, buf)); }
                        edit++;
                        break;
                }

                raw += ch.CharSize;
            }

            if (buf.Length > 0) pModel.Runs.Add(NewRun(curShape, buf));

            pRawToEdit[rawLen] = edit;
            pEditLen = edit;
        }

        private static RunModel NewRun(int pShapeId, StringBuilder pBuf)
        {
            RunModel r = new RunModel();
            r.Cs = pShapeId;
            r.Text = pBuf.ToString();
            pBuf.Length = 0;
            return r;
        }

        /// <summary>원시 인덱스를 편집 인덱스로. 범위를 벗어나면 양 끝으로 잘라 준다.</summary>
        private static int ToEdit(int[] pMap, long pRaw)
        {
            if (pMap == null || pMap.Length == 0) return 0;
            if (pRaw < 0) return 0;
            if (pRaw >= pMap.Length) return pMap[pMap.Length - 1];
            return pMap[pRaw];
        }

        #endregion

        #region 개체 · lineseg

        private static void ReadObjects(Paragraph pPara, ParagraphModel pModel, int[] pRawToEdit)
        {
            if (pPara.ControlList == null || pPara.ControlList.Count == 0) return;
            if (pPara.Text == null) return;

            IReadOnlyList<HWPChar> chars = pPara.Text.CharList;
            int raw = 0, ctlIdx = 0;

            for (int i = 0; i < chars.Count; i++)
            {
                HWPChar ch = chars[i];
                if (ch.Type == HWPCharType.ControlExtend)
                {
                    if (ctlIdx < pPara.ControlList.Count)
                    {
                        Control c = pPara.ControlList[ctlIdx];
                        InlineObjModel o = ToObject(c, pModel.Id, ctlIdx, ToEdit(pRawToEdit, raw));
                        if (o != null) pModel.Objs.Add(o);
                    }
                    ctlIdx++;
                }
                raw += ch.CharSize;
            }
        }

        private static InlineObjModel ToObject(Control pControl, string pParaId, int pIndex, int pPos)
        {
            if (pControl == null) return null;

            // 용지·단 정의는 화면에 그릴 개체가 아니다 — 섹션 속성으로 이미 흡수했다.
            if (pControl is ControlSectionDefine || pControl is ControlColumnDefine) return null;

            InlineObjModel o = new InlineObjModel();
            o.Pos = pPos;
            o.Oid = pParaId + "#" + pIndex;

            CtrlHeaderGso gso = pControl.GetHeader() as CtrlHeaderGso;
            if (gso != null)
            {
                o.WHu = gso.Width;
                o.HHu = gso.Height;
                o.XOffHu = gso.XOffset;
                o.YOffHu = gso.YOffset;
                if (gso.Property != null)
                {
                    o.Inline = gso.Property.IsLikeWord();
                    o.RelH = HorzName(gso.Property.GetHorzRelTo());
                    o.RelV = VertName(gso.Property.GetVertRelTo());
                    o.Flow = FlowName(gso.Property.GetTextFlowMethod());
                }
            }
            else
            {
                // Gso 머리말이 아닌 컨트롤(각주·필드 등)은 본문 흐름 안에 있다.
                o.Inline = true;
            }

            ControlPicture pic = pControl as ControlPicture;
            if (pic != null)
            {
                o.Kind = "image";
                return o;   // src 는 3단계에서 BinData 를 풀어 채운다
            }

            ControlTable tbl = pControl as ControlTable;
            if (tbl != null)
            {
                o.Kind = "table";
                o.Table = ToTable(tbl, o.Oid);
                return o;
            }

            // ★ 나머지는 opaque(계획 B-4) — 크기와 라벨만 갖고 회색 상자로 그린다.
            //   원본 Control 은 HWPFile 안에 그대로 남아 있으므로 저장할 때 손대지 않는다.
            o.Kind = "opaque";
            o.Ctrl = pControl.Type.ToString();
            o.Label = OpaqueLabel(pControl.Type);
            return o;
        }

        private static string FlowName(HwpLib.Object.BodyText.Control.CtrlHeader.Gso.TextFlowMethod pFlow)
        {
            switch (pFlow)
            {
                case HwpLib.Object.BodyText.Control.CtrlHeader.Gso.TextFlowMethod.TakePlace: return "takePlace";
                case HwpLib.Object.BodyText.Control.CtrlHeader.Gso.TextFlowMethod.BehindText: return "behind";
                case HwpLib.Object.BodyText.Control.CtrlHeader.Gso.TextFlowMethod.InFrontOfText: return "front";
                default: return "fit";
            }
        }

        private static string HorzName(HwpLib.Object.BodyText.Control.CtrlHeader.Gso.HorzRelTo pRel)
        {
            switch (pRel)
            {
                case HwpLib.Object.BodyText.Control.CtrlHeader.Gso.HorzRelTo.Paper: return "paper";
                case HwpLib.Object.BodyText.Control.CtrlHeader.Gso.HorzRelTo.Page: return "page";
                case HwpLib.Object.BodyText.Control.CtrlHeader.Gso.HorzRelTo.Column: return "column";
                default: return "para";
            }
        }

        private static string VertName(HwpLib.Object.BodyText.Control.CtrlHeader.Gso.VertRelTo pRel)
        {
            switch (pRel)
            {
                case HwpLib.Object.BodyText.Control.CtrlHeader.Gso.VertRelTo.Paper: return "paper";
                case HwpLib.Object.BodyText.Control.CtrlHeader.Gso.VertRelTo.Page: return "page";
                default: return "para";
            }
        }

        private static string OpaqueLabel(ControlType pType)
        {
            switch (pType)
            {
                case ControlType.Equation: return "수식";
                case ControlType.Footnote: return "각주";
                case ControlType.Endnote: return "미주";
                case ControlType.Header: return "머리말";
                case ControlType.Footer: return "꼬리말";
                case ControlType.Gso: return "그리기";
                case ControlType.HiddenComment: return "숨은설명";
                case ControlType.AutoNumber: return "번호";
                case ControlType.NewNumber: return "새번호";
                case ControlType.Bookmark: return "책갈피";
                default: return pType.ToString();
            }
        }

        private static TableModel ToTable(ControlTable pTable, string pOid)
        {
            TableModel t = new TableModel();

            // ★ 행 목록은 Table 이 아니라 ControlTable 이 들고 있다. Table 은 칸 여백·테두리 같은 속성만이다.
            IReadOnlyList<Row> rows = pTable.RowList;
            if (rows == null) return t;
            t.Rows = rows.Count;

            for (int r = 0; r < rows.Count; r++)
            {
                Row row = rows[r];
                if (row.CellList.Count > t.Cols) t.Cols = row.CellList.Count;

                for (int c = 0; c < row.CellList.Count; c++)
                {
                    Cell cell = row.CellList[c];
                    CellModel cm = new CellModel();
                    ListHeaderForCell h = cell.ListHeader;
                    if (h != null)
                    {
                        cm.R = h.RowIndex;
                        cm.C = h.ColIndex;
                        cm.Rs = h.RowSpan;
                        cm.Cs = h.ColSpan;
                        cm.WHu = h.Width;
                        cm.HHu = h.Height;
                    }
                    else { cm.R = r; cm.C = c; }

                    if (cell.ParagraphList != null)
                    {
                        Paragraph[] ps = cell.ParagraphList.GetParagraphs();
                        for (int k = 0; k < ps.Length; k++)
                            cm.Paras.Add(ReadParagraph(ps[k], pOid + "r" + cm.R + "c" + cm.C + "p" + k));
                    }

                    t.Cells.Add(cm);
                }
            }
            return t;
        }

        /// <summary>
        /// lineseg 를 편집 인덱스로 옮겨 담는다.
        /// ★ 이 값은 <b>한글이 계산해 저장해 둔 결과</b>다 — 우리 레이아웃의 채점 기준이므로
        ///   여기서 손대거나 보정하지 않는다.
        /// </summary>
        private static List<SegModel> ReadLineSeg(Paragraph pPara, int[] pRawToEdit)
        {
            ParaLineSeg seg = pPara.LineSeg;
            if (seg == null || seg.LineSegItemList.Count == 0) return null;

            List<SegModel> list = new List<SegModel>(seg.LineSegItemList.Count);
            foreach (LineSegItem it in seg.LineSegItemList)
            {
                SegModel m = new SegModel();
                m.S = ToEdit(pRawToEdit, it.TextStartPosition);
                m.Y = it.LineVerticalPosition;
                m.H = it.LineHeight;
                m.B = it.DistanceBaseLineToLineVerticalPosition;
                m.X = it.StartPositionFromColumn;
                m.W = it.SegmentWidth;
                list.Add(m);
            }
            return list;
        }

        /// <summary>
        /// 쪽 넘김 <b>힌트</b>. 원본이 어디서 쪽을 넘겼는지 표시해 둔다.
        ///
        /// ★ 파일의 <c>IsFirstLineAtPage</c>·<c>IsFirstLineAtColumn</c> 태그는 36개 샘플에서 전부 0 이라
        ///   못 쓴다(실측 — tag 값이 늘 0x00060000, 즉 줄의 처음·끝 비트뿐이다). 대신 두 가지로 센다:
        ///   <b>y 가 직전 줄보다 작아지는 자리</b>와 <b>두 번째 이후 섹션의 첫 줄</b>.
        ///
        /// ★ <b>다단 문서에서는 과다 계산된다</b> — 단이 넘어갈 때도 y 가 0 으로 돌아가는데
        ///   lineseg 만으로는 그것이 몇 번째 단인지 알 수 없다(x 는 단 기준 상대좌표라 늘 0 이다).
        ///   실측: multicolumns.hwp 는 2쪽인데 4번 리셋, multicolumns-layout.hwp 는 3쪽인데 7번.
        ///   그래서 이 값은 <b>쪽 수 판정에 쓰지 않는다</b> — 쪽 수 오라클은 convert2pdf CLI 다(계획 8절 ①).
        ///   단이 하나인 문서 33개에서는 CLI 쪽 수와 완전히 일치한다.
        /// </summary>
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
                        // 섹션이 바뀌면 쪽이 넘어간다. y 리셋과 같은 줄일 수 있으므로 한 번만 센다.
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
