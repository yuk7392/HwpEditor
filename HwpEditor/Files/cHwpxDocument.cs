using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Xml;
using HwpEditor.Models;

namespace HwpEditor.Files
{
    /// <summary>화면 id → 원본 XML 요소. hwp 쪽 <see cref="cHwpIndex"/> 와 같은 자리다.</summary>
    public sealed class cHwpxIndex
    {
        public readonly Dictionary<string, XmlElement> Paras = new Dictionary<string, XmlElement>();
        public readonly Dictionary<string, XmlElement> Objs = new Dictionary<string, XmlElement>();

        public void Clear()
        {
            Paras.Clear();
            Objs.Clear();
        }
    }

    /// <summary>
    /// ★ 저장은 원본 zip 을 통째로 옮겨 담으면서 <b>바뀐 항목만 갈아 끼운다</b>. 우리가 모르는 항목
    ///   (미리보기·설정·기록)까지 다시 만들려 들면, 우리가 이해 못 한 것부터 조용히 사라진다.
    /// ★ <c>mimetype</c> 은 <b>맨 앞에, 압축하지 않고</b> 넣는다 — OCF 묶음 규칙이고 이걸 어기면
    ///   여는 쪽이 묶음 종류를 판정하지 못한다.
    /// </summary>
    public sealed class cHwpxDocument
    {
        private const string cContentEntry = "Contents/content.hpf";
        private const string cHeaderEntry = "Contents/header.xml";
        private const string cMimeEntry = "mimetype";

        private string cSource;
        private readonly List<string> cSectionEntries = new List<string>();
        private readonly List<XmlDocument> cSectionDocs = new List<XmlDocument>();
        private readonly XmlDocument cHeader;
        private readonly XmlDocument cContent;

        private readonly Dictionary<string, byte[]> cAdded = new Dictionary<string, byte[]>();

        private readonly cHwpxIndex cIndex = new cHwpxIndex();
        private DocModel cModel;

        private cHwpxDocument(string pPath, XmlDocument pHeader, XmlDocument pContent)
        {
            cSource = pPath;
            Path = pPath;
            cHeader = pHeader;
            cContent = pContent;
        }

        public string Path { get; private set; }

        public DocModel Model
        {
            get
            {
                if (cModel == null)
                {
                    cModel = cHwpxReader.ReadOpened(cHeader, cSectionDocs, Path, cIndex);
                    ExtractImages();
                }
                return cModel;
            }
        }

        public cHwpxIndex Index
        {
            get
            {
                if (cModel == null) { DocModel unused = Model; }
                return cIndex;
            }
        }

        internal XmlDocument Content { get { return cContent; } }

        #region 열기

        public static cHwpxDocument Open(string pPath)
        {
            if (string.IsNullOrEmpty(pPath)) throw new ArgumentNullException("pPath");

            using (ZipArchive zip = ZipFile.OpenRead(pPath))
            {
                XmlDocument header = LoadXml(zip, cHeaderEntry);
                if (header == null) throw new InvalidDataException("hwpx 에 " + cHeaderEntry + " 가 없다");

                XmlDocument content = LoadXml(zip, cContentEntry);

                cHwpxDocument d = new cHwpxDocument(pPath, header, content);
                foreach (string name in cHwpxReader.SectionEntryNames(zip))
                {
                    XmlDocument sec = LoadXml(zip, name);
                    if (sec == null) continue;
                    d.cSectionEntries.Add(name);
                    d.cSectionDocs.Add(sec);
                }
                return d;
            }
        }

        private static XmlDocument LoadXml(ZipArchive pZip, string pEntry)
        {
            ZipArchiveEntry e = Entry(pZip, pEntry);
            if (e == null) return null;

            using (Stream s = e.Open())
            using (StreamReader r = new StreamReader(s, Encoding.UTF8))
            {
                XmlDocument d = new XmlDocument();
                d.XmlResolver = null;   // 외부 참조를 타지 않는다

                // ★ 이걸 켜지 않으면 <hp:t> </hp:t> 처럼 <b>공백뿐인 글자 마디가 통째로 사라진다</b>.
                //   XmlDocument 는 기본값에서 공백만 든 텍스트 노드를 버린다 — 읽기에서는 그 문단이
                //   빈 줄로 보이고, 저장에서는 원본에 있던 공백이 파일에서 없어진다(실측 —
                //   complaint-form.hwpx 를 그냥 다시 저장했더니 변환기가 세는 줄이 67 에서 64 로 줄었다).
                d.PreserveWhitespace = true;
                d.LoadXml(r.ReadToEnd());
                return d;
            }
        }

        private static ZipArchiveEntry Entry(ZipArchive pZip, string pName)
        {
            foreach (ZipArchiveEntry x in pZip.Entries)
                if (string.Equals(x.FullName, pName, StringComparison.OrdinalIgnoreCase)) return x;
            return null;
        }

        #endregion

        #region 그림

        /// <summary>
        /// <c>&lt;hc:img binaryItemIDRef="image1"/&gt;</c> → content.hpf 의 같은 id 항목 → zip 안의 실물.
        /// 화면이 볼 수 있는 형식만 푼다.
        /// </summary>
        private void ExtractImages()
        {
            string key = cImageStore.DocKey(Path);
            Dictionary<string, string> hrefById = ManifestHrefs();
            if (hrefById.Count == 0) return;

            using (ZipArchive zip = ZipFile.OpenRead(cSource))
            {
                Dictionary<string, string> done = new Dictionary<string, string>();
                foreach (SectionModel sec in cModel.Sections)
                    foreach (ParagraphModel p in sec.Paras)
                        ExtractIn(p, zip, hrefById, done, key);
            }
        }

        private void ExtractIn(ParagraphModel pPara, ZipArchive pZip, Dictionary<string, string> pHrefs,
                               Dictionary<string, string> pDone, string pKey)
        {
            foreach (InlineObjModel o in pPara.Objs)
            {
                if (o.Table != null)
                    foreach (CellModel cell in o.Table.Cells)
                        foreach (ParagraphModel cp in cell.Paras)
                            ExtractIn(cp, pZip, pHrefs, pDone, pKey);

                if (o.Kind != "image") continue;

                XmlElement el;
                if (!cIndex.Objs.TryGetValue(o.Oid, out el)) continue;

                string refId = FindImageRef(el);
                if (refId == null) continue;

                string src;
                if (pDone.TryGetValue(refId, out src)) { if (src != null) o.Src = src; continue; }

                src = null;
                string href;
                if (pHrefs.TryGetValue(refId, out href))
                {
                    ZipArchiveEntry e = Entry(pZip, href);
                    if (e != null)
                    {
                        byte[] data;
                        using (Stream s = e.Open())
                        using (MemoryStream ms = new MemoryStream())
                        {
                            s.CopyTo(ms);
                            data = ms.ToArray();
                        }
                        src = cImageStore.DumpBytes(data, System.IO.Path.GetExtension(href), refId, pKey);
                    }
                }

                pDone[refId] = src;
                if (src != null) o.Src = src;
            }
        }

        private static string FindImageRef(XmlElement pPic)
        {
            foreach (XmlNode n in pPic.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e == null) continue;
                if (e.LocalName == "img")
                {
                    XmlAttribute a = e.Attributes["binaryItemIDRef"];
                    if (a != null) return a.Value;
                }
                string deep = FindImageRef(e);
                if (deep != null) return deep;
            }
            return null;
        }

        private Dictionary<string, string> ManifestHrefs()
        {
            Dictionary<string, string> map = new Dictionary<string, string>();
            if (cContent == null) return map;

            foreach (XmlNode n in cContent.GetElementsByTagName("*"))
            {
                XmlElement e = n as XmlElement;
                if (e == null || e.LocalName != "item") continue;
                XmlAttribute id = e.Attributes["id"];
                XmlAttribute href = e.Attributes["href"];
                if (id != null && href != null) map[id.Value] = href.Value;
            }
            return map;
        }

        /// <summary>
        /// ★ 두 곳을 같이 고쳐야 한다 — zip 항목과 content.hpf 의 manifest. 하나만 하면 여는 쪽이 못 찾는다.
        /// </summary>
        internal string AddImage(byte[] pData, string pExtension)
        {
            string ext = (pExtension ?? "png").TrimStart('.').ToLowerInvariant();
            if (ext.Length == 0) ext = "png";

            Dictionary<string, string> have = ManifestHrefs();
            int n = 1;
            while (have.ContainsKey("image" + n.ToString(CultureInfo.InvariantCulture))) n++;

            string id = "image" + n.ToString(CultureInfo.InvariantCulture);
            string href = "BinData/" + id + "." + ext;

            XmlElement manifest = FirstByLocalName(cContent, "manifest");
            if (manifest == null) throw new InvalidDataException("content.hpf 에 manifest 가 없다");

            XmlElement item = cContent.CreateElement(manifest.Prefix, "item", manifest.NamespaceURI);
            item.SetAttribute("id", id);
            item.SetAttribute("href", href);
            item.SetAttribute("media-type", MediaType(ext));
            manifest.AppendChild(item);

            cAdded[href] = pData;
            return id;
        }

        private static string MediaType(string pExt)
        {
            switch (pExt)
            {
                case "png": return "image/png";
                case "gif": return "image/gif";
                case "bmp": return "image/bmp";
                default: return "image/jpeg";
            }
        }

        private static XmlElement FirstByLocalName(XmlNode pNode, string pLocal)
        {
            if (pNode == null) return null;
            foreach (XmlNode n in pNode.ChildNodes)
            {
                XmlElement e = n as XmlElement;
                if (e == null) continue;
                if (e.LocalName == pLocal) return e;
                XmlElement deep = FirstByLocalName(e, pLocal);
                if (deep != null) return deep;
            }
            return null;
        }

        #endregion

        #region 편집 · 저장

        public void Apply(SaveRequest pReq, SaveResult pResult)
        {
            if (pReq == null) return;
            cHwpxWriter.Apply(this, Index, pReq, pResult);

            if (pResult != null)
            {
                pResult.CharShapes = cHwpxReader.CharShapesOf(cHeader);
                pResult.ParaShapes = cHwpxReader.ParaShapesOf(cHeader);
                pResult.BorderFills = cHwpxReader.BorderFillsOf(cHeader);
                pResult.Numberings = cHwpxReader.NumberingsOf(cHeader);
                pResult.Bullets = cHwpxReader.BulletsOf(cHeader);
                pResult.Styles = cHwpxReader.StylesOf(cHeader);
            }
        }

        internal XmlDocument Header { get { return cHeader; } }

        /// <summary>구역 번호로 여는 길. <c>secFmt</c> 가 <c>secPr</c>·<c>colPr</c> 을 구역 번호로 찾는다.</summary>
        internal IList<XmlDocument> SectionDocs { get { return cSectionDocs; } }

        public void Save(string pPath)
        {
            if (string.IsNullOrEmpty(pPath)) throw new ArgumentNullException("pPath");

            // ★ 같은 경로로 저장할 수 있다 — 원본을 읽는 동안 덮어쓰면 안 되니 임시 파일에 쓰고 옮긴다.
            string tmp = pPath + ".hwpetmp";

            using (FileStream fs = new FileStream(tmp, FileMode.Create, FileAccess.Write))
            using (cZipWriter dst = new cZipWriter(fs))
            using (ZipArchive src = ZipFile.OpenRead(cSource))
            {
                // ★ mimetype 은 맨 앞에, 압축하지 않고. 원본도 그렇게 들어 있다(실측 method 0).
                ZipArchiveEntry mime = Entry(src, cMimeEntry);
                dst.Add(cMimeEntry,
                        mime != null ? ReadAll(mime) : Encoding.ASCII.GetBytes("application/hwp+zip"),
                        true);

                foreach (ZipArchiveEntry e in src.Entries)
                {
                    if (string.Equals(e.FullName, cMimeEntry, StringComparison.OrdinalIgnoreCase)) continue;
                    if (cAdded.ContainsKey(e.FullName)) continue;   // 새로 넣는 것이 이긴다

                    int secIdx = cSectionEntries.IndexOf(e.FullName);
                    if (secIdx >= 0) { dst.Add(e.FullName, XmlBytes(cSectionDocs[secIdx]), false); continue; }

                    if (string.Equals(e.FullName, cContentEntry, StringComparison.OrdinalIgnoreCase) && cContent != null)
                    { dst.Add(e.FullName, XmlBytes(cContent), false); continue; }

                    // ★ header.xml 도 우리가 고친 것을 써야 한다. 원본 바이트를 그대로 옮기면
                    //   새로 등록한 글자모양·문단모양이 통째로 사라지고, section*.xml 은 그 번호를
                    //   가리킨 채 나간다 — 참조가 매달린 파일이 된다.
                    if (string.Equals(e.FullName, cHeaderEntry, StringComparison.OrdinalIgnoreCase) && cHeader != null)
                    { dst.Add(e.FullName, XmlBytes(cHeader), false); continue; }

                    dst.Add(e.FullName, ReadAll(e), false);
                }

                foreach (KeyValuePair<string, byte[]> kv in cAdded) dst.Add(kv.Key, kv.Value, false);

                dst.Finish();
            }

            if (File.Exists(pPath)) File.Delete(pPath);
            File.Move(tmp, pPath);

            // 다음 저장은 방금 쓴 파일을 바탕으로 한다 — 새 항목은 이미 그 안에 들어갔다.
            cSource = pPath;
            Path = pPath;
            cAdded.Clear();
        }

        private static byte[] ReadAll(ZipArchiveEntry pEntry)
        {
            using (Stream s = pEntry.Open())
            using (MemoryStream ms = new MemoryStream())
            {
                s.CopyTo(ms);
                return ms.ToArray();
            }
        }

        private static byte[] XmlBytes(XmlDocument pDoc)
        {
            XmlWriterSettings ws = new XmlWriterSettings();
            ws.Encoding = new UTF8Encoding(false);   // BOM 없이 — 원본도 없다
            ws.Indent = false;
            ws.OmitXmlDeclaration = false;

            using (MemoryStream ms = new MemoryStream())
            {
                using (XmlWriter w = XmlWriter.Create(ms, ws)) pDoc.Save(w);
                return ms.ToArray();
            }
        }

        #endregion
    }
}
