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
    /// 편집 왕복을 화면 없이 재는 통로(2·3단계 완료 판정 ③⑤).
    ///
    /// ★ 화면과 <b>같은 계약</b>으로 잰다 — 여기서 만드는 것은 화면이 저장할 때 보내는 것과 같은
    ///   <see cref="EditOp"/> 목록이다. 다른 길로 고쳐 놓고 통과했다고 하면 화면은 검사한 적이 없다.
    /// </summary>
    internal static class cEditTest
    {
        #region --edit-test

        /// <summary>
        /// 첫 문단의 글자만 "테스트123" 으로 바꿔 저장하고 다시 열어 대조한다.
        /// 개체(용지 정의 같은 것)는 자리를 그대로 두고 글자만 갈아 끼운다 — 화면에서 글자를
        /// 전부 지우고 새로 치는 것과 같은 요청이다.
        /// </summary>
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
            //   HwpLibSharp 의 스타일 밀림 보정(G-14)도 저장할 때마다 누적되면 안 된다.
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

        /// <summary>첫 문단 끝에 그림 하나를 붙여 저장하고, 다시 열어 그림이 하나 늘었는지 본다.</summary>
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

        #region --apply

        /// <summary>화면이 보내는 저장 요청(JSON)을 그대로 먹여 본다.</summary>
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

            // ★ 같은 요청을 한 번 더 먹인다 — <b>모양이 또 느는지</b>만 본다(G-10).
            //   같은 서식을 다시 걸 때마다 모양이 늘면 그 문서는 열 때마다 무거워진다.
            //   문단 수는 여기서 안 본다: 이건 화면이 두 번 저장한 것이 아니라 같은 요청을 그대로
            //   다시 먹인 것이라 insertAfter 가 또 도는 것이 맞다(화면은 저장한 뒤 그 요청을 안 낸다).
            string dst2 = Path.Combine(Path.GetDirectoryName(pArgs[2]) ?? ".",
                Path.GetFileNameWithoutExtension(pArgs[2]) + "-again" + Path.GetExtension(pArgs[2]));
            doc.Save(dst2, req);
            cSnapshot twice = cSnapshot.Of(cDocument.Open(dst2).Model);
            Console.WriteLine("  두 번 " + twice);

            bool grew = twice.CharShapes != after.CharShapes || twice.ParaShapes != after.ParaShapes;
            Console.WriteLine();
            Console.WriteLine(grew
                ? "두 번 먹였더니 모양이 늘었다 — 실패 (cs " + after.CharShapes + "→" + twice.CharShapes
                  + ", ps " + after.ParaShapes + "→" + twice.ParaShapes + ")"
                : "두 번 먹여도 모양 개수 그대로 — 통과");
            return (r.Ok && !grew) ? 0 : 3;
        }

        #endregion

        #region 대조

        /// <summary>
        /// 판정을 한 표로 낸다. ★ "저장이 됐다" 가 아니라 <b>무엇이 그대로이고 무엇만 바뀌었나</b>를 본다 —
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

        /// <summary>문서 하나의 구조 지표. 화면이 받는 모델에서 잰다 — 형식이 hwp 든 hwpx 든 같은 잣대다.</summary>
        private sealed class cSnapshot
        {
            internal int Paras, Objs, Images, Tables, CharShapes, ParaShapes;
            internal string FirstText, TailHash;

            internal static cSnapshot Of(DocModel pDoc)
            {
                cSnapshot s = new cSnapshot();
                s.CharShapes = pDoc.CharShapes.Count;
                s.ParaShapes = pDoc.ParaShapes.Count;

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
                     + " cs=" + CharShapes + " ps=" + ParaShapes + " h=" + TailHash;
            }
        }

        #endregion
    }
}
