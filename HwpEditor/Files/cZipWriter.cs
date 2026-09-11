using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace HwpEditor.Files
{
    /// <summary>
    /// ★ <see cref="ZipArchive"/> 를 안 쓰는 이유는 하나뿐이다 — .NET Framework 의 그것은
    ///   <c>CompressionLevel.NoCompression</c> 을 줘도 <b>압축 안 함(method 0)</b> 이 아니라
    ///   <b>수준 0 의 deflate(method 8)</b> 로 쓴다(실측 — 저장본의 첫 항목이 method 8 로 나왔다).
    ///   OCF 묶음은 <c>mimetype</c> 이 맨 앞에 <b>압축 없이</b> 들어 있어야 하고 원본 hwpx 도 그렇다.
    ///   여는 쪽이 그걸 보고 묶음 종류를 판정하므로 여기서 어긋나면 파일 자체를 못 알아본다.
    ///
    /// ★ 쓰기 전용이고 되감지 않는다 — 항목을 순서대로 흘려 쓰고 마지막에 목차를 붙인다.
    /// </summary>
    internal sealed class cZipWriter : IDisposable
    {
        private const uint cSigLocal = 0x04034b50;
        private const uint cSigCentral = 0x02014b50;
        private const uint cSigEnd = 0x06054b50;

        /// <summary>이름에 ASCII 밖 글자가 있을 때 켜는 "이름은 UTF-8" 표시.</summary>
        private const ushort cFlagUtf8 = 0x0800;

        private sealed class cEntry
        {
            public string Name;
            public ushort Method;
            public ushort Flags;
            public uint Crc;
            public uint CompSize;
            public uint RawSize;
            public uint Offset;
        }

        private readonly Stream cOut;
        private readonly List<cEntry> cList = new List<cEntry>();
        private readonly ushort cTime;
        private readonly ushort cDate;
        private long cPos;

        internal cZipWriter(Stream pOut)
        {
            cOut = pOut;

            DateTime now = DateTime.Now;
            cTime = (ushort)((now.Hour << 11) | (now.Minute << 5) | (now.Second / 2));
            cDate = (ushort)(((now.Year - 1980) << 9) | (now.Month << 5) | now.Day);
        }

        internal void Add(string pName, byte[] pData, bool pStore)
        {
            if (pData == null) pData = new byte[0];

            byte[] name = Encoding.UTF8.GetBytes(pName);
            byte[] body = pStore ? pData : Deflate(pData);

            // 압축했는데 오히려 커지면 그냥 넣는다 — 흔한 일은 아니지만 작은 xml 에서 실제로 생긴다.
            bool store = pStore || body.Length >= pData.Length;
            if (store) body = pData;

            cEntry e = new cEntry();
            e.Name = pName;
            e.Method = (ushort)(store ? 0 : 8);
            e.Flags = IsAscii(pName) ? (ushort)0 : cFlagUtf8;
            e.Crc = Crc32(pData);
            e.CompSize = (uint)body.Length;
            e.RawSize = (uint)pData.Length;
            e.Offset = (uint)cPos;

            Write32(cSigLocal);
            Write16(20);            // 풀려면 필요한 판
            Write16(e.Flags);
            Write16(e.Method);
            Write16(cTime);
            Write16(cDate);
            Write32(e.Crc);
            Write32(e.CompSize);
            Write32(e.RawSize);
            Write16((ushort)name.Length);
            Write16(0);             // 여분 필드 없음 — 원본 hwpx 의 mimetype 도 없다
            WriteBytes(name);
            WriteBytes(body);

            cList.Add(e);
        }

        /// <summary>목차(중앙 디렉터리)와 끝 표시를 붙인다. 이걸 안 부르면 zip 이 아니다.</summary>
        internal void Finish()
        {
            long start = cPos;

            foreach (cEntry e in cList)
            {
                byte[] name = Encoding.UTF8.GetBytes(e.Name);
                Write32(cSigCentral);
                Write16(20);        // 만든 판
                Write16(20);        // 풀려면 필요한 판
                Write16(e.Flags);
                Write16(e.Method);
                Write16(cTime);
                Write16(cDate);
                Write32(e.Crc);
                Write32(e.CompSize);
                Write32(e.RawSize);
                Write16((ushort)name.Length);
                Write16(0);         // 여분
                Write16(0);         // 설명
                Write16(0);         // 디스크 번호
                Write16(0);         // 내부 속성
                Write32(0);         // 외부 속성
                Write32(e.Offset);
                WriteBytes(name);
            }

            long size = cPos - start;

            Write32(cSigEnd);
            Write16(0);
            Write16(0);
            Write16((ushort)cList.Count);
            Write16((ushort)cList.Count);
            Write32((uint)size);
            Write32((uint)start);
            Write16(0);             // 묶음 설명 없음
        }

        public void Dispose()
        {
            cOut.Flush();
        }

        #region 바이트

        private static bool IsAscii(string pText)
        {
            for (int i = 0; i < pText.Length; i++) if (pText[i] > 127) return false;
            return true;
        }

        private static byte[] Deflate(byte[] pData)
        {
            using (MemoryStream ms = new MemoryStream())
            {
                // ★ zip 의 method 8 은 <b>날 deflate</b> 다 — zlib 머리·꼬리가 붙으면 안 된다.
                //   DeflateStream 이 정확히 그것을 낸다.
                using (DeflateStream z = new DeflateStream(ms, CompressionMode.Compress, true))
                    z.Write(pData, 0, pData.Length);
                return ms.ToArray();
            }
        }

        private void Write16(ushort pValue)
        {
            cOut.WriteByte((byte)(pValue & 0xFF));
            cOut.WriteByte((byte)((pValue >> 8) & 0xFF));
            cPos += 2;
        }

        private void Write32(uint pValue)
        {
            cOut.WriteByte((byte)(pValue & 0xFF));
            cOut.WriteByte((byte)((pValue >> 8) & 0xFF));
            cOut.WriteByte((byte)((pValue >> 16) & 0xFF));
            cOut.WriteByte((byte)((pValue >> 24) & 0xFF));
            cPos += 4;
        }

        private void WriteBytes(byte[] pBytes)
        {
            cOut.Write(pBytes, 0, pBytes.Length);
            cPos += pBytes.Length;
        }

        private static readonly uint[] cCrcTable = MakeCrcTable();

        private static uint[] MakeCrcTable()
        {
            uint[] t = new uint[256];
            for (uint i = 0; i < 256; i++)
            {
                uint c = i;
                for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
                t[i] = c;
            }
            return t;
        }

        private static uint Crc32(byte[] pData)
        {
            uint c = 0xFFFFFFFFu;
            for (int i = 0; i < pData.Length; i++) c = cCrcTable[(c ^ pData[i]) & 0xFF] ^ (c >> 8);
            return c ^ 0xFFFFFFFFu;
        }

        #endregion
    }
}
