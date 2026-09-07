using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using HwpEditor.Models;
using HwpLib.Object;
using HwpLib.Object.BodyText;
using HwpLib.Object.BodyText.Control;
using HwpLib.Object.BodyText.Control.CtrlHeader;
using HwpLib.Object.BodyText.Control.CtrlHeader.Gso;
using HwpLib.Object.BodyText.Control.Gso;
using HwpLib.Object.BodyText.Control.Gso.ShapeComponent;
using HwpLib.Object.BodyText.Control.Gso.ShapeComponentEach;
using HwpLib.Object.BodyText.Paragraph;
using HwpLib.Object.BodyText.Paragraph.CharShape;
using HwpLib.Object.BodyText.Paragraph.LineSeg;
using HwpLib.Object.BodyText.Paragraph.Text;

namespace HwpEditor.Files
{
    /// <summary>
    /// 편집분(<see cref="EditOp"/>)을 원본 <see cref="HWPFile"/> 에 되쓴다(계획 6절).
    ///
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

            // ★ 모양을 먼저 등록한다. 화면이 매긴 번호와 문서 번호가 다를 수 있고(같은 모양 재사용, G-10),
            //   그 표가 있어야 아래에서 runs 의 cs 와 문단의 ps 를 옮겨 적을 수 있다.
            cShapes = new cShapeMap();
            cShapes.Cs = cShapeWriter.RegisterCharShapes(pFile, pReq.CharShapes);
            cShapes.Ps = cShapeWriter.RegisterParaShapes(pFile, pReq.ParaShapes);

            IList<EditOp> pOps = pReq.Ops;

            // 새 그림은 op 하나가 실물을, 다른 op 의 objs 가 자리를 들고 온다 — 먼저 짝을 지어 둔다.
            Dictionary<string, EditOp> images = new Dictionary<string, EditOp>();
            foreach (EditOp op in pOps)
                if (op.Op == "addImage" && !string.IsNullOrEmpty(op.TmpId)) images[op.TmpId] = op;

            // ★ 순서가 뜻을 갖는다: 내용 먼저(replace) → 지우기 → 넣기.
            //   넣기를 먼저 하면 insertAfter 의 기준 문단이 지워진 뒤일 수 있다.
            foreach (EditOp op in pOps) if (op.Op == "replace") ApplyReplace(pFile, pIndex, op, images, pResult);
            foreach (EditOp op in pOps) if (op.Op == "delete") ApplyDelete(pIndex, op);
            foreach (EditOp op in pOps) if (op.Op == "insertAfter") ApplyInsertAfter(pFile, pIndex, op, images, pResult);

            // ★ 표 구조는 <b>맨 마지막</b>에 바꾼다. 표를 다시 세우면 셀 문단 객체가 전부 새것이 되어
            //   그 앞에 오는 셀 문단 요청들이 사라진 객체를 가리키게 된다.
            bool rebuilt = cTableWriter.Apply(pIndex, pOps);
            if (pResult != null && rebuilt) pResult.Reload = true;

            if (pResult != null)
            {
                pResult.CsMap = cShapes.Cs;
                pResult.PsMap = cShapes.Ps;
            }
            cShapes = null;
        }

        /// <summary>이번 저장에서 쓰는 화면 번호 → 문서 번호 표. 저장 하나가 끝나면 버린다.</summary>
        private sealed class cShapeMap
        {
            public int[] Cs;
            public int[] Ps;
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
            if (!pIndex.Paras.TryGetValue(pOp.Id, out r)) return;   // 이미 없으면 할 일이 없다

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
        /// 문단의 글자열·글자모양·개체·줄 정보를 통째로 다시 만든다.
        ///
        /// ★ 원시 인덱스와 편집 인덱스가 여기서 다시 갈린다(계획 B-2). 개체는 화면에서 1글자지만
        ///   파일에서는 8글자다 — 그래서 lineseg 의 시작 위치를 되돌릴 <c>편집 → 원시</c> 표를
        ///   글자를 넣으면서 같이 만든다.
        /// </summary>
        private static void Rewrite(HWPFile pFile, cHwpIndex pIndex, Paragraph pPara, EditOp pOp,
                                    Dictionary<string, EditOp> pImages, SaveResult pResult)
        {
            pPara.Header.ParaShapeId = cShapes == null ? pOp.Ps : cShapeWriter.Map(cShapes.Ps, pOp.Ps);
            SetDivide(pPara.Header.DivideSort, pOp.Brk);

            List<cFlatChar> flat = Flatten(pOp.Runs);
            Dictionary<int, EditObj> objs = ByPosition(pOp.Objs);
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
        /// 문단 앞 강제 나눔을 화면이 보낸 대로 맞춘다.
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
        /// 탭 한 자리.
        ///
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
                if (r.Control != null) pPara.AddControl(r.Control);
                return r.Char.CharSize;
            }

            EditOp img;
            if (!string.IsNullOrEmpty(pObj.TmpId) && pImages.TryGetValue(pObj.TmpId, out img))
            {
                Control ctl = AddPicture(pFile, pPara, pText, img);
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

        private static Dictionary<int, EditObj> ByPosition(List<EditObj> pObjs)
        {
            Dictionary<int, EditObj> map = new Dictionary<int, EditObj>();
            if (pObjs == null) return map;
            foreach (EditObj o in pObjs) if (o != null) map[o.Pos] = o;
            return map;
        }

        /// <summary>
        /// 우리 레이아웃이 계산한 줄을 문단에 써 넣는다(계획 6절).
        ///
        /// ★ 지워서 한글이 다시 계산하게 두는 길도 있지만, 그러면 저장본의 줄 수가 0 이 되어
        ///   외부 변환기(convert2pdf)로는 우리 배치를 검증할 수 없다 — 2단계 판정 ④ 가 그 자리다.
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
        private static Control AddPicture(HWPFile pFile, Paragraph pPara, ParaText pText, EditOp pImg)
        {
            byte[] data = File.ReadAllBytes(pImg.File);
            int binItemId = cImageStore.Register(pFile, pImg.File, data);

            int pw, ph;
            cImageStore.PixelSize(data, out pw, out ph);

            // 화면 픽셀 → HWPUNIT 은 96dpi 기준 75배다(계획 5절 단위).
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

            // 글자처럼 취급 — 캐럿이 지나가는 줄 안에 자리를 차지한다(계획 U-5 의 반대쪽).
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

        /// <summary>이미 있는 개체보다 위에 놓는다. 없으면 0.</summary>
        private static int NextZOrder(HWPFile pFile)
        {
            int max = -1;
            foreach (Section sec in pFile.BodyText.SectionList)
                for (int i = 0; i < sec.ParagraphCount; i++)
                {
                    Paragraph p = sec.GetParagraph(i);
                    if (p.ControlList == null) continue;
                    foreach (Control c in p.ControlList)
                    {
                        CtrlHeaderGso g = c.GetHeader() as CtrlHeaderGso;
                        if (g != null && g.ZOrder > max) max = g.ZOrder;
                    }
                }
            return max + 1;
        }

        #endregion
    }
}
