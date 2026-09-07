using System;
using System.Collections.Generic;
using HwpEditor.Models;
using HwpLib.Object.BodyText.Control;
using HwpLib.Object.BodyText.Control.Table;
using HwpLib.Object.BodyText.Paragraph;
using HwpLib.Object.BodyText.Paragraph.CharShape;
using HwpLib.Object.BodyText.Paragraph.LineSeg;

namespace HwpEditor.Files
{
    /// <summary>
    /// 표 격자에서 칸 하나. hwp·hwpx 가 같은 알고리즘을 쓰도록 <b>실물을 <c>Tag</c> 에 담아</b> 옮긴다.
    /// </summary>
    public sealed class cGridCell
    {
        /// <summary>실물. hwp 는 칸 스냅샷, hwpx 는 <c>hp:tc</c> 요소다.</summary>
        public object Tag;

        public int R, C, Rs, Cs;
        public long W, H;

        /// <summary>이번에 새로 생긴 칸인가. 그러면 <see cref="Seed"/> 를 본떠 실물을 만든다.</summary>
        public bool Made;
        public cGridCell Seed;
    }

    /// <summary>
    /// 표의 행·열을 넣고 뺀다(5단계).
    ///
    /// ★ <b>표를 통째로 다시 세운다</b>. HwpLibSharp 는 행을 <c>AddNewRow</c> 로 <b>맨 뒤에만</b> 붙일 수 있고
    ///   가운데 끼워 넣는 문이 없다. 그래서 내용을 다 떠서 원하는 차례로 다시 쌓는다 —
    ///   행 하나를 넣겠다고 뒤 행들의 내용을 손으로 밀면 병합된 칸에서 반드시 어긋난다.
    /// ★ <b>칸의 행·열 번호는 목록 차례가 아니다</b>. 병합된 칸이 있으면 한 행의 칸 개수가 열 개수보다
    ///   적어서, 다시 매길 때 목록 차례를 쓰면 그 행부터 칸이 통째로 왼쪽으로 밀린다. 그래서
    ///   <b>원본이 들고 있던 번호(RowIndex·ColIndex)를 그대로 들고 다니며</b> 넣고 뺀 만큼만 더하고 뺀다.
    /// ★ 다시 세우면 셀 문단이 <b>전부 새 객체</b>가 되어 화면 id 표가 무효가 된다. 그래서 표 구조를
    ///   바꾼 저장은 끝나고 문서를 다시 읽어 화면에 보낸다(<see cref="SaveResult.Reload"/>).
    /// </summary>
    public static class cTableWriter
    {
        /// <summary>보통 줄 조각의 태그 값(cHwpWriter 와 같은 값이다).</summary>
        private const uint cSegTagNormal = 0x00060000;

        /// <summary>hwp 쪽 칸 하나를 떠 놓은 것.</summary>
        private sealed class cCellSnap
        {
            public ListHeaderForCell Header;
            public List<Paragraph> Paras = new List<Paragraph>();
        }

        public static bool IsTableOp(string pOp)
        {
            return pOp == "addRow" || pOp == "delRow" || pOp == "addCol" || pOp == "delCol";
        }

        #region 격자 편집 — hwp·hwpx 공용

        private static int RowCount(List<cGridCell> pCells)
        {
            int n = 0;
            foreach (cGridCell s in pCells) if (s.R + s.Rs > n) n = s.R + s.Rs;
            return n;
        }

        private static int ColCount(List<cGridCell> pCells)
        {
            int n = 0;
            foreach (cGridCell s in pCells) if (s.C + s.Cs > n) n = s.C + s.Cs;
            return n;
        }

        /// <summary>행 하나의 높이. 병합 안 된 칸에서 재고, 없으면 걸친 칸을 행 수로 나눈다.</summary>
        private static long RowSize(List<cGridCell> pCells, int pRow)
        {
            long best = 0, span = 0;
            foreach (cGridCell s in pCells)
            {
                if (s.R == pRow && s.Rs == 1) { if (s.H > best) best = s.H; }
                else if (s.R <= pRow && s.R + s.Rs > pRow && span == 0) span = s.H / Math.Max(1, s.Rs);
            }
            return best > 0 ? best : (span > 0 ? span : 1000);
        }

        private static long ColSize(List<cGridCell> pCells, int pCol)
        {
            long best = 0, span = 0;
            foreach (cGridCell s in pCells)
            {
                if (s.C == pCol && s.Cs == 1) { if (s.W > best) best = s.W; }
                else if (s.C <= pCol && s.C + s.Cs > pCol && span == 0) span = s.W / Math.Max(1, s.Cs);
            }
            return best > 0 ? best : (span > 0 ? span : 1000);
        }

        /// <summary>
        /// 요청대로 격자를 고친다. 고친 것이 없으면 false. <paramref name="pGrow"/> 는 표가 커진 폭·높이다.
        /// 새로 생긴 칸은 <see cref="cGridCell.Made"/> 로 표시되고 <see cref="cGridCell.Seed"/> 에 본이 담긴다.
        /// </summary>
        public static bool EditGrid(List<cGridCell> pCells, EditOp pOp, out long pGrow)
        {
            bool did = EditOne(pCells, pOp, out pGrow);
            if (did) Compact(pCells);
            return did;
        }

        private static bool EditOne(List<cGridCell> pCells, EditOp pOp, out long pGrow)
        {
            pGrow = 0;
            int rows = RowCount(pCells), cols = ColCount(pCells);
            if (rows == 0 || cols == 0) return false;

            switch (pOp.Op)
            {
                case "addRow":
                    {
                        int at = Clamp(pOp.Pos, 0, rows);
                        int from = Clamp(pOp.From >= 0 ? pOp.From : (at > 0 ? at - 1 : 0), 0, rows - 1);
                        long size = RowSize(pCells, from);

                        // ① 새 행 자리를 이미 가로지르는 칸이 덮는 열에는 칸을 새로 만들지 않는다.
                        HashSet<int> covered = new HashSet<int>();
                        foreach (cGridCell s in pCells)
                            if (s.R < at && s.R + s.Rs > at)
                                for (int k = 0; k < s.Cs; k++) covered.Add(s.C + k);

                        // ② 본뜰 행을 덮는 칸에서 빈 칸을 뜬다. ★ 번호를 미는 것보다 <b>먼저</b> 판단해야
                        //    방금 민 칸을 본뜨지 않는다.
                        List<cGridCell> made = new List<cGridCell>();
                        foreach (cGridCell s in pCells)
                        {
                            if (s.R > from || s.R + s.Rs <= from) continue;
                            made.AddRange(Runs(s, covered, at, true, size));
                        }

                        foreach (cGridCell s in pCells)
                        {
                            if (s.R < at && s.R + s.Rs > at) { s.Rs++; s.H += size; }
                            else if (s.R >= at) s.R++;
                        }
                        pCells.AddRange(made);
                        pGrow = size;
                        return true;
                    }

                case "delRow":
                    {
                        // ★ 마지막 한 행은 남긴다 — 행이 없는 표는 문서를 깨뜨린다.
                        int at = pOp.Pos;
                        if (rows <= 1 || at < 0 || at >= rows) return false;
                        long size = RowSize(pCells, at);

                        List<cGridCell> keep = new List<cGridCell>();
                        foreach (cGridCell s in pCells)
                        {
                            if (s.R == at)
                            {
                                if (s.Rs <= 1) continue;              // 통째로 빠진다
                                s.Rs--; s.H -= size;                   // 시작 행만 줄면 R 이 곧 다음 행이다
                            }
                            else if (s.R < at && s.R + s.Rs > at) { s.Rs--; s.H -= size; }
                            else if (s.R > at) s.R--;
                            keep.Add(s);
                        }
                        pCells.Clear();
                        pCells.AddRange(keep);
                        pGrow = -size;
                        return true;
                    }

                case "addCol":
                    {
                        int at = Clamp(pOp.Pos, 0, cols);
                        int from = Clamp(pOp.From >= 0 ? pOp.From : (at > 0 ? at - 1 : 0), 0, cols - 1);
                        long size = ColSize(pCells, from);

                        HashSet<int> covered = new HashSet<int>();
                        foreach (cGridCell s in pCells)
                            if (s.C < at && s.C + s.Cs > at)
                                for (int k = 0; k < s.Rs; k++) covered.Add(s.R + k);

                        List<cGridCell> made = new List<cGridCell>();
                        foreach (cGridCell s in pCells)
                        {
                            if (s.C > from || s.C + s.Cs <= from) continue;
                            made.AddRange(Runs(s, covered, at, false, size));
                        }

                        foreach (cGridCell s in pCells)
                        {
                            if (s.C < at && s.C + s.Cs > at) { s.Cs++; s.W += size; }
                            else if (s.C >= at) s.C++;
                        }
                        pCells.AddRange(made);
                        pGrow = size;
                        return true;
                    }

                case "delCol":
                    {
                        int at = pOp.Pos;
                        if (cols <= 1 || at < 0 || at >= cols) return false;
                        long size = ColSize(pCells, at);

                        List<cGridCell> keep = new List<cGridCell>();
                        foreach (cGridCell s in pCells)
                        {
                            if (s.C == at)
                            {
                                if (s.Cs <= 1) continue;
                                s.Cs--; s.W -= size;
                            }
                            else if (s.C < at && s.C + s.Cs > at) { s.Cs--; s.W -= size; }
                            else if (s.C > at) s.C--;
                            keep.Add(s);
                        }
                        pCells.Clear();
                        pCells.AddRange(keep);
                        pGrow = -size;
                        return true;
                    }
            }
            return false;
        }

        /// <summary>
        /// 씨앗 하나에서 <b>아직 안 덮인 구간마다</b> 빈 칸을 뜬다.
        ///
        /// ★ 씨앗의 첫 칸 번호 하나로 "덮였나" 를 판정하면 안 된다. 씨앗이 두 칸에 걸쳐 있는데
        ///   그중 한 칸만 이미 덮여 있으면, 통째로 건너뛰어 <b>빈 자리</b>가 생기거나 통째로 복제해
        ///   <b>겹침</b>이 생긴다. 둘 다 "모든 자리가 정확히 한 번" 계약을 깬다.
        ///   (걸리는 입력: 세로 병합된 칸에 커서를 두고 "아래에 행 넣기" — 그때만 본뜰 줄과 넣을 줄이
        ///    두 칸 이상 떨어져서 가로지르는 칸이 생긴다.)
        /// </summary>
        private static List<cGridCell> Runs(cGridCell pSeed, HashSet<int> pCovered, int pAt, bool pRow, long pSize)
        {
            List<cGridCell> made = new List<cGridCell>();
            int start = pRow ? pSeed.C : pSeed.R;
            int span = pRow ? pSeed.Cs : pSeed.Rs;
            long size = pRow ? pSeed.W : pSeed.H;

            int k = start, end = start + span;
            while (k < end)
            {
                while (k < end && pCovered.Contains(k)) k++;
                int run = k;
                while (k < end && !pCovered.Contains(k)) k++;
                if (k <= run) continue;

                long part = size * (k - run) / Math.Max(1, span);      // 걸친 만큼 크기도 나눈다
                made.Add(pRow ? New(pSeed, pAt, run, 1, k - run, part, pSize)
                              : New(pSeed, run, pAt, k - run, 1, pSize, part));
            }
            return made;
        }

        /// <summary>
        /// 칸이 하나도 <b>시작하지 않는</b> 행·열을 접는다.
        ///
        /// ★ 그런 행은 hwp 에서 <c>CellCountOfRow = 0</c>, hwpx 에서 빈 <c>hp:tr</c> 이 되어
        ///   여는 쪽이 표를 못 읽는다. "모든 자리가 정확히 한 번 덮인다" 검사로는 안 잡힌다 —
        ///   위 행에서 내려온 칸이 그 자리를 이미 덮고 있기 때문이다.
        ///   (걸리는 입력: 세로 병합된 열만 남기고 나머지 열을 빼는 경우.)
        /// </summary>
        private static void Compact(List<cGridCell> pCells)
        {
            for (int r = RowCount(pCells) - 1; r >= 0; r--)
            {
                if (Starts(pCells, r, true)) continue;
                long size = RowSize(pCells, r);
                foreach (cGridCell s in pCells)
                {
                    if (s.R < r && s.R + s.Rs > r) { s.Rs--; s.H -= size; }
                    else if (s.R > r) s.R--;
                }
            }

            for (int c = ColCount(pCells) - 1; c >= 0; c--)
            {
                if (Starts(pCells, c, false)) continue;
                long size = ColSize(pCells, c);
                foreach (cGridCell s in pCells)
                {
                    if (s.C < c && s.C + s.Cs > c) { s.Cs--; s.W -= size; }
                    else if (s.C > c) s.C--;
                }
            }
        }

        private static bool Starts(List<cGridCell> pCells, int pAt, bool pRow)
        {
            foreach (cGridCell s in pCells) if ((pRow ? s.R : s.C) == pAt) return true;
            return false;
        }

        /// <summary>격자에서 나온 표 폭·높이. 병합 안 된 칸에서 재고 걸친 칸은 모자란 만큼 나눠 얹는다.</summary>
        public static long GridWidth(List<cGridCell> pCells) { return Extent(pCells, false); }
        public static long GridHeight(List<cGridCell> pCells) { return Extent(pCells, true); }

        private static long Extent(List<cGridCell> pCells, bool pRow)
        {
            int n = pRow ? RowCount(pCells) : ColCount(pCells);
            long[] size = new long[n];

            foreach (cGridCell s in pCells)
            {
                int at = pRow ? s.R : s.C, span = pRow ? s.Rs : s.Cs;
                long want = pRow ? s.H : s.W;
                if (span == 1 && want > size[at]) size[at] = want;
            }
            foreach (cGridCell s in pCells)
            {
                int at = pRow ? s.R : s.C, span = pRow ? s.Rs : s.Cs;
                long want = pRow ? s.H : s.W;
                if (span == 1) continue;

                long have = 0;
                for (int k = at; k < at + span && k < n; k++) have += size[k];
                if (want <= have) continue;
                long add = (want - have) / span;
                for (int k = at; k < at + span && k < n; k++) size[k] += add;
            }

            long all = 0;
            for (int i = 0; i < n; i++) all += size[i];
            return all;
        }

        /// <summary>격자를 행 → 열 차례로 세운다. 다시 쌓는 쪽은 이 차례를 그대로 따라간다.</summary>
        public static void SortGrid(List<cGridCell> pCells)
        {
            pCells.Sort(delegate (cGridCell a, cGridCell b) { return a.R != b.R ? a.R - b.R : a.C - b.C; });
        }

        public static int GridRows(List<cGridCell> pCells) { return RowCount(pCells); }
        public static int GridCols(List<cGridCell> pCells) { return ColCount(pCells); }

        private static cGridCell New(cGridCell pSeed, int pR, int pC, int pRs, int pCs, long pW, long pH)
        {
            return new cGridCell
            {
                Made = true, Seed = pSeed,
                R = pR, C = pC, Rs = pRs, Cs = pCs, W = pW, H = pH
            };
        }

        private static int Clamp(int pValue, int pMin, int pMax)
        {
            return pValue < pMin ? pMin : (pValue > pMax ? pMax : pValue);
        }

        #endregion

        #region hwp

        /// <summary>표 구조를 바꾸는 요청을 반영한다. 하나라도 반영했으면 true(문서를 다시 읽어야 한다).</summary>
        public static bool Apply(cHwpIndex pIndex, IList<EditOp> pOps)
        {
            bool any = false;
            foreach (EditOp op in pOps)
            {
                if (!IsTableOp(op.Op)) continue;

                cObjRef r;
                if (string.IsNullOrEmpty(op.Oid) || !pIndex.Objs.TryGetValue(op.Oid, out r)) continue;

                ControlTable tbl = r.Control as ControlTable;
                if (tbl == null) continue;

                List<cGridCell> cells = Snapshot(tbl);

                long grow;
                if (!EditGrid(cells, op, out grow)) continue;

                foreach (cGridCell g in cells)
                    if (g.Made) g.Tag = EmptyLike((cCellSnap)g.Seed.Tag);

                Rebuild(tbl, cells);
                Resize(tbl, cells);
                any = true;
            }
            return any;
        }

        private static List<cGridCell> Snapshot(ControlTable pTable)
        {
            List<cGridCell> all = new List<cGridCell>();
            foreach (Row row in pTable.RowList)
                foreach (Cell cell in row.CellList)
                {
                    cCellSnap s = new cCellSnap();
                    // ★ ListHeaderForCell 에는 Clone 이 없다 — 빈 것을 만들어 Copy 로 옮긴다.
                    s.Header = new ListHeaderForCell();
                    s.Header.Copy(cell.ListHeader);
                    if (cell.ParagraphList != null)
                        foreach (Paragraph p in cell.ParagraphList.GetParagraphs()) s.Paras.Add(p);

                    all.Add(new cGridCell
                    {
                        Tag = s,
                        R = cell.ListHeader.RowIndex,
                        C = cell.ListHeader.ColIndex,
                        Rs = Math.Max(1, cell.ListHeader.RowSpan),
                        Cs = Math.Max(1, cell.ListHeader.ColSpan),
                        W = cell.ListHeader.Width,
                        H = cell.ListHeader.Height
                    });
                }
            return all;
        }

        /// <summary>같은 모양의 빈 칸 하나. 글은 비우고 크기·테두리는 본떠 온다.</summary>
        private static cCellSnap EmptyLike(cCellSnap pFrom)
        {
            cCellSnap s = new cCellSnap();
            s.Header = new ListHeaderForCell();
            s.Header.Copy(pFrom.Header);
            s.Header.ParaCount = 1;

            // 빈 문단 하나. 원본 문단을 복제해 글자만 비우면 글자모양·문단모양을 그대로 물려받는다.
            Paragraph seed = pFrom.Paras.Count > 0 ? pFrom.Paras[0].Clone() : new Paragraph();
            if (seed.Text == null) seed.CreateText();
            seed.Text.Clear();
            seed.Text.AddChar(new HwpLib.Object.BodyText.Paragraph.Text.HWPCharControlChar(13));
            seed.Header.CharacterCount = 1;
            if (seed.ControlList != null) while (seed.ControlList.Count > 0) seed.RemoveControlAt(seed.ControlList.Count - 1);

            // ★ 글자 수만 줄이면 안 된다 — 본뜬 문단이 40글자·3짝이었으면 위치 20·38 짜리 글자모양 짝과
            //   줄 조각 3개가 1글자 문단에 그대로 남는다. 저장은 되고 <b>여는 쪽에서만</b> 깨진다
            //   (cHwpWriter.ClearButControls 가 같은 자리에서 이미 실측해 둔 함정이다).
            ParaCharShape cs = seed.CharShape;
            if (cs != null)
            {
                int first = cs.PositionShapeIdPairList.Count > 0
                          ? (int)cs.PositionShapeIdPairList[0].ShapeId : 0;
                while (cs.PositionShapeIdPairList.Count > 0)
                    cs.RemoveParaCharShapeAt(cs.PositionShapeIdPairList.Count - 1);
                cs.AddParaCharShape(0, first);
                seed.Header.CharShapeCount = 1;
            }

            seed.DeleteLineSeg();
            seed.CreateLineSeg();
            LineSegItem only = seed.LineSeg.AddNewLineSegItem();
            only.LineHeight = 1000;
            only.TextPartHeight = 1000;
            only.LineSpace = 600;
            only.DistanceBaseLineToLineVerticalPosition = 850;
            only.SegmentWidth = (int)Math.Max(200L, pFrom.Header != null
                ? pFrom.Header.Width - pFrom.Header.LeftMargin - pFrom.Header.RightMargin : 4000L);
            only.Tag.Value = cSegTagNormal;
            seed.Header.LineAlignCount = 1;

            // ★ 새 칸에서는 이 문단이 <b>목록의 유일한 마지막 문단</b>이다. 본뜬 칸에 문단이 둘 이상이었으면
            //   false 를 물려받는데, 그러면 여는 쪽이 뒤에 문단이 더 있다고 읽는다.
            seed.Header.LastInList = true;

            s.Paras.Add(seed);
            return s;
        }

        private static void Rebuild(ControlTable pTable, List<cGridCell> pCells)
        {
            SortGrid(pCells);
            while (pTable.RowList.Count > 0) pTable.RemoveRow(0);

            int rows = RowCount(pCells), cols = ColCount(pCells);
            List<int> perRow = new List<int>();

            for (int r = 0; r < rows; r++)
            {
                Row row = pTable.AddNewRow();
                int n = 0;

                foreach (cGridCell g in pCells)
                {
                    if (g.R != r) continue;
                    cCellSnap s = (cCellSnap)g.Tag;

                    Cell cell = row.AddNewCell();
                    cell.ListHeader.Copy(s.Header);

                    // ★ 번호는 격자 좌표를 그대로 쓴다(목록 차례가 아니다 — 클래스 머리말 참조).
                    cell.ListHeader.RowIndex = g.R;
                    cell.ListHeader.ColIndex = g.C;
                    cell.ListHeader.RowSpan = g.Rs;
                    cell.ListHeader.ColSpan = g.Cs;
                    cell.ListHeader.Width = g.W;
                    cell.ListHeader.Height = g.H;
                    cell.ListHeader.TextWidth =
                        Math.Max(0, g.W - cell.ListHeader.LeftMargin - cell.ListHeader.RightMargin);
                    cell.ListHeader.ParaCount = Math.Max(1, s.Paras.Count);

                    for (int p = 0; p < s.Paras.Count; p++) cell.ParagraphList.AddParagraph(s.Paras[p]);
                    if (s.Paras.Count == 0) cell.ParagraphList.AddNewParagraph();
                    n++;
                }
                perRow.Add(n);
            }

            // 표 머리의 개수도 같이 맞춘다 — 안 맞으면 여는 쪽이 행을 덜 읽거나 더 읽는다.
            Table t = pTable.Table;
            if (t != null)
            {
                t.RowCount = rows;
                t.ColumnCount = cols;
                t.ClearCellCountOfRowList();
                for (int r = 0; r < perRow.Count; r++) t.AddCellCountOfRow(perRow[r]);
            }
        }

        /// <summary>
        /// 표 바깥 크기를 <b>격자에서 다시 낸다</b>. 안 하면 열을 늘려도 표가 원래 폭에 갇혀 글이 밖으로 나간다.
        ///
        /// ★ "얼마 늘었다" 를 더하고 빼는 방식은 쓰지 않는다 — 빈 행 접기까지 얹히면 더할 값이 갈래마다
        ///   달라지고, 하나라도 빠지면 표 크기와 칸 크기 합이 조용히 어긋난다. 표본 23개에서 칸 폭 합과
        ///   파일이 적어 둔 표 폭이 완전히 같았으므로(실측 오차 0) 다시 내도 원본이 안 바뀐다.
        /// </summary>
        private static void Resize(ControlTable pTable, List<cGridCell> pCells)
        {
            if (pTable.Header == null) return;
            pTable.Header.Width = (uint)Math.Max(0, GridWidth(pCells));
            pTable.Header.Height = (uint)Math.Max(0, GridHeight(pCells));
        }

        #endregion
    }
}
