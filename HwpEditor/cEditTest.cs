using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using HwpEditor.Files;
using HwpEditor.Models;
using Newtonsoft.Json;

namespace HwpEditor
{
    /// <summary>
    /// ★ 화면과 <b>같은 계약</b>으로 잰다 — 여기서 만드는 것은 화면이 저장할 때 보내는 것과 같은
    ///   <see cref="EditOp"/> 목록이다. 다른 길로 고쳐 놓고 통과했다고 하면 화면은 검사한 적이 없다.
    /// </summary>
    internal static class cEditTest
    {
        #region --edit-test

        internal static int RunEdit(string[] pArgs)
        {
            if (pArgs.Length < 3) { Console.WriteLine("사용법: --edit-test <입력> <출력> [바꿀글자]"); return 2; }

            string src = pArgs[1], dst = pArgs[2];
            string want = pArgs.Length > 3 ? pArgs[3] : "테스트123";

            cDocument doc = cDocument.Open(src);
            DocModel before = doc.Model;
            cSnapshot b4 = cSnapshot.Of(before);

            if (before.Sections.Count == 0 || before.Sections[0].Paras.Count == 0)
            { Console.WriteLine("문단이 없다: " + src); return 2; }

            ParagraphModel p0 = before.Sections[0].Paras[0];
            EditOp op = ReplaceText(p0, want);

            SaveResult r = doc.Save(dst, new List<EditOp> { op });
            if (!r.Ok) { Console.WriteLine("저장 실패"); return 3; }

            cDocument re = cDocument.Open(dst);
            cSnapshot after = cSnapshot.Of(re.Model);

            int code = Report(Path.GetFileName(src) + " (1회차)", b4, after, want, 0, 0);

            // ★ 두 번째 저장까지 본다. 편집기는 상태를 들고 있는 물건이라 <b>두 번째에 깨진다</b> —
            //   첫 저장 뒤에도 문단 id 표가 살아 있어야 같은 문단을 다시 고칠 수 있고,
            //   스타일 밀림 보정도 저장할 때마다 누적되면 안 된다.
            string want2 = want + "2";
            string dst2 = Path.Combine(Path.GetDirectoryName(dst) ?? ".",
                Path.GetFileNameWithoutExtension(dst) + "-2" + Path.GetExtension(dst));

            EditOp op2 = ReplaceText(p0, want2);
            SaveResult r2 = doc.Save(dst2, new List<EditOp> { op2 });
            if (!r2.Ok) { Console.WriteLine("두 번째 저장 실패"); return 3; }

            cSnapshot after2 = cSnapshot.Of(cDocument.Open(dst2).Model);
            Console.WriteLine();
            int code2 = Report(Path.GetFileName(src) + " (2회차)", b4, after2, want2, 0, 0);

            return code != 0 ? code : code2;
        }

        /// <summary>
        /// 문단의 글자만 바꾸는 요청. ★ <c>objs</c> 는 <b>빠짐없이</b> 다시 실어야 한다 —
        /// 목록에 없는 개체는 되쓰기가 지워 버린다(용지 정의가 여기 든다).
        /// </summary>
        private static EditOp ReplaceText(ParagraphModel pPara, string pText)
        {
            EditOp op = new EditOp();
            op.Op = "replace";
            op.Id = pPara.Id;
            op.Ps = pPara.Ps;

            int cs = pPara.Runs.Count > 0 ? pPara.Runs[0].Cs : 0;
            op.Runs = new List<RunModel>();
            op.Runs.Add(new RunModel { Cs = cs, Text = pText });

            op.Objs = new List<EditObj>();
            int at = 0;
            foreach (InlineObjModel o in pPara.Objs)
            {
                op.Objs.Add(new EditObj { Pos = at, Oid = o.Oid });
                at++;
            }

            op.Seg = OneLine(pPara, pText.Length + op.Objs.Count);
            return op;
        }

        /// <summary>줄 정보는 화면이 계산해 보내는 자리다. 검사 통로는 한 줄짜리로 채운다.</summary>
        private static List<SegModel> OneLine(ParagraphModel pPara, int pLen)
        {
            SegModel s = new SegModel();
            s.S = 0;
            s.Y = pPara.Seg != null && pPara.Seg.Count > 0 ? pPara.Seg[0].Y : 0;
            s.Th = pPara.Seg != null && pPara.Seg.Count > 0 && pPara.Seg[0].Th > 0 ? pPara.Seg[0].Th : 1000;
            s.H = (long)(s.Th * 1.6);
            s.B = (long)(s.Th * 0.85);
            s.X = pPara.Seg != null && pPara.Seg.Count > 0 ? pPara.Seg[0].X : 0;
            s.W = pPara.Seg != null && pPara.Seg.Count > 0 && pPara.Seg[0].W > 0 ? pPara.Seg[0].W : 42520;
            return new List<SegModel> { s };
        }

        #endregion

        #region --image-test

        internal static int RunImage(string[] pArgs)
        {
            if (pArgs.Length < 4) { Console.WriteLine("사용법: --image-test <입력> <출력> <그림파일>"); return 2; }

            string src = pArgs[1], dst = pArgs[2], img = pArgs[3];
            if (!File.Exists(img)) { Console.WriteLine("그림 파일이 없다: " + img); return 2; }

            cDocument doc = cDocument.Open(src);
            DocModel before = doc.Model;
            cSnapshot b4 = cSnapshot.Of(before);

            ParagraphModel p0 = before.Sections[0].Paras[0];

            // 원래 글자·개체는 그대로 두고 맨 끝에 그림 한 자리만 더한다.
            EditOp rep = new EditOp();
            rep.Op = "replace";
            rep.Id = p0.Id;
            rep.Ps = p0.Ps;
            rep.Runs = p0.Runs;
            rep.Objs = new List<EditObj>();
            foreach (InlineObjModel o in p0.Objs) rep.Objs.Add(new EditObj { Pos = o.Pos, Oid = o.Oid });
            rep.Objs.Add(new EditObj { Pos = p0.Len, TmpId = "img1" });
            rep.Seg = OneLine(p0, p0.Len + 1);

            EditOp add = new EditOp();
            add.Op = "addImage";
            add.Id = p0.Id;
            add.Pos = p0.Len;
            add.TmpId = "img1";
            add.File = Path.GetFullPath(img);

            SaveResult r = doc.Save(dst, new List<EditOp> { rep, add });
            if (!r.Ok) { Console.WriteLine("저장 실패"); return 3; }

            cDocument re = cDocument.Open(dst);
            cSnapshot after = cSnapshot.Of(re.Model);

            return Report(Path.GetFileName(src), b4, after, null, 1, 0);
        }

        #endregion

        #region --obj-test

        /// <summary>
        /// ★ 값이 바뀐 것만 보지 않는다 — <b>손 안 댄 개체와 글자가 그대로인지</b>도 같이 본다.
        ///   되쓰기가 개체를 통째로 덮어써도 "바뀌었다" 는 통과하기 때문이다.
        /// </summary>
        internal static int RunObj(string[] pArgs)
        {
            if (pArgs.Length < 3) { Console.WriteLine("사용법: --obj-test <입력> <출력>"); return 2; }

            string src = pArgs[1], dst = pArgs[2];

            cDocument doc = cDocument.Open(src);
            DocModel before = doc.Model;
            cSnapshot b4 = cSnapshot.Of(before);

            // 그림을 우선으로 고른다 — 크기 되쓰기가 안쪽 사각형까지 손대는 것은 그림뿐이다.
            ParagraphModel host = null;
            InlineObjModel target = null;
            foreach (SectionModel sec in before.Sections)
                foreach (ParagraphModel p in sec.Paras)
                    foreach (InlineObjModel o in p.Objs)
                    {
                        if (o.Hidden == true || o.WHu <= 0 || o.Table != null) continue;
                        if (target == null || (o.Kind == "image" && target.Kind != "image")) { host = p; target = o; }
                    }

            if (target == null) { Console.WriteLine("크기를 가진 개체가 없다: " + src); return 2; }

            long wantW = target.WHu * 2, wantH = target.HHu * 2;
            long wantX = target.XOffHu + 5000, wantY = target.YOffHu;
            bool wantInline = !target.Inline;
            int pos = target.Pos;
            string kind = target.Kind, oid = target.Oid;

            Console.WriteLine("개체 " + oid + " (" + kind + ") 를 " + host.Id + " 에서 고친다");
            Console.WriteLine("  크기 " + target.WHu + "x" + target.HHu + " → " + wantW + "x" + wantH);
            Console.WriteLine("  자리 " + target.XOffHu + "," + target.YOffHu + " → " + wantX + "," + wantY);
            Console.WriteLine("  취급 " + (target.Inline ? "글자처럼" : "어울림") + " → " + (wantInline ? "글자처럼" : "어울림"));
            Console.WriteLine();

            EditOp rep = new EditOp();
            rep.Op = "replace";
            rep.Id = host.Id;
            rep.Ps = host.Ps;
            rep.Runs = host.Runs;
            rep.Seg = host.Seg;
            rep.Objs = new List<EditObj>();
            foreach (InlineObjModel o in host.Objs)
            {
                EditObj e = new EditObj();
                e.Pos = o.Pos;
                e.Oid = o.Oid;
                if (ReferenceEquals(o, target))
                {
                    e.WHu = wantW; e.HHu = wantH; e.XOffHu = wantX; e.YOffHu = wantY;
                    e.Inline = wantInline;
                }
                rep.Objs.Add(e);
            }

            SaveResult r = doc.Save(dst, new List<EditOp> { rep });
            if (!r.Ok) { Console.WriteLine("저장 실패: " + r.Msg); return 3; }

            cDocument re = cDocument.Open(dst);
            InlineObjModel got = ObjAt(re.Model, host.Id, pos);
            if (got == null) { Console.WriteLine("저장본에서 그 개체를 못 찾았다 (" + host.Id + " pos " + pos + ")"); return 3; }

            bool ok = true;
            Console.WriteLine("| 항목 | 저장 후 | 기대 | 판정 |");
            Console.WriteLine("|---|---|---|---|");
            ok &= Row2("너비", got.WHu, wantW);
            ok &= Row2("높이", got.HHu, wantH);
            ok &= Row2("가로 자리", got.XOffHu, wantX);
            ok &= Row2("세로 자리", got.YOffHu, wantY);

            bool inlineOk = got.Inline == wantInline;
            Console.WriteLine("| {0} | {1} | {2} | {3} |", "글자처럼 취급",
                got.Inline ? "예" : "아니오", wantInline ? "예" : "아니오", inlineOk ? "OK" : "다름");
            ok &= inlineOk;
            Console.WriteLine();

            int structOk = Report(Path.GetFileName(src) + " (구조)", b4, cSnapshot.Of(re.Model), null, 0, 0);
            return (ok && structOk == 0) ? 0 : 1;
        }

        private static bool Row2(string pName, long pGot, long pWant)
        {
            bool ok = pGot == pWant;
            Console.WriteLine("| {0} | {1} | {2} | {3} |", pName, pGot, pWant, ok ? "OK" : "다름");
            return ok;
        }

        /// <summary>저장본에서 (문단 id, 자리)로 개체를 다시 찾는다. 표 칸 안까지 훑는다.</summary>
        private static InlineObjModel ObjAt(DocModel pDoc, string pParaId, int pPos)
        {
            foreach (SectionModel sec in pDoc.Sections)
                foreach (ParagraphModel p in sec.Paras)
                {
                    InlineObjModel hit = ObjInPara(p, pParaId, pPos);
                    if (hit != null) return hit;
                }
            return null;
        }

        private static InlineObjModel ObjInPara(ParagraphModel pPara, string pParaId, int pPos)
        {
            if (pPara.Id == pParaId)
                foreach (InlineObjModel o in pPara.Objs)
                    if (o.Pos == pPos) return o;

            foreach (InlineObjModel o in pPara.Objs)
            {
                if (o.Table == null) continue;
                foreach (CellModel c in o.Table.Cells)
                    foreach (ParagraphModel cp in c.Paras)
                    {
                        InlineObjModel hit = ObjInPara(cp, pParaId, pPos);
                        if (hit != null) return hit;
                    }
            }
            return null;
        }

        #endregion

        #region --apply

        internal static int RunApply(string[] pArgs)
        {
            if (pArgs.Length < 4) { Console.WriteLine("사용법: --apply <입력> <출력> <ops.json>"); return 2; }

            string json = File.ReadAllText(pArgs[3], Encoding.UTF8);
            SaveRequest req = JsonConvert.DeserializeObject<SaveRequest>(json);
            if (req == null || req.Ops == null) { Console.WriteLine("ops 를 못 읽었다"); return 2; }

            cDocument doc = cDocument.Open(pArgs[1]);
            cSnapshot b4 = cSnapshot.Of(doc.Model);

            SaveResult r = doc.Save(pArgs[2], req);
            cSnapshot after = cSnapshot.Of(cDocument.Open(pArgs[2]).Model);

            Console.WriteLine("op " + req.Ops.Count + "개 반영"
                            + (req.CharShapes != null ? " (화면 글자모양 " + req.CharShapes.Count + "개)" : ""));
            Console.WriteLine("  원본 " + b4);
            Console.WriteLine("  저장 " + after);

            // ★ 표 구조를 바꾸거나 표를 새로 넣은 저장은 <b>반드시</b> 다시 읽어야 한다 — 칸 문단 객체가
            //   전부 새것이라, 안 읽으면 화면이 들고 있는 칸 문단 id 가 문서에 없는 값이 되어
            //   그 뒤 칸 편집이 저장 요청에서 조용히 빠진다.
            bool needReload = false;
            foreach (EditOp op in req.Ops)
                if (op.Op == "addTable" || cTableWriter.IsTableOp(op.Op)) { needReload = true; break; }
            if (needReload && !r.Reload) Console.WriteLine("  ! 표를 건드렸는데 reload 를 안 켰다");

            // ★ 같은 요청을 한 번 더 먹인다 — <b>모양이 또 느는지</b>만 본다.
            //   같은 서식을 다시 걸 때마다 모양이 늘면 그 문서는 열 때마다 무거워진다.
            //   문단 수는 여기서 안 본다: 이건 화면이 두 번 저장한 것이 아니라 같은 요청을 그대로
            //   다시 먹인 것이라 insertAfter 가 또 도는 것이 맞다(화면은 저장한 뒤 그 요청을 안 낸다).
            string dst2 = Path.Combine(Path.GetDirectoryName(pArgs[2]) ?? ".",
                Path.GetFileNameWithoutExtension(pArgs[2]) + "-again" + Path.GetExtension(pArgs[2]));
            doc.Save(dst2, req);
            cSnapshot twice = cSnapshot.Of(cDocument.Open(dst2).Model);
            Console.WriteLine("  두 번 " + twice);

            bool grew = twice.CharShapes != after.CharShapes || twice.ParaShapes != after.ParaShapes
                     || twice.BorderFills != after.BorderFills;
            Console.WriteLine();
            Console.WriteLine(grew
                ? "두 번 먹였더니 모양이 늘었다 — 실패 (cs " + after.CharShapes + "→" + twice.CharShapes
                  + ", ps " + after.ParaShapes + "→" + twice.ParaShapes
                  + ", bf " + after.BorderFills + "→" + twice.BorderFills + ")"
                : "두 번 먹여도 모양 개수 그대로 — 통과");
            return (r.Ok && !grew && !(needReload && !r.Reload)) ? 0 : 3;
        }

        #endregion

        #region 대조

        /// <summary>
        /// ★ "저장이 됐다" 가 아니라 <b>무엇이 그대로이고 무엇만 바뀌었나</b>를 본다 —
        /// 되쓰기가 조용히 망가뜨리는 것은 우리가 손댄 문단이 아니라 그 옆이다.
        /// </summary>
        private static int Report(string pName, cSnapshot pBefore, cSnapshot pAfter,
                                  string pWantFirstText, int pImageDelta, int pParaDelta)
        {
            bool ok = true;

            Console.WriteLine("| 항목 | 원본 | 저장 후 | 기대 | 판정 |");
            Console.WriteLine("|---|---|---|---|---|");

            ok &= Row("문단 수", pBefore.Paras, pAfter.Paras, pBefore.Paras + pParaDelta);
            ok &= Row("개체 수", pBefore.Objs, pAfter.Objs, pBefore.Objs + pImageDelta);
            ok &= Row("그림 수", pBefore.Images, pAfter.Images, pBefore.Images + pImageDelta);
            ok &= Row("표 수", pBefore.Tables, pAfter.Tables, pBefore.Tables);
            ok &= Row("글자모양 수", pBefore.CharShapes, pAfter.CharShapes, pBefore.CharShapes);
            ok &= Row("문단모양 수", pBefore.ParaShapes, pAfter.ParaShapes, pBefore.ParaShapes);

            bool tailSame = pBefore.TailHash == pAfter.TailHash;
            Console.WriteLine("| 첫 문단 뺀 본문 | {0} | {1} | 같음 | {2} |",
                pBefore.TailHash, pAfter.TailHash, tailSame ? "OK" : "다름");
            ok &= tailSame;

            if (pWantFirstText != null)
            {
                bool same = pAfter.FirstText == pWantFirstText;
                Console.WriteLine("| 첫 문단 글자 | \"{0}\" | \"{1}\" | \"{2}\" | {3} |",
                    pBefore.FirstText, pAfter.FirstText, pWantFirstText, same ? "OK" : "다름");
                ok &= same;
            }
            else
            {
                bool same = pAfter.FirstText == pBefore.FirstText;
                Console.WriteLine("| 첫 문단 글자 | \"{0}\" | \"{1}\" | 같음 | {2} |",
                    pBefore.FirstText, pAfter.FirstText, same ? "OK" : "다름");
                ok &= same;
            }

            Console.WriteLine();
            Console.WriteLine(pName + " — " + (ok ? "통과" : "실패"));
            return ok ? 0 : 1;
        }

        private static bool Row(string pName, int pBefore, int pAfter, int pWant)
        {
            bool ok = pAfter == pWant;
            Console.WriteLine("| {0} | {1} | {2} | {3} | {4} |", pName, pBefore, pAfter, pWant, ok ? "OK" : "다름");
            return ok;
        }

        private sealed class cSnapshot
        {
            internal int Paras, Objs, Images, Tables, CharShapes, ParaShapes, BorderFills;
            internal string FirstText, TailHash;

            internal static cSnapshot Of(DocModel pDoc)
            {
                cSnapshot s = new cSnapshot();
                s.CharShapes = pDoc.CharShapes.Count;
                s.ParaShapes = pDoc.ParaShapes.Count;
                s.BorderFills = pDoc.BorderFills.Count;

                StringBuilder tail = new StringBuilder();
                bool first = true;

                foreach (SectionModel sec in pDoc.Sections)
                    foreach (ParagraphModel p in sec.Paras)
                    {
                        s.Paras++;
                        Count(p, s);
                        string t = TextOf(p);
                        if (first) { s.FirstText = t; first = false; }
                        else tail.Append(t).Append("|");
                    }

                s.TailHash = Hash(tail.ToString());
                return s;
            }

            private static void Count(ParagraphModel pPara, cSnapshot pOut)
            {
                foreach (InlineObjModel o in pPara.Objs)
                {
                    pOut.Objs++;
                    if (o.Kind == "image") pOut.Images++;
                    if (o.Kind == "table") pOut.Tables++;
                    if (o.Table == null) continue;

                    foreach (CellModel cell in o.Table.Cells)
                        foreach (ParagraphModel cp in cell.Paras)
                        {
                            pOut.Paras++;
                            Count(cp, pOut);
                        }
                }
            }

            private static string TextOf(ParagraphModel pPara)
            {
                StringBuilder b = new StringBuilder();
                foreach (RunModel r in pPara.Runs) if (r.Text != null) b.Append(r.Text);
                return b.ToString();
            }

            private static string Hash(string pText)
            {
                using (System.Security.Cryptography.SHA1 sha = System.Security.Cryptography.SHA1.Create())
                    return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(pText ?? "")))
                                       .Replace("-", "").Substring(0, 10);
            }

            public override string ToString()
            {
                return "para=" + Paras + " obj=" + Objs + " img=" + Images + " tbl=" + Tables
                     + " cs=" + CharShapes + " ps=" + ParaShapes + " bf=" + BorderFills + " h=" + TailHash;
            }
        }

        #endregion
    }
}
