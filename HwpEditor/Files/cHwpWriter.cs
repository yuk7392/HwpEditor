using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using HwpEditor.Models;
using HwpLib.Object;
using HwpLib.Object.BodyText;
using HwpLib.Object.BodyText.Control;
using HwpLib.Object.BodyText.Control.Bookmark;
using HwpLib.Object.BodyText.Control.CtrlHeader;
using HwpLib.Object.BodyText.Control.CtrlHeader.ColumnDefine;
using HwpLib.Object.BodyText.Control.CtrlHeader.Gso;
using HwpLib.Object.BodyText.Control.CtrlHeader.Header;
using HwpLib.Object.BodyText.Control.CtrlHeader.PageNumberPosition;
using HwpLib.Object.BodyText.Control.HeaderFooter;
using HwpLib.Object.BodyText.Control.Gso;
using HwpLib.Object.BodyText.Control.SectionDefine;
using HwpLib.Object.BodyText.Control.Gso.ShapeComponent;
using HwpLib.Object.BodyText.Control.Gso.ShapeComponentEach;
using HwpLib.Object.BodyText.Control.Table;
using HwpLib.Object.BodyText.Paragraph;
using HwpLib.Object.BodyText.Paragraph.CharShape;
using HwpLib.Object.BodyText.Paragraph.LineSeg;
using HwpLib.Object.BodyText.Paragraph.Text;
using HwpLib.Object.DocInfo;
using HwpLib.Object.DocInfo.BorderFill;

namespace HwpEditor.Files
{
    /// <summary>
    /// ★ 손대는 것은 <b>온 문단뿐</b>이다. 나머지 문단·표·수식·도형은 읽은 객체 그대로 남아 있다가
    ///   그대로 다시 저장된다 — 이것이 "원본 객체 유지 + 변경분만 반영" 의 실체다.
    /// ★ 문단 하나를 되쓸 때도 <b>원본 제어문자와 원본 Control 을 그대로 다시 넣는다</b>.
    ///   확장 제어문자 8글자 안에 컨트롤 종류가 들어 있어서 새로 만들면 짝이 깨진다.
    /// </summary>
    public static class cHwpWriter
    {
        /// <summary>lineseg 태그. 샘플 36개가 전부 이 값이었다 — 줄의 첫 조각이자 마지막 조각이라는 뜻이다.</summary>
        private const uint cSegTagNormal = 0x00060000;

        /// <summary>ShapeComponent 의 개체 종류 표시. '$' 'p' 'i' 'c' 를 이어 붙인 값이다(실측 611346787).</summary>
        private const uint cGsoIdPicture = 0x24706963;

        public static void Apply(HWPFile pFile, cHwpIndex pIndex, SaveRequest pReq, SaveResult pResult)
        {
            if (pFile == null || pIndex == null || pReq == null || pReq.Ops == null) return;

            // ★ 모양을 먼저 등록한다. 화면이 매긴 번호와 문서 번호가 다를 수 있고(같은 모양 재사용),
            //   그 표가 있어야 아래에서 runs 의 cs 와 문단의 ps 를 옮겨 적을 수 있다.
            // ★ 테두리/배경 표가 <b>맨 먼저</b>다 — 문단모양과 칸이 그 번호를 가리킨다.
            cShapes = new cShapeMap();
            cShapes.Bf = cShapeWriter.RegisterBorderFills(pFile, pReq.BorderFills);
            cShapes.Bul = cShapeWriter.RegisterBullets(pFile, pReq.Bullets);
            cShapes.Num = cShapeWriter.RegisterNumberings(pFile, pReq.Numberings);
            cShapes.Cs = cShapeWriter.RegisterCharShapes(pFile, pReq.CharShapes, cShapes.Bf);
            cShapes.Ps = cShapeWriter.RegisterParaShapes(pFile, pReq.ParaShapes, cShapes.Bf, cShapes.Num, cShapes.Bul);

            IList<EditOp> pOps = pReq.Ops;

            // 새 그림은 op 하나가 실물을, 다른 op 의 objs 가 자리를 들고 온다 — 먼저 짝을 지어 둔다.
            Dictionary<string, EditOp> images = new Dictionary<string, EditOp>();
            foreach (EditOp op in pOps)
                if ((op.Op == "addImage" || op.Op == "addTable" || op.Op == "addHeader"
                     || op.Op == "addLink" || op.Op == "addLinkEnd" || op.Op == "addMark")
                    && !string.IsNullOrEmpty(op.TmpId)) images[op.TmpId] = op;

            // ★ 순서가 뜻을 갖는다: 내용 먼저(replace) → 지우기 → 넣기.
            //   넣기를 먼저 하면 insertAfter 의 기준 문단이 지워진 뒤일 수 있다.
            foreach (EditOp op in pOps) if (op.Op == "replace") ApplyReplace(pFile, pIndex, op, images, pResult);
            foreach (EditOp op in pOps) if (op.Op == "delete") ApplyDelete(pIndex, op);
            foreach (EditOp op in pOps) if (op.Op == "insertAfter") ApplyInsertAfter(pFile, pIndex, op, images, pResult);

            // ★ 표 구조는 <b>맨 마지막</b>에 바꾼다. 표를 다시 세우면 셀 문단 객체가 전부 새것이 되어
            //   그 앞에 오는 셀 문단 요청들이 사라진 객체를 가리키게 된다.
            bool rebuilt = cTableWriter.Apply(pIndex, pOps);
            if (pResult != null && rebuilt) pResult.Reload = true;

            // ★ 행·열을 넣어 생긴 칸의 글은 표를 다시 세운 <b>뒤</b>에 붓는다 — 그 전에 부으면
            //   다시 세우기가 그 칸을 새로 만들면서 통째로 지운다.
            ApplyCellText(pIndex, pOps);

            // ★ 서식은 구조 <b>뒤</b>다 — 표를 다시 세우면 칸 객체가 새것이라 앞서 건 서식이 사라진다.
            ApplyFormatOps(pIndex, pOps);
            ApplySecOps(pFile, pOps);
            ApplyPageNumOps(pIndex, pOps);

            if (pResult != null)
            {
                pResult.CsMap = cShapes.Cs;
                pResult.PsMap = cShapes.Ps;
                pResult.BfMap = cShapes.Bf;
                pResult.BulMap = cShapes.Bul;
                pResult.NumMap = cShapes.Num;
            }
            cShapes = null;
        }

        /// <summary>
        /// 칸·표 서식(<c>cellFmt</c>·<c>tableFmt</c>). 구조를 안 바꾸므로 <see cref="SaveResult.Reload"/> 는 안 켠다.
        /// </summary>
        private static void ApplyFormatOps(cHwpIndex pIndex, IList<EditOp> pOps)
        {
            foreach (EditOp op in pOps)
            {
                if (op.Op != "cellFmt" && op.Op != "tableFmt") continue;

                cObjRef r;
                if (string.IsNullOrEmpty(op.Oid) || !pIndex.Objs.TryGetValue(op.Oid, out r)) continue;
                ControlTable tbl = r.Control as ControlTable;
                if (tbl == null) continue;

                if (op.Op == "tableFmt") { ApplyTableFmt(tbl, op); continue; }

                foreach (Row row in tbl.RowList)
                    foreach (Cell cell in row.CellList)
                    {
                        ListHeaderForCell h = cell.ListHeader;
                        if (h == null || !InRect(op, h.RowIndex, h.ColIndex)) continue;

                        if (op.Bf.HasValue) h.BorderFillId = cShapeWriter.Map(cShapes.Bf, op.Bf.Value);
                        if (op.Valign.HasValue) h.Property.TextVerticalAlignment =
                                (HwpLib.Object.BodyText.Control.Gso.TextBox.TextVerticalAlignment)op.Valign.Value;
                        if (op.Head.HasValue) h.Property.TitleCell = op.Head.Value;
                        if (op.CmL.HasValue) h.LeftMargin = (int)op.CmL.Value;
                        if (op.CmR.HasValue) h.RightMargin = (int)op.CmR.Value;
                        if (op.CmT.HasValue) h.TopMargin = (int)op.CmT.Value;
                        if (op.CmB.HasValue) h.BottomMargin = (int)op.CmB.Value;
                    }
            }
        }

        /// <summary>
        /// 구역 쪽 설정(<c>secFmt</c>). 용지·여백은 그 구역 문단에 붙은 <c>secd</c>, 단은 <c>cold</c> 컨트롤이
        /// 들고 있다 — 읽기(<see cref="cHwpReader"/>)와 <b>같은 자리</b>를 고친다.
        /// </summary>
        private static void ApplySecOps(HWPFile pFile, IList<EditOp> pOps)
        {
            foreach (EditOp op in pOps)
            {
                if (op.Op != "secFmt" || !op.Sec.HasValue) continue;
                int si = op.Sec.Value;
                if (pFile.BodyText == null || si < 0 || si >= pFile.BodyText.SectionList.Count) continue;

                Section sec = pFile.BodyText.SectionList[si];
                for (int i = 0; i < sec.ParagraphCount; i++)
                {
                    Paragraph p = sec.GetParagraph(i);
                    if (p.ControlList == null) continue;
                    foreach (Control c in p.ControlList)
                    {
                        ControlSectionDefine sd = c as ControlSectionDefine;
                        if (sd != null && sd.PageDef != null) { ApplyPageDef(sd.PageDef, op); continue; }

                        ControlColumnDefine cd = c as ControlColumnDefine;
                        if (cd != null) ApplyColumnDef(cd, op);
                    }
                }
            }
        }

        /// <summary>쪽 번호 위치·모양(<c>pageNum</c>). 이미 있는 컨트롤만 고친다 — 새로 만드는 길은 아직 없다.</summary>
        private static void ApplyPageNumOps(cHwpIndex pIndex, IList<EditOp> pOps)
        {
            foreach (EditOp op in pOps)
            {
                if (op.Op != "pageNum") continue;

                cObjRef r;
                if (string.IsNullOrEmpty(op.Oid) || !pIndex.Objs.TryGetValue(op.Oid, out r)) continue;
                ControlPageNumberPosition pn = r.Control as ControlPageNumberPosition;
                if (pn == null) continue;

                CtrlHeaderPageNumberPosition h = pn.GetHeader();
                if (h == null || h.Property == null) continue;

                if (op.NumPos.HasValue) h.Property.NumberPosition = (NumberPosition)op.NumPos.Value;
                if (op.NumShape.HasValue) h.Property.NumberShape = (NumberShape)op.NumShape.Value;
                if (op.NumDash.HasValue)
                {
                    // ★ 줄표는 <b>앞뒤 두 글자</b>가 한 벌이다 — 한쪽만 채우면 한글이 "-1" 로 그린다.
                    string dash = op.NumDash.Value ? "-" : "\0";
                    if (h.BeforeDecorationLetter != null) h.BeforeDecorationLetter.FromUTF16LEString(dash);
                    if (h.AfterDecorationLetter != null) h.AfterDecorationLetter.FromUTF16LEString(dash);
                }
            }
        }

        private static void ApplyPageDef(PageDef pDef, EditOp pOp)
        {
            if (pOp.Pw.HasValue) pDef.PaperWidth = pOp.Pw.Value;
            if (pOp.Ph.HasValue) pDef.PaperHeight = pOp.Ph.Value;
            if (pOp.Ml.HasValue) pDef.LeftMargin = pOp.Ml.Value;
            if (pOp.Mr.HasValue) pDef.RightMargin = pOp.Mr.Value;
            if (pOp.Mt.HasValue) pDef.TopMargin = pOp.Mt.Value;
            if (pOp.Mb.HasValue) pDef.BottomMargin = pOp.Mb.Value;
            if (pOp.Mh.HasValue) pDef.HeaderMargin = pOp.Mh.Value;
            if (pOp.Mf.HasValue) pDef.FooterMargin = pOp.Mf.Value;
            if (pOp.Gut.HasValue) pDef.GutterMargin = pOp.Gut.Value;
            if (pOp.Landscape.HasValue && pDef.Property != null)
                pDef.Property.PaperDirection = pOp.Landscape.Value ? PaperDirection.Landscape : PaperDirection.Portrait;
        }

        private static void ApplyColumnDef(ControlColumnDefine pDef, EditOp pOp)
        {
            CtrlHeaderColumnDefine h = pDef.GetHeader();
            if (h == null || h.Property == null) return;
            if (pOp.ColCount.HasValue) h.Property.SetColumnCount((short)Math.Max(1, pOp.ColCount.Value));
            if (pOp.ColGap.HasValue) h.GapBetweenColumn = (int)pOp.ColGap.Value;
        }

        private static void ApplyTableFmt(ControlTable pTbl, EditOp pOp)
        {
            if (pTbl.Table != null)
            {
                if (pOp.Bf.HasValue) pTbl.Table.BorderFillId = cShapeWriter.Map(cShapes.Bf, pOp.Bf.Value);
                if (pOp.Divide.HasValue) pTbl.Table.Property.DivideAtPageBoundary = (DivideAtPageBoundary)pOp.Divide.Value;
                if (pOp.RepeatHeader.HasValue) pTbl.Table.Property.AutoRepeatTitleRow = pOp.RepeatHeader.Value;
            }

            CtrlHeaderGso gso = pTbl.GetHeader() as CtrlHeaderGso;
            if (gso == null) return;
            if (pOp.OmL.HasValue) gso.OutterMarginLeft = (int)pOp.OmL.Value;
            if (pOp.OmR.HasValue) gso.OutterMarginRight = (int)pOp.OmR.Value;
            if (pOp.OmT.HasValue) gso.OutterMarginTop = (int)pOp.OmT.Value;
            if (pOp.OmB.HasValue) gso.OutterMarginBottom = (int)pOp.OmB.Value;
        }

        /// <summary>칸 사각형 안인가. 값이 안 온 변(-1)은 <b>제한 없음</b>이다.</summary>
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
            public int[] Bul;
            public int[] Num;
        }

        [ThreadStatic]
        private static cShapeMap cShapes;

        #region op 별 처리

        private static void ApplyReplace(HWPFile pFile, cHwpIndex pIndex, EditOp pOp,
                                         Dictionary<string, EditOp> pImages, SaveResult pResult)
        {
            cParaRef r;
            if (string.IsNullOrEmpty(pOp.Id) || !pIndex.Paras.TryGetValue(pOp.Id, out r))
                throw new InvalidOperationException("고칠 문단을 못 찾았다: " + (pOp.Id ?? "(없음)"));

            Rewrite(pFile, pIndex, r.Para, pOp, pImages, pResult);
        }

        private static void ApplyDelete(cHwpIndex pIndex, EditOp pOp)
        {
            cParaRef r;
            if (string.IsNullOrEmpty(pOp.Id)) return;
            if (!pIndex.Paras.TryGetValue(pOp.Id, out r)) return;

            if (r.List == null) return;

            int at = IndexOf(r.List, r.Para);
            if (at < 0) return;

            // ★ 목록에 문단이 하나도 없으면 문서가 깨진다. 마지막 하나는 <b>비운다</b> —
            //   그냥 넘어가면 화면에서 지운 글이 파일에는 그대로 남아 되살아난다.
            if (r.List.ParagraphCount <= 1) { ClearButControls(r.Para); return; }

            r.List.DeleteParagraph(at);
            pIndex.Paras.Remove(pOp.Id);
            FixLastInList(r.List);
        }

        private static void ApplyInsertAfter(HWPFile pFile, cHwpIndex pIndex, EditOp pOp,
                                             Dictionary<string, EditOp> pImages, SaveResult pResult)
        {
            cParaRef refer;
            if (string.IsNullOrEmpty(pOp.Ref) || !pIndex.Paras.TryGetValue(pOp.Ref, out refer))
                throw new InvalidOperationException("기준 문단을 못 찾았다: " + (pOp.Ref ?? "(없음)"));

            if (refer.List == null)
                throw new InvalidOperationException("기준 문단이 어느 목록에도 없다: " + pOp.Ref);

            int at = IndexOf(refer.List, refer.Para);
            if (at < 0) throw new InvalidOperationException("기준 문단이 목록에서 사라졌다: " + pOp.Ref);

            // ★ 새로 만들지 않고 기준 문단을 복제한다 — 문단 머리의 스타일 id·플래그를 손으로 채우면
            //   빠뜨린 필드가 그대로 파일에 나가고, 그 문단만 다른 문서처럼 보인다.
            Paragraph np = refer.Para.Clone();
            refer.List.InsertParagraph(at + 1, np);

            pIndex.Paras[pOp.Id] = new cParaRef(np, refer.Sec, refer.List);
            Rewrite(pFile, pIndex, np, pOp, pImages, pResult);
            FixLastInList(refer.List);
        }

        /// <summary>
        /// 글자만 지우고 컨트롤 자리는 남긴다. 구역의 마지막 문단을 지울 수 없을 때 쓴다 —
        /// 용지·단 정의가 이 문단에 매달려 있으면 문단째 없애면 안 된다.
        /// </summary>
        private static void ClearButControls(Paragraph pPara)
        {
            if (pPara.Text == null) return;

            List<HWPChar> keep = new List<HWPChar>();
            foreach (HWPChar c in pPara.Text.CharList)
                if (c.Type == HWPCharType.ControlExtend || c.Type == HWPCharType.ControlInline) keep.Add(c);

            int raw = 0;
            pPara.Text.Clear();
            foreach (HWPChar c in keep) { pPara.Text.AddChar(c); raw += c.CharSize; }
            pPara.Text.AddChar(new HWPCharControlChar(13));
            raw++;

            pPara.Header.CharacterCount = raw;

            // ★ 글자모양 짝도 같이 줄인다. 안 줄이면 100글자짜리 문단을 비웠을 때 위치 40 짜리 짝이
            //   남아 글자 수 밖을 가리킨다 — 저장은 되고 여는 쪽에서만 깨진다.
            ParaCharShape shape = pPara.CharShape;
            if (shape != null)
            {
                int first = shape.PositionShapeIdPairList.Count > 0
                          ? (int)shape.PositionShapeIdPairList[0].ShapeId : 0;
                while (shape.PositionShapeIdPairList.Count > 0)
                    shape.RemoveParaCharShapeAt(shape.PositionShapeIdPairList.Count - 1);
                shape.AddParaCharShape(0, first);
                pPara.Header.CharShapeCount = 1;
            }

            pPara.DeleteLineSeg();
            pPara.CreateLineSeg();
            LineSegItem only = pPara.LineSeg.AddNewLineSegItem();
            only.LineHeight = 1000;
            only.TextPartHeight = 1000;
            only.LineSpace = 600;
            only.DistanceBaseLineToLineVerticalPosition = 850;
            only.SegmentWidth = 42520;
            only.Tag.Value = cSegTagNormal;
            pPara.Header.LineAlignCount = 1;
        }

        private static int IndexOf(IParagraphList pList, Paragraph pPara)
        {
            for (int i = 0; i < pList.ParagraphCount; i++)
                if (ReferenceEquals(pList.GetParagraph(i), pPara)) return i;
            return -1;
        }

        /// <summary>목록의 마지막 문단만 <c>LastInList</c> 가 참이다(실측 — 앞 문단은 전부 거짓).</summary>
        private static void FixLastInList(IParagraphList pList)
        {
            for (int i = 0; i < pList.ParagraphCount; i++)
                pList.GetParagraph(i).Header.LastInList = i == pList.ParagraphCount - 1;
        }

        #endregion

        #region 문단 하나 되쓰기

        private sealed class cFlatChar
        {
            public char Ch;
            public int Cs;
        }

        /// <summary>
        /// ★ 원시 인덱스와 편집 인덱스가 여기서 다시 갈린다. 개체는 화면에서 1글자지만
        ///   파일에서는 8글자다 — 그래서 lineseg 의 시작 위치를 되돌릴 <c>편집 → 원시</c> 표를
        ///   글자를 넣으면서 같이 만든다.
        /// </summary>
        private static void Rewrite(HWPFile pFile, cHwpIndex pIndex, Paragraph pPara, EditOp pOp,
                                    Dictionary<string, EditOp> pImages, SaveResult pResult)
        {
            pPara.Header.ParaShapeId = cShapes == null ? pOp.Ps : cShapeWriter.Map(cShapes.Ps, pOp.Ps);

            // ★ null 은 "안 바꿨다" 다 — 늘 쓰면 스타일이 글자 하나 칠 때마다 0(바탕글)으로 밀린다.
            if (pOp.Sty.HasValue) pPara.Header.StyleId = (short)pOp.Sty.Value;
            SetDivide(pPara.Header.DivideSort, pOp.Brk);

            List<cFlatChar> flat = Flatten(pOp.Runs);
            Dictionary<int, EditObj> objs = ByPosition(pOp.Objs, flat.Count, pOp.Id);
            int len = flat.Count + objs.Count;

            if (pPara.Text == null) pPara.CreateText();
            if (pPara.CharShape == null) pPara.CreateCharShape();
            if (pPara.ControlList == null) pPara.CreateControlList();

            ParaText text = pPara.Text;
            ParaCharShape shape = pPara.CharShape;

            // ★ 글자가 하나도 안 남는 문단(전부 지웠거나 개체만 남은 문단)은 <b>원래 쓰던 글자모양</b>을
            //   그대로 지켜야 한다. 0 번으로 밀어 버리면 빈 줄의 높이·글꼴이 바뀌고, 거기 다시 치면
            //   딴 글씨가 나온다.
            int keepCs = shape.PositionShapeIdPairList.Count > 0
                       ? (int)shape.PositionShapeIdPairList[0].ShapeId : 0;

            text.Clear();
            while (shape.PositionShapeIdPairList.Count > 0)
                shape.RemoveParaCharShapeAt(shape.PositionShapeIdPairList.Count - 1);
            while (pPara.ControlList.Count > 0)
                pPara.RemoveControlAt(pPara.ControlList.Count - 1);

            // ★ 글자모양은 반드시 위치 0 에서 시작한다. 문단이 개체로 시작해도 마찬가지다
            //   (실측 — charshape.hwp 첫 문단은 확장 제어문자 두 개로 시작하는데 pos 0 에 짝이 있다).
            int firstCs = flat.Count > 0 ? flat[0].Cs : keepCs;
            shape.AddParaCharShape(0, firstCs);
            int lastCs = firstCs;

            int[] editToRaw = new int[len + 1];
            int raw = 0, flatAt = 0;

            for (int edit = 0; edit < len; edit++)
            {
                editToRaw[edit] = raw;

                EditObj eo;
                if (objs.TryGetValue(edit, out eo))
                {
                    raw += PutObject(pFile, pIndex, pPara, text, eo, pImages, pResult);
                    continue;
                }

                if (flatAt >= flat.Count) continue;   // objs 위치가 어긋난 요청 — 남은 자리는 비운다

                cFlatChar it = flat[flatAt++];
                if (it.Cs != lastCs) { shape.AddParaCharShape(raw, it.Cs); lastCs = it.Cs; }

                if (it.Ch == '\t') { text.AddChar(NewTab()); raw += 7; }
                else if (it.Ch == '\n') text.AddChar(new HWPCharControlChar(10));
                else text.AddChar(new HWPCharNormal(it.Ch));
                raw++;
            }

            editToRaw[len] = raw;

            // ★ 문단 끝 글자(13)는 파일에 실제로 들어 있다 — 빠뜨리면 다음 문단과 붙는다
            //   (실측 — 모든 문단의 마지막 글자가 ControlChar 13 이고 CharacterCount 에도 들어 있다).
            text.AddChar(new HWPCharControlChar(13));
            raw++;

            pPara.Header.CharacterCount = raw;
            pPara.Header.CharShapeCount = shape.PositionShapeIdPairList.Count;

            WriteLineSeg(pPara, pOp, editToRaw, len);
        }

        /// <summary>
        /// ★ 안 맞추면 문단을 복제해 넣을 때 나눔까지 복제된다 — 화면에는 하나인데 파일에는 둘이다.
        /// </summary>
        private static void SetDivide(HwpLib.Object.BodyText.Paragraph.Header.DivideSort pSort, string pBrk)
        {
            if (pSort == null) return;

            pSort.IsDivideSection = pBrk == "section";
            pSort.IsDividePage = pBrk == "page" || pBrk == "section";
            pSort.IsDivideColumn = pBrk == "column";
            pSort.IsDivideMultiColumn = pBrk == "multicolumn";
        }

        /// <summary>
        /// ★ 탭은 <c>ControlChar</c> 가 아니라 <b><c>ControlInline</c>(8글자)</b> 다.
        ///   1글자짜리로 쓰면 파일에는 한 칸만 나가는데 읽는 쪽은 코드 9를 보고 여덟 칸을 먹어서,
        ///   <b>그 뒤 문단이 통째로 삼켜진다</b>(실측 — 탭 하나 넣고 저장했더니 문단 7개가 2개로 줄었다).
        /// ★ 덧붙는 12바이트는 앞 4바이트가 탭 폭 캐시고 그 뒤가 속성이다(실측 tabdef.hwp —
        ///   D0-07(2000) 뒤에 00-01-00-00-00-00-00-00). 폭은 여는 쪽이 다시 계산하므로 0 으로 둔다.
        /// </summary>
        private static HWPChar NewTab()
        {
            HWPCharControlInline tab = new HWPCharControlInline();
            tab.Code = 9;
            tab.SetAddition(new byte[] { 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0 });
            return tab;
        }

        /// <summary>개체 한 자리를 넣고 그것이 먹은 <b>원시 글자 수</b>를 준다.</summary>
        private static int PutObject(HWPFile pFile, cHwpIndex pIndex, Paragraph pPara, ParaText pText,
                                     EditObj pObj, Dictionary<string, EditOp> pImages, SaveResult pResult)
        {
            cObjRef r;
            if (!string.IsNullOrEmpty(pObj.Oid) && pIndex.Objs.TryGetValue(pObj.Oid, out r))
            {
                pText.AddChar(r.Char);
                if (r.Control != null)
                {
                    pPara.AddControl(r.Control);
                    ApplyGeom(r.Control, pObj);
                }
                return r.Char.CharSize;
            }

            EditOp img;
            if (!string.IsNullOrEmpty(pObj.TmpId) && pImages.TryGetValue(pObj.TmpId, out img))
            {
                Control ctl;
                if (img.Op == "addHeader")
                {
                    ctl = AddBand(pPara, pText, img);
                    // ★ 머리말 안 문단을 <b>여기서</b> 만들었다 — 화면이 들고 있는 그 문단 id 는 문서에 없다.
                    if (pResult != null) pResult.Reload = true;
                }
                else if (img.Op == "addLink")
                {
                    ctl = AddLink(pPara, pText, img);
                }
                else if (img.Op == "addMark")
                {
                    ctl = AddMark(pPara, pText, img);
                }
                else if (img.Op == "addLinkEnd")
                {
                    // 필드 끝은 컨트롤이 없는 <b>인라인 제어문자 하나</b>다(실측 issue144 — 8글자).
                    pText.AddExtendCharForHyperlinkEnd();
                    ctl = null;
                }
                else if (img.Op == "addTable")
                {
                    ctl = AddTable(pFile, pPara, pText, img);
                    // ★ 새 표도 문서를 다시 읽어야 한다 — 칸 문단을 <b>여기서</b> 만들었으므로 화면이 들고 있는
                    //    칸 문단 id 는 문서에 없는 가짜다. 안 읽으면 그 뒤 칸 편집이 저장 요청에서 조용히 빠진다.
                    if (pResult != null) pResult.Reload = true;
                }
                else ctl = AddPicture(pFile, pPara, pText, img);
                if (ctl != null) ApplyGeom(ctl, pObj);   // 넣자마자 옮겼으면 그 자리로 (AddPicture 는 오프셋을 0 으로 둔다)
                HWPChar ch = pText.CharList[pText.CharList.Count - 1];

                string oid = pObj.TmpId + "@" + pIndex.Objs.Count.ToString(CultureInfo.InvariantCulture);
                pIndex.Objs[oid] = new cObjRef(ch, ctl);
                if (pResult != null) pResult.NewOids[pObj.TmpId] = oid;
                return ch.CharSize;
            }

            // 짝을 못 찾은 개체는 그 자리를 통째로 비운다 — 빈 확장 제어문자를 넣으면 파일이 깨진다.
            cLog.Write("되쓰기: 짝 없는 개체를 건너뛴다 oid=" + pObj.Oid + " tmpId=" + pObj.TmpId);
            return 0;
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
        ///   빠진다. 짝 없는 개체처럼 흔적을 남긴다 — 화면에는 있는데 저장본에서 사라진 개체를 되짚을 길이 이것뿐이다.
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
        /// ★ 지워서 한글이 다시 계산하게 두는 길도 있지만, 그러면 저장본의 줄 수가 0 이 되어
        ///   외부 변환기(convert2pdf)로는 우리 배치를 검증할 수 없다.
        /// ★ 파일의 <c>LineHeight</c> 는 <b>글자 높이</b>이고 줄 사이 여분은 <c>LineSpace</c> 로 따로 든다
        ///   (실측 — 160% 문단에서 height 1000 + space 600 = 다음 줄 y 1600).
        /// </summary>
        private static void WriteLineSeg(Paragraph pPara, EditOp pOp, int[] pEditToRaw, int pLen)
        {
            pPara.DeleteLineSeg();
            pPara.CreateLineSeg();

            List<SegModel> seg = pOp.Seg;
            if (seg == null || seg.Count == 0)
            {
                // 화면이 줄 정보를 안 보냈다 — 한 줄짜리로 둔다(빈 채로 두면 줄 수가 0 이 된다).
                LineSegItem only = pPara.LineSeg.AddNewLineSegItem();
                only.TextStartPosition = 0;
                only.LineHeight = 1000;
                only.TextPartHeight = 1000;
                only.LineSpace = 600;
                only.DistanceBaseLineToLineVerticalPosition = 850;
                only.SegmentWidth = 42520;
                only.Tag.Value = cSegTagNormal;
                pPara.Header.LineAlignCount = 1;
                return;
            }

            foreach (SegModel s in seg)
            {
                int at = s.S < 0 ? 0 : (s.S > pLen ? pLen : s.S);

                LineSegItem it = pPara.LineSeg.AddNewLineSegItem();
                it.TextStartPosition = pEditToRaw[at];
                it.LineVerticalPosition = (int)s.Y;
                it.TextPartHeight = (int)(s.Th > 0 ? s.Th : s.H);
                it.LineHeight = it.TextPartHeight;
                it.LineSpace = (int)Math.Max(0, s.H - it.TextPartHeight);
                it.DistanceBaseLineToLineVerticalPosition = (int)s.B;
                it.StartPositionFromColumn = (int)s.X;
                it.SegmentWidth = (int)s.W;
                it.Tag.Value = cSegTagNormal;
            }

            pPara.Header.LineAlignCount = pPara.LineSeg.LineSegItemList.Count;
        }

        #endregion

        #region 새 그림

        /// <summary>
        /// 그림 하나를 문단에 붙인다 — BinData 등록 → 그림 컨트롤 생성 → 확장 제어문자.
        ///
        /// ★ 셋이 한 벌이다. 하나라도 빠지면 저장은 성공하고 여는 쪽에서만 깨진다:
        ///   BinData 가 없으면 빈 상자, 컨트롤이 없으면 글자 하나가 사라진 것처럼 보이고,
        ///   제어문자가 없으면 컨트롤이 붕 떠서 아예 안 나온다.
        /// ★ 제어문자는 <see cref="ParaText.AddExtendCharForGSO"/> 가 만든다 — 원본 문서의
        ///   그림 제어문자와 바이트가 같다(실측 20-6F-73-67 = " osg").
        /// </summary>
        /// <summary>
        /// 새 표 하나. 격자·크기는 <b>화면이 보낸 칸 목록 그대로</b> 쓴다 — 여기서 다시 계산하면
        /// 저장 전 화면과 저장 뒤 다시 읽은 문서가 갈리고, 그 차이는 되읽기 전까지 아무 신호가 없다.
        /// ★ 칸 안 문단도 여기서 만든다. 그래야 화면이 새 칸에 친 글자가 저장에 실린다(TODO 2).
        /// </summary>
        private static Control AddTable(HWPFile pFile, Paragraph pPara, ParaText pText, EditOp pOp)
        {
            List<CellModel> cells = pOp.Cells;
            if (cells == null || cells.Count == 0) throw new InvalidOperationException("새 표에 칸이 하나도 없다");

            int rows = Math.Max(1, pOp.Rows), cols = Math.Max(1, pOp.Cols);
            int bf = TableBorderFill(pFile);

            ControlTable tbl = pPara.AddNewControl(ControlType.Table) as ControlTable;
            if (tbl == null) throw new InvalidOperationException("표 컨트롤을 만들지 못했다");

            long wAll = 0, hAll = 0;
            foreach (CellModel cm in cells)
            {
                if (cm.R == 0) wAll += cm.WHu;
                if (cm.C == 0) hAll += cm.HHu;
            }

            CtrlHeaderGso h = tbl.Header;
            h.Width = (uint)Math.Max(0, wAll);
            h.Height = (uint)Math.Max(0, hAll);
            h.XOffset = 0;
            h.YOffset = 0;
            h.ZOrder = NextZOrder(pFile);
            if (h.Property != null)
            {
                h.Property.SetLikeWord(true);
                h.Property.SetTextFlowMethod(TextFlowMethod.TakePlace);
                h.Property.SetHorzRelTo(HorzRelTo.Para);
                h.Property.SetVertRelTo(VertRelTo.Para);
            }

            /* ★ 표 서식도 여기서 받는다 — 새 표에는 tableFmt 를 보낼 길이 없다(oid 가 아직 없다).
               안 받으면 표를 넣고 건 "쪽 경계·제목 줄 반복·바깥 여백" 이 첫 저장에서 통째로 빠진다. */
            if (pOp.OmL.HasValue) h.OutterMarginLeft = (int)pOp.OmL.Value;
            if (pOp.OmR.HasValue) h.OutterMarginRight = (int)pOp.OmR.Value;
            if (pOp.OmT.HasValue) h.OutterMarginTop = (int)pOp.OmT.Value;
            if (pOp.OmB.HasValue) h.OutterMarginBottom = (int)pOp.OmB.Value;

            Table t = tbl.Table;
            t.RowCount = rows;
            t.ColumnCount = cols;
            t.CellSpacing = 0;
            t.BorderFillId = pOp.Bf.HasValue && pOp.Bf.Value > 0
                           ? cShapeWriter.Map(cShapes == null ? null : cShapes.Bf, pOp.Bf.Value) : bf;
            if (pOp.Divide.HasValue) t.Property.DivideAtPageBoundary = (DivideAtPageBoundary)pOp.Divide.Value;
            if (pOp.RepeatHeader.HasValue) t.Property.AutoRepeatTitleRow = pOp.RepeatHeader.Value;
            t.ClearCellCountOfRowList();

            for (int r = 0; r < rows; r++)
            {
                Row row = tbl.AddNewRow();
                int n = 0;
                foreach (CellModel cm in cells)
                {
                    if (cm.R != r) continue;
                    NewCell(row, cm, bf);
                    n++;
                }
                t.AddCellCountOfRow(n);
            }

            pText.AddExtendCharForTable();
            return tbl;
        }

        /// <summary>
        /// 머리말·꼬리말 하나를 문단에 붙인다 — 컨트롤 생성 → 안 문단 → 확장 제어문자.
        /// ★ 새 그림·새 표와 같은 세 벌이다. 제어문자가 빠지면 컨트롤이 붕 떠서 아예 안 나온다.
        /// </summary>
        /// <summary>
        /// 하이퍼링크 시작. 명령 문자열은 <c>주소;1;0;0;</c> 이고 주소 안의 <c>:</c>·<c>;</c> 는
        /// <c>\</c> 로 막는다(실측 issue144 — <c>http\://google.com;1;0;0;</c>).
        /// 끝 표식은 부르는 쪽이 <c>addLinkEnd</c> 로 따로 넣는다.
        /// </summary>
        /// <summary>
        /// 책갈피 하나. 이름은 컨트롤 데이터의 <c>ParameterSet</c> 문자열 항목이다
        /// (<see cref="cHwpReader"/> 의 BookmarkName 과 짝이다).
        /// ★ 확장 제어문자는 <b>code 22 + ctrlId 'bokm'</b> 이다 — hwplib 에 전용 Add 메서드가 없어
        ///   손으로 세웠고, 그 두 값이어야 <c>HWPCharControlExtend.IsBookmark</c> 가 참이 된다(실측).
        /// </summary>
        private static Control AddMark(Paragraph pPara, ParaText pText, EditOp pOp)
        {
            string name = pOp.Name == null ? "" : pOp.Name;

            ControlBookmark bm = pPara.AddNewControl(ControlType.Bookmark) as ControlBookmark;
            if (bm == null) throw new InvalidOperationException("책갈피 컨트롤을 만들지 못했다");

            bm.CreateCtrlData();
            // ★ ParameterSet 은 읽기 전용 속성이다 — 새로 만든 것을 Copy 로 부어 넣는다.
            CtrlData d = bm.GetCtrlData();
            if (d != null && d.ParameterSet != null) d.ParameterSet.Copy(ParameterSet.CreateForFieldName(name));

            HWPCharControlExtend ch = pText.AddNewExtendControlChar();
            ch.Code = 22;
            byte[] add = new byte[12];
            byte[] id = BitConverter.GetBytes(ControlTypeExtensions.GetCtrlId(ControlType.Bookmark));
            Array.Copy(id, 0, add, 0, 4);
            ch.SetAddition(add);
            return bm;
        }

        private static Control AddLink(Paragraph pPara, ParaText pText, EditOp pOp)
        {
            Control ctl = pPara.AddNewControl(ControlType.FIELD_HYPERLINK);
            if (ctl == null) throw new InvalidOperationException("하이퍼링크 컨트롤을 만들지 못했다");

            ControlField fld = ctl as ControlField;
            CtrlHeaderField h = fld != null ? fld.GetHeader() : null;
            if (h != null && h.Command != null) h.Command.FromUTF16LEString(EscapeCommand(pOp.Link) + ";1;0;0;");

            pText.AddExtendCharForHyperlinkStart();
            return ctl;
        }

        internal static string EscapeCommand(string pUrl)
        {
            if (string.IsNullOrEmpty(pUrl)) return "";
            StringBuilder sb = new StringBuilder();
            foreach (char c in pUrl)
            {
                if (c == ':' || c == ';' || c == '\\') sb.Append('\\');
                sb.Append(c);
            }
            return sb.ToString();
        }

        private static Control AddBand(Paragraph pPara, ParaText pText, EditOp pOp)
        {
            bool head = pOp.Kind != "foot";
            Control ctl = pPara.AddNewControl(head ? ControlType.Header : ControlType.Footer);
            if (ctl == null) throw new InvalidOperationException("머리말 컨트롤을 만들지 못했다");

            HeaderFooterApplyPage ap = pOp.Apply == "odd" ? HeaderFooterApplyPage.OddPage
                                     : pOp.Apply == "even" ? HeaderFooterApplyPage.EvenPage
                                     : HeaderFooterApplyPage.BothPage;

            ControlHeader hd = ctl as ControlHeader;
            ControlFooter ft = ctl as ControlFooter;
            ParagraphList list;
            ListHeaderForHeaderFooter lh;
            if (hd != null) { hd.Header.ApplyPage = ap; list = hd.ParagraphList; lh = hd.ListHeader; }
            else { ft.Header.ApplyPage = ap; list = ft.ParagraphList; lh = ft.ListHeader; }

            ParagraphModel pm = new ParagraphModel();
            pm.Ps = pOp.Ps;
            pm.Runs = pOp.Runs;
            NewListParagraph(list, pm, Math.Max(200L, pOp.WHu));

            Paragraph[] all = list.GetParagraphs();
            for (int q = 0; q < all.Length; q++) all[q].Header.LastInList = q == all.Length - 1;

            if (lh != null)
            {
                lh.ParaCount = all.Length;
                lh.TextWidth = Math.Max(0, pOp.WHu);
                lh.TextHeight = Math.Max(0, pOp.HHu);
            }

            if (head) pText.AddExtendCharForHeader(); else pText.AddExtendCharForFooter();
            return ctl;
        }

        /// <summary>
        /// 행·열을 넣어 생긴 칸에 화면이 친 글을 붓는다. 그 칸의 문단 id 는 문서 쪽 표에 없어
        /// <c>replace</c> 로 못 간다 — 칸 자리(행·열 번호)로 찾는다.
        /// </summary>
        private static void ApplyCellText(cHwpIndex pIndex, IList<EditOp> pOps)
        {
            foreach (EditOp op in pOps)
            {
                if (op.Op != "cellText" || op.Cells == null) continue;

                cObjRef r;
                if (string.IsNullOrEmpty(op.Oid) || !pIndex.Objs.TryGetValue(op.Oid, out r)) continue;
                ControlTable tbl = r.Control as ControlTable;
                if (tbl == null) continue;

                foreach (CellModel cm in op.Cells)
                {
                    Cell cell = FindCell(tbl, cm.R, cm.C);
                    if (cell == null || cell.ParagraphList == null) continue;

                    ListHeaderForCell lh = cell.ListHeader;
                    long inner = Math.Max(200, lh.Width - lh.LeftMargin - lh.RightMargin);

                    cell.ParagraphList.DeleteAllParagraphs();
                    if (cm.Paras == null || cm.Paras.Count == 0) NewCellParagraph(cell, null, inner);
                    else foreach (ParagraphModel pm in cm.Paras) NewCellParagraph(cell, pm, inner);

                    Paragraph[] all = cell.ParagraphList.GetParagraphs();
                    for (int q = 0; q < all.Length; q++) all[q].Header.LastInList = q == all.Length - 1;
                    lh.ParaCount = Math.Max(1, all.Length);
                }
            }
        }

        private static Cell FindCell(ControlTable pTable, int pRow, int pCol)
        {
            foreach (Row row in pTable.RowList)
                foreach (Cell cell in row.CellList)
                    if (cell.ListHeader.RowIndex == pRow && cell.ListHeader.ColIndex == pCol) return cell;
            return null;
        }

        private static void NewCell(Row pRow, CellModel pModel, int pBorderFill)
        {
            Cell cell = pRow.AddNewCell();
            ListHeaderForCell lh = cell.ListHeader;
            lh.RowIndex = pModel.R;
            lh.ColIndex = pModel.C;
            lh.RowSpan = Math.Max(1, pModel.Rs);
            lh.ColSpan = Math.Max(1, pModel.Cs);
            lh.Width = pModel.WHu;
            lh.Height = pModel.HHu;
            lh.LeftMargin = (int)pModel.MlHu;
            lh.RightMargin = (int)pModel.MrHu;
            lh.TopMargin = (int)pModel.MtHu;
            lh.BottomMargin = (int)pModel.MbHu;
            /* 칸이 자기 테두리를 들고 오면 그것을 쓴다 — 새 표에는 cellFmt 를 못 보낸다(그 표는 아직
               문서에 없어 oid 가 없다). 서식이 이 꾸러미에 실려야 첫 저장에 같이 들어간다. */
            lh.BorderFillId = pModel.Bf > 0 ? cShapeWriter.Map(cShapes == null ? null : cShapes.Bf, pModel.Bf) : pBorderFill;
            lh.Property.TextVerticalAlignment =
                (HwpLib.Object.BodyText.Control.Gso.TextBox.TextVerticalAlignment)pModel.Valign;
            lh.Property.TitleCell = pModel.Head;
            lh.TextWidth = Math.Max(0, pModel.WHu - pModel.MlHu - pModel.MrHu);
            lh.ParaCount = Math.Max(1, pModel.Paras.Count);

            if (pModel.Paras.Count == 0) NewCellParagraph(cell, null, lh.TextWidth);
            else foreach (ParagraphModel pm in pModel.Paras) NewCellParagraph(cell, pm, lh.TextWidth);

            // ★ 목록의 마지막 문단만 LastInList 다 — 가운데 문단이 true 면 여는 쪽이 거기서 칸을 끊는다.
            Paragraph[] all = cell.ParagraphList.GetParagraphs();
            for (int q = 0; q < all.Length; q++) all[q].Header.LastInList = q == all.Length - 1;
        }

        private static void NewCellParagraph(Cell pCell, ParagraphModel pModel, long pInner)
        {
            NewListParagraph(pCell.ParagraphList, pModel, pInner);
        }

        /// <summary>목록(표 칸·머리말·꼬리말) 안에 문단 하나를 새로 만든다.</summary>
        private static void NewListParagraph(ParagraphList pList, ParagraphModel pModel, long pInner)
        {
            Paragraph p = pList.AddNewParagraph();
            if (p.Text == null) p.CreateText();
            if (p.CharShape == null) p.CreateCharShape();

            p.Header.ParaShapeId = pModel == null ? 0
                                 : (cShapes == null ? pModel.Ps : cShapeWriter.Map(cShapes.Ps, pModel.Ps));

            List<cFlatChar> flat = Flatten(pModel == null ? null : pModel.Runs);
            ParaCharShape cs = p.CharShape;
            int firstCs = flat.Count > 0 ? flat[0].Cs : 0;
            cs.AddParaCharShape(0, firstCs);

            int lastCs = firstCs, raw = 0;
            foreach (cFlatChar it in flat)
            {
                if (it.Cs != lastCs) { cs.AddParaCharShape(raw, it.Cs); lastCs = it.Cs; }
                if (it.Ch == '\t') { p.Text.AddChar(NewTab()); raw += 7; }
                else if (it.Ch == '\n') p.Text.AddChar(new HWPCharControlChar(10));
                else p.Text.AddChar(new HWPCharNormal(it.Ch));
                raw++;
            }

            p.Text.AddChar(new HWPCharControlChar(13));
            raw++;

            p.Header.CharacterCount = raw;
            p.Header.CharShapeCount = cs.PositionShapeIdPairList.Count;

            p.DeleteLineSeg();
            p.CreateLineSeg();
            LineSegItem only = p.LineSeg.AddNewLineSegItem();
            only.TextStartPosition = 0;
            only.LineHeight = 1000;
            only.TextPartHeight = 1000;
            only.LineSpace = 600;
            only.DistanceBaseLineToLineVerticalPosition = 850;
            only.SegmentWidth = (int)Math.Max(200L, pInner);
            only.Tag.Value = cSegTagNormal;
            p.Header.LineAlignCount = 1;
        }

        /// <summary>
        /// 표가 참조할 테두리. ★ 문서에 있는 "네 변 실선" 을 <b>다시 쓴다</b> — 저장할 때마다 새로 만들면
        /// 표를 넣을 때마다 BorderFill 이 하나씩 불어난다.
        /// ★ hwp 의 borderFill id 는 <b>1부터</b>다(실측 table.hwp — 목록이 2개인데 표가 2번을 가리킨다).
        /// </summary>
        private static int TableBorderFill(HWPFile pFile)
        {
            IReadOnlyList<BorderFillInfo> list = pFile.DocInfo.BorderFillList;
            for (int i = 0; i < list.Count; i++)
                if (list[i].LeftBorder.Type == BorderType.Solid && list[i].RightBorder.Type == BorderType.Solid
                 && list[i].TopBorder.Type == BorderType.Solid && list[i].BottomBorder.Type == BorderType.Solid)
                    return i + 1;

            BorderFillInfo made = pFile.DocInfo.AddNewBorderFill();
            SetSolid(made.LeftBorder);
            SetSolid(made.RightBorder);
            SetSolid(made.TopBorder);
            SetSolid(made.BottomBorder);
            return pFile.DocInfo.BorderFillList.Count;
        }

        private static void SetSolid(EachBorder pBorder)
        {
            pBorder.Type = BorderType.Solid;
            pBorder.Thickness = BorderThickness.MM0_12;
            pBorder.Color.Value = 0;
        }

        private static Control AddPicture(HWPFile pFile, Paragraph pPara, ParaText pText, EditOp pImg)
        {
            byte[] data = File.ReadAllBytes(pImg.File);
            int binItemId = cImageStore.Register(pFile, pImg.File, data);

            int pw, ph;
            cImageStore.PixelSize(data, out pw, out ph);

            // 화면 픽셀 → HWPUNIT 은 96dpi 기준 75배다.
            int natW = pw > 0 ? pw * 75 : 0;
            int natH = ph > 0 ? ph * 75 : 0;

            int wHu = (int)(pImg.WHu > 0 ? pImg.WHu : (natW > 0 ? natW : 20000));
            int hHu = (int)(pImg.HHu > 0 ? pImg.HHu : (natH > 0 ? natH : 15000));
            if (natW <= 0) natW = wHu;
            if (natH <= 0) natH = hHu;

            CtrlHeaderGso h = new CtrlHeaderGso(ControlType.Gso);
            h.Width = (uint)wHu;
            h.Height = (uint)hHu;
            h.XOffset = 0;
            h.YOffset = 0;
            h.ZOrder = NextZOrder(pFile);

            h.Property.SetLikeWord(true);
            h.Property.SetTextFlowMethod(TextFlowMethod.TakePlace);
            h.Property.SetHorzRelTo(HorzRelTo.Para);
            h.Property.SetVertRelTo(VertRelTo.Para);

            GsoControl gso = pPara.AddNewGsoControl(GsoControlType.Picture, h);
            ControlPicture pic = gso as ControlPicture;
            if (pic == null) throw new InvalidOperationException("그림 컨트롤을 만들지 못했다");

            ShapeComponent sc = pic.ShapeComponent;
            if (sc != null)
            {
                sc.GsoId = cGsoIdPicture;
                sc.SetMatrixsNormal();
                sc.LocalFileVersion = 1;
                sc.WidthAtCreate = natW;
                sc.HeightAtCreate = natH;
                sc.WidthAtCurrent = wHu;
                sc.HeightAtCurrent = hHu;
                sc.RotateXCenter = wHu / 2;
                sc.RotateYCenter = hHu / 2;
            }

            ShapeComponentPicture scp = pic.ShapeComponentPicture;
            if (scp != null)
            {
                scp.PictureInfo.BinItemID = binItemId;
                scp.PictureInfo.Brightness = 0;
                scp.PictureInfo.Contrast = 0;

                // 네 꼭짓점은 <b>원본 그림</b>의 사각형이고, 잘라내기 값은 <b>화면에 놓인</b> 사각형이다
                // (실측 shapepict-scaled.hwp — LT 0,0 / RB 5689,3413 인데 cut 은 0,0,37500,22500).
                scp.LeftTop.X = 0; scp.LeftTop.Y = 0;
                scp.RightTop.X = (uint)natW; scp.RightTop.Y = 0;
                scp.LeftBottom.X = 0; scp.LeftBottom.Y = (uint)natH;
                scp.RightBottom.X = (uint)natW; scp.RightBottom.Y = (uint)natH;

                scp.LeftAfterCutting = 0;
                scp.TopAfterCutting = 0;
                scp.RightAfterCutting = wHu;
                scp.BottomAfterCutting = hHu;

                scp.ImageWidth = natW;
                scp.ImageHeight = natH;
                scp.BorderThickness = 0;

                if (scp.InnerMargin != null)
                {
                    scp.InnerMargin.Left = 0;
                    scp.InnerMargin.Right = 0;
                    scp.InnerMargin.Top = 0;
                    scp.InnerMargin.Bottom = 0;
                }
            }

            pText.AddExtendCharForGSO();
            return pic;
        }

        /// <summary>
        /// ★ 손대는 것은 <b>화면에 놓인</b> 사각형뿐이다. 원본 그림의 사각형(<c>WidthAtCreate</c>·
        ///   네 꼭짓점·<c>ImageWidth</c>)은 그대로 둔다 — 같이 바꾸면 그림이 늘어난 게 아니라 잘린다
        ///   (<see cref="AddPicture"/> 의 실측 주석과 같은 자리다).
        /// ★ 오프셋은 <b>부호 있는</b> 값이다. 리더가 <c>unchecked((int))</c> 로 읽으므로 쓰는 쪽도
        ///   짝을 맞춘다 — 안 맞추면 -2835 가 4,294,964,461 이 되고 PDF 가 19,926쪽이 된다.
        /// </summary>
        /// <summary>모델 이름 → hwp 값. 리더의 <c>FlowName</c> 과 짝이어야 한다.</summary>
        private static TextFlowMethod FlowOf(string pFlow)
        {
            switch (pFlow)
            {
                case "takePlace": return TextFlowMethod.TakePlace;
                case "behind": return TextFlowMethod.BehindText;
                case "front": return TextFlowMethod.InFrontOfText;
                default: return TextFlowMethod.FitWithText;
            }
        }

        private static void ApplyGeom(Control pCtl, EditObj pObj)
        {
            if (pCtl == null || pObj == null || !pObj.HasGeom) return;

            CtrlHeaderGso h = pCtl.GetHeader() as CtrlHeaderGso;
            if (h == null) return;   // Gso 머리말이 없는 컨트롤(각주·필드)은 크기·자리를 안 갖는다

            int w = pObj.WHu.HasValue ? (int)pObj.WHu.Value : (int)h.Width;
            int hh = pObj.HHu.HasValue ? (int)pObj.HHu.Value : (int)h.Height;

            if (pObj.WHu.HasValue) h.Width = (uint)Math.Max(0, w);
            if (pObj.HHu.HasValue) h.Height = (uint)Math.Max(0, hh);
            if (pObj.XOffHu.HasValue) h.XOffset = unchecked((uint)(int)pObj.XOffHu.Value);
            if (pObj.YOffHu.HasValue) h.YOffset = unchecked((uint)(int)pObj.YOffHu.Value);

            // ★ 글자처럼 취급하는가는 <b>네 설정이 한 벌</b>이다. 하나만 바꾸면 저장은 되고
            //   여는 쪽에서만 깨진다 — AddPicture 가 새로 만들 때 채우는 것과 같은 조합을 쓴다.
            //   기준(Para)까지 같이 못 박는 이유: 우리 배치도 리더가 읽은 relH/relV 를 그대로 쓴다.
            if (pObj.Inline.HasValue && h.Property != null)
            {
                h.Property.SetLikeWord(pObj.Inline.Value);
                h.Property.SetTextFlowMethod(TextFlowMethod.TakePlace);
                h.Property.SetHorzRelTo(HorzRelTo.Para);
                h.Property.SetVertRelTo(VertRelTo.Para);
            }

            // ★ 어울림 방식은 <b>글자처럼 취급을 끈 다음</b>에만 뜻이 있다 — 화면이 둘을 같이 안 보내고,
            //   여기서도 flow 를 걸 때 LikeWord 를 끈다(둘이 어긋나면 저장은 되고 여는 쪽에서만 깨진다).
            if (pObj.Flow != null && h.Property != null)
            {
                h.Property.SetLikeWord(false);
                h.Property.SetTextFlowMethod(FlowOf(pObj.Flow));
            }

            if (pObj.Z.HasValue) h.ZOrder = (int)pObj.Z.Value;

            if (!pObj.WHu.HasValue && !pObj.HHu.HasValue) return;

            // 그림은 안쪽 사각형까지 같이 옮겨야 한다 — 바깥 머리말만 고치면 한글이 옛 크기로 그린다.
            // 도형·글상자는 바깥 크기만 둔다(화면도 그것들의 크기 조절은 막아 두었다).
            ControlPicture pic = pCtl as ControlPicture;
            if (pic == null) return;

            ShapeComponent sc = pic.ShapeComponent;
            if (sc != null)
            {
                sc.WidthAtCurrent = w;
                sc.HeightAtCurrent = hh;
                sc.RotateXCenter = w / 2;
                sc.RotateYCenter = hh / 2;
            }

            ShapeComponentPicture scp = pic.ShapeComponentPicture;
            if (scp != null)
            {
                // ★ 왼쪽·위 잘라내기를 더한다. 그림을 잘라 쓴 개체(Left != 0)에서 그냥 w 를 넣으면
                //   실제 폭이 w - Left 가 되어 요청보다 작아진다.
                scp.RightAfterCutting = scp.LeftAfterCutting + w;
                scp.BottomAfterCutting = scp.TopAfterCutting + hh;
            }
        }

        /// <summary>
        /// ★ 표 칸 안까지 훑는다. 본문 문단만 보면 칸 안 그림의 순서를 못 봐서 새 그림이 그보다 낮게
        ///   매겨지고, 글자처럼 취급을 끄면(어울림) 겹침 순서가 뒤집힌다.
        /// </summary>
        private static int NextZOrder(HWPFile pFile)
        {
            int max = -1;
            foreach (Section sec in pFile.BodyText.SectionList) MaxZOrder(sec, ref max);
            return max + 1;
        }

        private static void MaxZOrder(IParagraphList pList, ref int pMax)
        {
            if (pList == null) return;
            for (int i = 0; i < pList.ParagraphCount; i++)
            {
                Paragraph p = pList.GetParagraph(i);
                if (p.ControlList == null) continue;
                foreach (Control c in p.ControlList)
                {
                    CtrlHeaderGso g = c.GetHeader() as CtrlHeaderGso;
                    if (g != null && g.ZOrder > pMax) pMax = g.ZOrder;

                    HwpLib.Object.BodyText.Control.ControlTable t = c as HwpLib.Object.BodyText.Control.ControlTable;
                    if (t == null || t.RowList == null) continue;
                    foreach (HwpLib.Object.BodyText.Control.Table.Row row in t.RowList)
                        foreach (HwpLib.Object.BodyText.Control.Table.Cell cell in row.CellList)
                            MaxZOrder(cell.ParagraphList, ref pMax);
                }
            }
        }

        #endregion
    }
}
