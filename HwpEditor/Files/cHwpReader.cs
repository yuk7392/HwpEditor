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
    public static class cHwpReader
    {
        public static DocModel Read(HWPFile pFile, string pPath)
        {
            return Read(pFile, pPath, null);
        }

        /// <summary>
        /// <paramref name="pIndex"/> 를 주면 화면 id → 원본 객체 표를 같이 채운다(편집·저장이 쓴다).
        /// null 이면 읽기만 한다 — 오라클 통로는 표가 필요 없다.
        /// </summary>
        public static DocModel Read(HWPFile pFile, string pPath, cHwpIndex pIndex)
        {
            DocModel doc = new DocModel();
            doc.Format = "hwp5";
            doc.Path = pPath;
            doc.Rev = 1;

            if (pIndex != null) pIndex.Clear();

            ReadFaceNames(pFile.DocInfo, doc);
            ReadCharShapes(pFile.DocInfo, doc);
            ReadParaShapes(pFile.DocInfo, doc);

            for (int i = 0; i < pFile.BodyText.SectionList.Count; i++)
                doc.Sections.Add(ReadSection(pFile.BodyText.SectionList[i], i, pIndex));

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

        public static List<CharShapeModel> CharShapesOf(DocInfo pInfo)
        {
            DocModel tmp = new DocModel();
            ReadCharShapes(pInfo, tmp);
            return tmp.CharShapes;
        }

        public static List<ParaShapeModel> ParaShapesOf(DocInfo pInfo)
        {
            DocModel tmp = new DocModel();
            ReadParaShapes(pInfo, tmp);
            return tmp.ParaShapes;
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
            // ★ 단 나눔과 다단 나눔을 한 이름으로 묶으면 안 된다 — 되쓸 때 다단 나눔이 단 나눔으로
            //   바뀌어 그 문단부터 단 구성이 달라진다(고친 적 없는 성질이 조용히 바뀌는 자리다).
            if (pSort.IsDivideMultiColumn) return "multicolumn";
            if (pSort.IsDivideColumn) return "column";
            return null;
        }

        /// <summary>
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

        private static SectionModel ReadSection(Section pSection, int pIdx, cHwpIndex pIndex)
        {
            SectionModel sec = new SectionModel();
            sec.Idx = pIdx;

            for (int i = 0; i < pSection.ParagraphCount; i++)
            {
                Paragraph p = pSection.GetParagraph(i);
                ApplySectionDefine(p, sec);
                sec.Paras.Add(ReadParagraph(p, "s" + pIdx + "p" + i, pSection, pIndex));
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

        private static ParagraphModel ReadParagraph(Paragraph pPara, string pId, Section pSec, cHwpIndex pIndex)
        {
            return ReadParagraph(pPara, pId, pSec, pSec, pIndex);
        }

        private static ParagraphModel ReadParagraph(Paragraph pPara, string pId, Section pSec,
                                                    IParagraphList pList, cHwpIndex pIndex)
        {
            ParagraphModel m = new ParagraphModel();
            m.Id = pId;
            m.Ps = pPara.Header.ParaShapeId;
            m.Brk = DivideName(pPara.Header.DivideSort);

            if (pIndex != null) pIndex.Paras[pId] = new cParaRef(pPara, pSec, pList);

            int[] rawToEdit;
            int editLen;
            BuildRuns(pPara, m, out rawToEdit, out editLen);
            m.Len = editLen;

            ReadObjects(pPara, m, rawToEdit, pIndex);
            m.Seg = ReadLineSeg(pPara, rawToEdit);
            return m;
        }

        #endregion

        #region 원시 인덱스 ↔ 편집 인덱스

        /// <summary>
        /// ★ HWP 원시 인덱스에서 확장·인라인 컨트롤 문자는 <b>8글자</b>를 차지하지만
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

                // ★ 탭은 ControlChar 가 아니라 <b>ControlInline(8글자)</b> 로 올라온다
                //   (실측 tabdef.hwp — type=ControlInline code=9 size=8).
                //   이걸 안 걸러 내면 아래 default 로 빠져 폭 0 인 숨은 개체가 되고, 화면에서 탭이
                //   통째로 사라진 채 그 뒤 글자가 탭 폭만큼 왼쪽으로 당겨진다.
                bool isTab = ch.Type == HWPCharType.ControlInline && ch.Code == 9;

                switch (isTab ? HWPCharType.ControlChar : ch.Type)
                {
                    case HWPCharType.Normal:
                        buf.Append((char)ch.Code);
                        edit++;
                        break;

                    case HWPCharType.ControlChar:
                        // 9=탭(위에서 접어 온 것), 10=줄바꿈, 13=문단 끝. 문단 끝은 모델에 담지 않는다.
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

        private static int ToEdit(int[] pMap, long pRaw)
        {
            if (pMap == null || pMap.Length == 0) return 0;
            if (pRaw < 0) return 0;
            if (pRaw >= pMap.Length) return pMap[pMap.Length - 1];
            return pMap[pRaw];
        }

        #endregion

        #region 개체 · lineseg

        /// <summary>
        /// ★ 화면에 안 보이는 것(용지·단 정의, 필드 같은 인라인 제어문자)도 <b>빠짐없이 목록에 넣는다</b>.
        ///   되쓰기가 runs·objs 만 보고 원시 글자열을 다시 만들기 때문에, 목록에 없는 컨트롤은
        ///   그 문단을 한 번 고치는 순간 사라진다(첫 문단이면 그 구역의 용지 정의가 통째로 날아간다).
        ///   화면 쪽은 <c>hidden</c> 을 보고 아무것도 그리지 않는다.
        /// </summary>
        private static void ReadObjects(Paragraph pPara, ParagraphModel pModel, int[] pRawToEdit, cHwpIndex pIndex)
        {
            if (pPara.Text == null) return;

            IReadOnlyList<HWPChar> chars = pPara.Text.CharList;
            int raw = 0, ctlIdx = 0, objIdx = 0;

            for (int i = 0; i < chars.Count; i++)
            {
                HWPChar ch = chars[i];
                InlineObjModel o = null;
                Control ctl = null;

                if (ch.Type == HWPCharType.ControlExtend)
                {
                    if (pPara.ControlList != null && ctlIdx < pPara.ControlList.Count) ctl = pPara.ControlList[ctlIdx];
                    ctlIdx++;
                    o = ToObject(ctl, pModel.Id, objIdx, ToEdit(pRawToEdit, raw), pIndex);
                }
                else if (ch.Type == HWPCharType.ControlInline && ch.Code != 9)
                {
                    // 탭(9)은 BuildRuns 가 이미 글자로 담았다 — 여기서 또 담으면 한 자리를 두 번 센다.
                    o = Hidden(pModel.Id, objIdx, ToEdit(pRawToEdit, raw), "inline", "인라인");
                }

                if (o != null)
                {
                    pModel.Objs.Add(o);
                    if (pIndex != null) pIndex.Objs[o.Oid] = new cObjRef(ch, ctl);
                    objIdx++;
                }

                raw += ch.CharSize;
            }
        }

        private static InlineObjModel Hidden(string pParaId, int pIndex, int pPos, string pCtrl, string pLabel)
        {
            InlineObjModel o = new InlineObjModel();
            o.Pos = pPos;
            o.Oid = pParaId + "#" + pIndex;
            o.Kind = "ctrl";
            o.Ctrl = pCtrl;
            o.Label = pLabel;
            o.Hidden = true;
            o.Inline = true;
            return o;
        }

        private static InlineObjModel ToObject(Control pControl, string pParaId, int pIndex, int pPos, cHwpIndex pMap)
        {
            // 용지·단 정의는 화면에 그릴 개체가 아니다 — 섹션 속성으로 이미 흡수했다.
            // 컨트롤을 못 찾은 확장 제어문자도 같은 자리에 둔다(원본 글자를 그대로 되쓴다).
            if (pControl == null) return Hidden(pParaId, pIndex, pPos, "unknown", "컨트롤");
            if (pControl is ControlSectionDefine) return Hidden(pParaId, pIndex, pPos, "secd", "구역 정의");
            if (pControl is ControlColumnDefine) return Hidden(pParaId, pIndex, pPos, "cold", "단 정의");

            InlineObjModel o = new InlineObjModel();
            o.Pos = pPos;
            o.Oid = pParaId + "#" + pIndex;

            CtrlHeaderGso gso = pControl.GetHeader() as CtrlHeaderGso;
            if (gso != null)
            {
                o.WHu = gso.Width;
                o.HHu = gso.Height;

                // ★ 오프셋은 <b>부호 있는</b> 값이다. HwpLibSharp 이 UInt32 로 주므로 그대로 쓰면
                //   -2835 가 4,294,964,461 이 된다 — 화면에서는 그 개체가 3,300만 픽셀 밖으로 나가고
                //   PDF 로 뽑으면 그 자리까지 쪽을 채워 <b>19,926쪽</b>이 나온다(실측 aligns.hwp).
                //   크기(Width·Height)는 진짜 부호 없는 값이라 그대로 둔다.
                o.XOffHu = unchecked((int)gso.XOffset);
                o.YOffHu = unchecked((int)gso.YOffset);
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
                return o;   // src 는 cImageStore 가 채운다
            }

            ControlTable tbl = pControl as ControlTable;
            if (tbl != null)
            {
                o.Kind = "table";
                o.Table = ToTable(tbl, o.Oid, pMap);
                return o;
            }

            // ★ 나머지는 opaque — 크기와 라벨만 갖고 회색 상자로 그린다.
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

        private static TableModel ToTable(ControlTable pTable, string pOid, cHwpIndex pMap)
        {
            TableModel t = new TableModel();

            // ★ 행 목록은 Table 이 아니라 ControlTable 이 들고 있다. Table 은 칸 여백·테두리 같은 속성만이다.
            IReadOnlyList<Row> rows = pTable.RowList;
            if (rows == null) return t;
            for (int r = 0; r < rows.Count; r++)
            {
                Row row = rows[r];

                for (int c = 0; c < row.CellList.Count; c++)
                {
                    Cell cell = row.CellList[c];
                    CellModel cm = new CellModel();
                    ListHeaderForCell h = cell.ListHeader;
                    if (h != null)
                    {
                        cm.R = h.RowIndex;
                        cm.C = h.ColIndex;

                        // ★ 1 아래로 두지 않는다. 0 이 하나라도 있으면 화면 쪽 격자 계산이 그 칸을
                        //   통째로 빠뜨리고(행 수·씨앗·행 높이 전부), 저장하는 쪽은 1 로 봐서
                        //   같은 요청에 <b>다른 격자</b>가 나온다.
                        cm.Rs = Math.Max(1, h.RowSpan);
                        cm.Cs = Math.Max(1, h.ColSpan);
                        cm.WHu = h.Width;
                        cm.HHu = h.Height;
                        cm.MlHu = h.LeftMargin;
                        cm.MrHu = h.RightMargin;
                        cm.MtHu = h.TopMargin;
                        cm.MbHu = h.BottomMargin;
                    }
                    else { cm.R = r; cm.C = c; }

                    if (cell.ParagraphList != null)
                    {
                        Paragraph[] ps = cell.ParagraphList.GetParagraphs();
                        for (int k = 0; k < ps.Length; k++)
                            cm.Paras.Add(ReadParagraph(ps[k], pOid + "r" + cm.R + "c" + cm.C + "p" + k,
                                                        null, cell.ParagraphList, pMap));
                    }

                    t.Cells.Add(cm);
                }
            }

            // ★ 행·열 수는 <b>격자</b>에서 낸다. 행의 칸 개수로 세면 병합된 표에서 늘 작게 나온다
            //   (걸쳐 있는 칸은 시작 행에만 들어 있다).
            foreach (CellModel cc in t.Cells)
            {
                if (cc.R + cc.Rs > t.Rows) t.Rows = cc.R + cc.Rs;
                if (cc.C + cc.Cs > t.Cols) t.Cols = cc.C + cc.Cs;
            }
            return t;
        }

        /// <summary>
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
                m.Th = it.TextPartHeight;
                m.B = it.DistanceBaseLineToLineVerticalPosition;
                m.X = it.StartPositionFromColumn;
                m.W = it.SegmentWidth;
                list.Add(m);
            }
            return list;
        }

        /// <summary>
        /// ★ 파일의 <c>IsFirstLineAtPage</c>·<c>IsFirstLineAtColumn</c> 태그는 36개 샘플에서 전부 0 이라
        ///   못 쓴다(실측 — tag 값이 늘 0x00060000, 즉 줄의 처음·끝 비트뿐이다). 대신 두 가지로 센다:
        ///   <b>y 가 직전 줄보다 작아지는 자리</b>와 <b>두 번째 이후 섹션의 첫 줄</b>.
        ///
        /// ★ <b>다단 문서에서는 과다 계산된다</b> — 단이 넘어갈 때도 y 가 0 으로 돌아가는데
        ///   lineseg 만으로는 그것이 몇 번째 단인지 알 수 없다(x 는 단 기준 상대좌표라 늘 0 이다).
        ///   실측: multicolumns.hwp 는 2쪽인데 4번 리셋, multicolumns-layout.hwp 는 3쪽인데 7번.
        ///   그래서 이 값은 <b>쪽 수 판정에 쓰지 않는다</b> — 쪽 수 오라클은 convert2pdf CLI 다.
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
