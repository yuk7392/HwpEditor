using System;
using System.Collections.Generic;
using System.Text;
using HwpEditor.Files;
using HwpEditor.Models;

namespace HwpEditor
{
    /// <summary>
    /// ★ <b>실제 문서로는 못 잡는 자리를 본다</b>. 표본 문서의 표는 병합이 얕아서, 본뜰 줄과 넣을 줄이
    ///   두 칸 이상 떨어지는 경우(= 세로 병합된 칸에 커서를 두고 "아래에 행 넣기")가 한 번도 안 나온다.
    ///   그 자리에서만 씨앗이 일부만 덮이는 상황이 생기고, 빈 자리·겹침이 난다.
    /// ★ 판정 기준은 우리 코드가 아니라 <b>표 격자가 성립하기 위한 성질</b>이다:
    ///     ① 모든 (행,열) 자리가 정확히 한 번 덮인다.
    ///     ② 모든 행·열에 칸이 최소 하나는 <b>시작</b>한다(hwp 는 칸 0개짜리 행, hwpx 는 빈 tr 이 된다).
    /// </summary>
    internal static class cGridTest
    {
        internal static int Run(string[] pArgs)
        {
            int bad = 0;

            bad += One("세로병합 아래 행 넣기 — 씨앗이 일부만 덮임",
                new[]
                {
                    Cell(0, 0, 2, 1), Cell(0, 1, 1, 2), Cell(1, 1, 2, 1),
                    Cell(1, 2, 1, 1), Cell(2, 0, 1, 1), Cell(2, 2, 1, 1)
                },
                Op("addRow", 2, 0));

            bad += One("세로병합 아래 행 넣기 — 겹침",
                new[]
                {
                    Cell(0, 3, 2, 1), Cell(0, 0, 1, 2), Cell(0, 2, 1, 1),
                    Cell(1, 0, 1, 1), Cell(1, 1, 2, 1), Cell(1, 2, 1, 1),
                    Cell(2, 0, 1, 1), Cell(2, 2, 1, 1), Cell(2, 3, 1, 1)
                },
                Op("addRow", 2, 0));

            bad += One("가로병합 오른쪽 열 넣기 — 씨앗이 일부만 덮임",
                new[]
                {
                    Cell(0, 0, 1, 2), Cell(1, 0, 2, 1), Cell(1, 1, 1, 2),
                    Cell(2, 1, 1, 1), Cell(0, 2, 1, 1), Cell(2, 2, 1, 1)
                },
                Op("addCol", 2, 0));

            bad += One("세로병합만 남기고 열 빼기 — 빈 행",
                new[] { Cell(0, 0, 2, 1), Cell(0, 1, 1, 1), Cell(1, 1, 1, 1) },
                Op("delCol", 1, -1));

            bad += One("가로병합만 남기고 행 빼기 — 빈 열",
                new[] { Cell(0, 0, 1, 2), Cell(1, 0, 1, 1), Cell(1, 1, 1, 1) },
                Op("delRow", 1, -1));

            cGridCell[] plain = { Cell(0, 0, 1, 1), Cell(0, 1, 1, 1), Cell(1, 0, 1, 1), Cell(1, 1, 1, 1) };
            bad += One("2x2 위에 행 넣기", plain, Op("addRow", 0, 0));
            bad += One("2x2 아래에 행 넣기", plain, Op("addRow", 2, 1));
            bad += One("2x2 첫 열 앞에 열 넣기", plain, Op("addCol", 0, 0));
            bad += One("2x2 마지막 열 뒤에 열 넣기", plain, Op("addCol", 2, 1));
            bad += One("2x2 행 빼기", plain, Op("delRow", 0, -1));
            bad += One("2x2 열 빼기", plain, Op("delCol", 1, -1));

            cGridCell[] like = { Cell(0, 0, 1, 1), Cell(0, 1, 1, 1), Cell(0, 2, 2, 1), Cell(1, 0, 1, 2) };
            bad += One("table.hwp 모양 — 행 넣기", like, Op("addRow", 1, 0));
            bad += One("table.hwp 모양 — 열 넣기", like, Op("addCol", 1, 0));
            bad += One("table.hwp 모양 — 세로병합 칸 아래에 행 넣기", like, Op("addRow", 2, 0));
            bad += One("table.hwp 모양 — 가로병합 칸 오른쪽에 열 넣기", like, Op("addCol", 2, 0));

            Console.WriteLine();
            Console.WriteLine("GRIDTEST fail=" + bad);
            return bad == 0 ? 0 : 1;
        }

        private static cGridCell Cell(int pR, int pC, int pRs, int pCs)
        {
            return new cGridCell { R = pR, C = pC, Rs = pRs, Cs = pCs, W = 1000 * pCs, H = 700 * pRs };
        }

        private static EditOp Op(string pOp, int pPos, int pFrom)
        {
            return new EditOp { Op = pOp, Pos = pPos, From = pFrom };
        }

        /// <summary>표 하나를 고쳐 보고 격자가 성립하는지 본다. 어긋나면 1.</summary>
        private static int One(string pName, cGridCell[] pCells, EditOp pOp)
        {
            List<cGridCell> cells = new List<cGridCell>();
            foreach (cGridCell c in pCells) cells.Add(Copy(c));

            string before = Bad(cells);
            if (before != null)
            {
                Console.WriteLine("SKIP " + pName + " — 원본부터 어긋남: " + before);
                return 1;
            }

            long grow;
            if (!cTableWriter.EditGrid(cells, pOp, out grow))
            {
                Console.WriteLine("BAD  " + pName + " — 아무것도 안 고쳤다");
                return 1;
            }

            string after = Bad(cells);
            Console.WriteLine((after == null ? "OK   " : "BAD  ") + pName
                + "  " + Shape(cells) + (after == null ? "" : "  ← " + after));
            return after == null ? 0 : 1;
        }

        private static cGridCell Copy(cGridCell pFrom)
        {
            return new cGridCell { R = pFrom.R, C = pFrom.C, Rs = pFrom.Rs, Cs = pFrom.Cs, W = pFrom.W, H = pFrom.H };
        }

        /// <summary>격자가 어긋난 이유. 성립하면 null.</summary>
        private static string Bad(List<cGridCell> pCells)
        {
            int rows = 0, cols = 0;
            foreach (cGridCell s in pCells)
            {
                if (s.R + s.Rs > rows) rows = s.R + s.Rs;
                if (s.C + s.Cs > cols) cols = s.C + s.Cs;
            }
            if (rows == 0 || cols == 0) return "칸이 없다";

            int[,] hit = new int[rows, cols];
            foreach (cGridCell s in pCells)
            {
                if (s.R < 0 || s.C < 0 || s.Rs < 1 || s.Cs < 1)
                    return "칸 좌표가 이상하다 (" + s.R + "," + s.C + "," + s.Rs + "," + s.Cs + ")";
                for (int r = s.R; r < s.R + s.Rs; r++)
                    for (int c = s.C; c < s.C + s.Cs; c++) hit[r, c]++;
            }

            for (int r = 0; r < rows; r++)
                for (int c = 0; c < cols; c++)
                {
                    if (hit[r, c] == 0) return "빈 자리 (" + r + "," + c + ")";
                    if (hit[r, c] > 1) return "겹침 (" + r + "," + c + ") " + hit[r, c] + "겹";
                }

            for (int r = 0; r < rows; r++)
            {
                bool any = false;
                foreach (cGridCell s in pCells) if (s.R == r) { any = true; break; }
                if (!any) return "칸이 하나도 시작 안 하는 행 " + r;
            }
            for (int c = 0; c < cols; c++)
            {
                bool any = false;
                foreach (cGridCell s in pCells) if (s.C == c) { any = true; break; }
                if (!any) return "칸이 하나도 시작 안 하는 열 " + c;
            }
            return null;
        }

        private static string Shape(List<cGridCell> pCells)
        {
            int rows = 0, cols = 0;
            foreach (cGridCell s in pCells)
            {
                if (s.R + s.Rs > rows) rows = s.R + s.Rs;
                if (s.C + s.Cs > cols) cols = s.C + s.Cs;
            }
            StringBuilder b = new StringBuilder();
            b.Append(rows).Append('x').Append(cols).Append(" 칸").Append(pCells.Count);
            return b.ToString();
        }
    }
}
