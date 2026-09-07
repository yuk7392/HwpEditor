using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using HwpEditor.Models;
using HwpLib.Object;
using HwpLib.Object.BinData;
using HwpLib.Object.BodyText.Control.Gso;
using HwpLib.Object.DocInfo;
using HwpLib.Object.DocInfo.BinData;

namespace HwpEditor.Files
{
    /// <summary>
    /// 문서 안의 그림을 화면이 실제로 볼 수 있는 파일로 꺼내 놓고(3단계 ①), 새 그림을 문서에 등록한다(②).
    ///
    /// ★ 화면은 <c>https://hwpeditor.local/</c> 에 매핑된 <see cref="cWebHost.WebDir"/> 아래만 읽을 수 있다.
    ///   그래서 그 밑 <c>bin\{문서키}\</c> 에 풀고 상대 경로를 <c>src</c> 로 준다(계획 B-6).
    /// ★ 문서키는 경로 해시다 — 같은 문서를 다시 열면 같은 폴더를 다시 쓰고, 다른 문서끼리는 안 섞인다.
    /// </summary>
    public static class cImageStore
    {
        /// <summary>브라우저가 그대로 그릴 수 있는 것만 푼다. wmf·emf 는 회색 상자로 남는다.</summary>
        private static readonly string[] cWebFormats = { "png", "jpg", "jpeg", "gif", "bmp" };

        public static string DocKey(string pPath)
        {
            string s = (pPath ?? "새문서").ToLowerInvariant();
            using (SHA1 sha = SHA1.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(s))).Replace("-", "").Substring(0, 12);
        }

        public static string DirOf(string pDocKey)
        {
            return Path.Combine(cWebHost.WebDir, "bin", pDocKey);
        }

        #region 읽기 — BinData → 파일 → src

        /// <summary>
        /// 모델의 그림 개체마다 원본 BinData 를 풀어 <see cref="InlineObjModel.Src"/> 를 채운다.
        ///
        /// ★ 개체에서 BinData 로 가는 길은 두 단계다:
        ///   <c>ControlPicture.ShapeComponentPicture.PictureInfo.BinItemID</c>(1부터)
        ///   → <c>DocInfo.BinDataList[BinItemID-1].BinDataId</c>
        ///   → 이름 <c>BIN{id:X4}.{확장자}</c> 로 <c>BinData.EmbeddedBinaryDataList</c> 에서 찾는다.
        ///   실측(sample-5017-pics.hwp): BinDataList 2개(id 12·11), 포함 데이터 12개, 이름 BIN000C.jpg 꼴.
        /// ★ <c>EmbeddedBinaryData.Data</c> 는 <b>이미 압축이 풀린</b> 원본 바이트다(JPEG 매직 FF-D8 확인).
        /// </summary>
        public static void Extract(HWPFile pFile, DocModel pDoc, cHwpIndex pIndex, string pDocKey)
        {
            if (pFile == null || pDoc == null || pIndex == null) return;

            string dir = DirOf(pDocKey);
            Dictionary<int, string> done = new Dictionary<int, string>();

            foreach (SectionModel sec in pDoc.Sections)
                foreach (ParagraphModel p in sec.Paras)
                    ExtractInParagraph(pFile, p, pIndex, dir, pDocKey, done);
        }

        private static void ExtractInParagraph(HWPFile pFile, ParagraphModel pPara, cHwpIndex pIndex,
                                               string pDir, string pDocKey, Dictionary<int, string> pDone)
        {
            foreach (InlineObjModel o in pPara.Objs)
            {
                if (o.Table != null)
                    foreach (CellModel cell in o.Table.Cells)
                        foreach (ParagraphModel cp in cell.Paras)
                            ExtractInParagraph(pFile, cp, pIndex, pDir, pDocKey, pDone);

                if (o.Kind != "image") continue;

                cObjRef r;
                if (!pIndex.Objs.TryGetValue(o.Oid, out r)) continue;

                ControlPicture pic = r.Control as ControlPicture;
                if (pic == null || pic.ShapeComponentPicture == null || pic.ShapeComponentPicture.PictureInfo == null) continue;

                int binItemId = pic.ShapeComponentPicture.PictureInfo.BinItemID;
                string rel;
                if (pDone.TryGetValue(binItemId, out rel)) { o.Src = rel; continue; }

                rel = Dump(pFile, binItemId, pDir, pDocKey);
                pDone[binItemId] = rel;
                if (rel != null) o.Src = rel;
            }
        }

        /// <summary>BinItemID 하나를 파일로 푼다. 못 풀면 null(화면은 회색 상자로 남는다).</summary>
        private static string Dump(HWPFile pFile, int pBinItemId, string pDir, string pDocKey)
        {
            try
            {
                IReadOnlyList<BinDataInfo> infos = pFile.DocInfo.BinDataList;
                if (pBinItemId < 1 || pBinItemId > infos.Count) return null;

                BinDataInfo info = infos[pBinItemId - 1];
                string ext = (info.ExtensionForEmbedding ?? "").ToLowerInvariant();
                if (Array.IndexOf(cWebFormats, ext) < 0) return null;

                string name = "BIN" + info.BinDataId.ToString("X4", CultureInfo.InvariantCulture) + "." + ext;

                byte[] data = null;
                foreach (EmbeddedBinaryData e in pFile.BinData.EmbeddedBinaryDataList)
                    if (string.Equals(e.Name, name, StringComparison.OrdinalIgnoreCase)) { data = e.Data; break; }
                if (data == null || data.Length == 0) return null;

                Directory.CreateDirectory(pDir);
                string file = Path.Combine(pDir, pBinItemId.ToString(CultureInfo.InvariantCulture) + "." + ext);

                // 같은 크기면 다시 안 쓴다 — 문서를 열 때마다 파일 시각이 바뀌면 브라우저 캐시가 헛돈다.
                if (!File.Exists(file) || new FileInfo(file).Length != data.Length)
                    File.WriteAllBytes(file, data);

                return "bin/" + pDocKey + "/" + Path.GetFileName(file);
            }
            catch (Exception ex)
            {
                cLog.Write("그림 풀기 실패 binItemId=" + pBinItemId);
                cLog.Write(ex);
                return null;
            }
        }

        /// <summary>hwpx 는 zip 안의 바이트를 그대로 받아 같은 폴더 규칙으로 푼다.</summary>
        public static string DumpBytes(byte[] pData, string pExtension, string pName, string pDocKey)
        {
            try
            {
                string ext = (pExtension ?? "").TrimStart('.').ToLowerInvariant();
                if (Array.IndexOf(cWebFormats, ext) < 0) return null;
                if (pData == null || pData.Length == 0) return null;

                string dir = DirOf(pDocKey);
                Directory.CreateDirectory(dir);
                string file = Path.Combine(dir, pName + "." + ext);

                if (!File.Exists(file) || new FileInfo(file).Length != pData.Length)
                    File.WriteAllBytes(file, pData);

                return "bin/" + pDocKey + "/" + Path.GetFileName(file);
            }
            catch (Exception ex)
            {
                cLog.Write("hwpx 그림 풀기 실패 " + pName);
                cLog.Write(ex);
                return null;
            }
        }

        /// <summary>
        /// 넣으려는 그림을 화면이 <b>저장 전에도</b> 볼 수 있게 웹 폴더로 복사하고, 넣을 크기를 정한다.
        ///
        /// ★ 저장할 때까지 안 보여 주면 사용자는 자기가 어디에 무엇을 넣었는지 모른 채 계속 편집한다.
        /// ★ 크기는 원본 픽셀을 HWPUNIT 으로 옮긴 값이되 본문 폭을 넘지 않게 줄인다 —
        ///   요즘 사진은 3000픽셀이 예사라 그대로 넣으면 한 장이 열 쪽을 차지한다.
        /// </summary>
        public static string Preview(string pFilePath, string pDocKey, long pMaxWidthHu,
                                     out long pWidthHu, out long pHeightHu)
        {
            byte[] data = File.ReadAllBytes(pFilePath);

            int pw, ph;
            PixelSize(data, out pw, out ph);

            // 화면 픽셀 → HWPUNIT 은 96dpi 기준 75배다(계획 5절 단위).
            pWidthHu = pw > 0 ? pw * 75L : 20000;
            pHeightHu = ph > 0 ? ph * 75L : 15000;

            if (pMaxWidthHu > 0 && pWidthHu > pMaxWidthHu)
            {
                pHeightHu = pHeightHu * pMaxWidthHu / pWidthHu;
                pWidthHu = pMaxWidthHu;
            }

            string ext = (Path.GetExtension(pFilePath) ?? ".png").TrimStart('.').ToLowerInvariant();
            string name = "new" + Guid.NewGuid().ToString("N").Substring(0, 8);
            return DumpBytes(data, ext, name, pDocKey);
        }

        #endregion

        #region 쓰기 — 새 그림 등록

        /// <summary>
        /// 그림 파일 하나를 문서에 넣고 <c>BinItemID</c>(1부터)를 준다.
        ///
        /// ★ 두 곳에 같이 넣어야 한다 — <c>DocInfo.BinDataList</c>(어떤 그림인지)와
        ///   <c>BinData.EmbeddedBinaryDataList</c>(실물 바이트). 한쪽만 넣으면 저장은 성공하는데
        ///   여는 쪽에서 그림이 빈 상자로 뜬다.
        /// ★ <c>BinDataId</c> 는 이미 쓰는 것 중 가장 큰 값 +1 이다 — 이름이 BIN{id:X4} 라 겹치면 덮어쓴다.
        /// </summary>
        public static int Register(HWPFile pFile, string pFilePath, byte[] pData)
        {
            string ext = (Path.GetExtension(pFilePath) ?? "").TrimStart('.').ToLowerInvariant();
            if (ext.Length == 0) ext = "png";
            if (ext == "jpeg") ext = "jpg";

            int maxId = 0;
            foreach (BinDataInfo b in pFile.DocInfo.BinDataList)
                if (b.BinDataId > maxId) maxId = b.BinDataId;

            int newId = maxId + 1;

            BinDataInfo info = pFile.DocInfo.AddNewBinData();
            info.Property.Type = BinDataType.Embedding;
            info.Property.Compress = BinDataCompress.ByStorageDefault;
            info.Property.State = BinDataState.NotAccess;
            info.BinDataId = newId;
            info.ExtensionForEmbedding = ext;

            string name = "BIN" + newId.ToString("X4", CultureInfo.InvariantCulture) + "." + ext;
            pFile.BinData.AddNewEmbeddedBinaryData(name, pData, BinDataCompress.ByStorageDefault);

            return pFile.DocInfo.BinDataList.Count;
        }

        /// <summary>
        /// 그림의 원래 픽셀 크기(못 읽으면 0,0). ★ 헤더만 읽는다 — <c>Image.FromFile</c> 은 파일을 잠그고
        /// GDI 핸들을 문 채로 있는다.
        /// </summary>
        public static void PixelSize(byte[] pData, out int pWidth, out int pHeight)
        {
            pWidth = 0; pHeight = 0;
            if (pData == null || pData.Length < 26) return;

            // PNG: 89 50 4E 47 … IHDR 의 8바이트가 폭·높이(big endian)
            if (pData[0] == 0x89 && pData[1] == 0x50 && pData[2] == 0x4E && pData[3] == 0x47)
            {
                pWidth = Be32(pData, 16);
                pHeight = Be32(pData, 20);
                return;
            }

            // GIF: 6바이트 서명 뒤 폭·높이(little endian)
            if (pData[0] == 0x47 && pData[1] == 0x49 && pData[2] == 0x46)
            {
                pWidth = pData[6] | (pData[7] << 8);
                pHeight = pData[8] | (pData[9] << 8);
                return;
            }

            // BMP: BITMAPINFOHEADER 의 폭·높이(little endian, 높이는 음수일 수 있다)
            if (pData[0] == 0x42 && pData[1] == 0x4D)
            {
                pWidth = Le32(pData, 18);
                pHeight = Math.Abs(Le32(pData, 22));
                return;
            }

            // JPEG: SOF0~SOF15 세그먼트를 찾아 높이·폭(big endian)
            if (pData[0] == 0xFF && pData[1] == 0xD8) ReadJpegSize(pData, out pWidth, out pHeight);
        }

        private static void ReadJpegSize(byte[] pData, out int pWidth, out int pHeight)
        {
            pWidth = 0; pHeight = 0;
            int i = 2;
            while (i + 9 < pData.Length)
            {
                if (pData[i] != 0xFF) { i++; continue; }

                int marker = pData[i + 1];
                if (marker == 0xD8 || marker == 0x01 || marker == 0xFF || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }

                int len = (pData[i + 2] << 8) | pData[i + 3];

                // SOF0~SOF15 중 DHT(C4)·JPG(C8)·DAC(CC) 는 크기 세그먼트가 아니다.
                bool isSof = marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
                if (isSof)
                {
                    pHeight = (pData[i + 5] << 8) | pData[i + 6];
                    pWidth = (pData[i + 7] << 8) | pData[i + 8];
                    return;
                }

                if (len <= 0) return;
                i += 2 + len;
            }
        }

        private static int Be32(byte[] pData, int pAt)
        {
            return (pData[pAt] << 24) | (pData[pAt + 1] << 16) | (pData[pAt + 2] << 8) | pData[pAt + 3];
        }

        private static int Le32(byte[] pData, int pAt)
        {
            return pData[pAt] | (pData[pAt + 1] << 8) | (pData[pAt + 2] << 16) | (pData[pAt + 3] << 24);
        }

        #endregion
    }
}
