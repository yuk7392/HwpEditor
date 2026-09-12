using Newtonsoft.Json;

namespace HwpEditor.Models
{
    /// <summary>글꼴 하나. <see cref="Sub"/> 는 이 PC 에 없는 글꼴을 대신할 웹폰트 이름이다.</summary>
    public sealed class FaceNameModel
    {
        [JsonProperty("id")] public int Id;
        [JsonProperty("name")] public string Name;

        /// <summary>대체 글꼴(예: NanumMyeongjoHW). <see cref="cFontMap"/> 이 정한다.</summary>
        [JsonProperty("sub")] public string Sub;
    }

    public sealed class CharShapeModel
    {
        [JsonProperty("id")] public int Id;

        /// <summary>
        /// 화면이 서식을 바꿔 새로 만든 글자모양이면, 그것이 갈라져 나온 <b>원본 글자모양</b> 번호.
        /// 원본이면 -1 이다.
        ///
        /// ★ 이게 있어야 되쓰기가 원본을 복제한 뒤 바뀐 것만 덮어쓸 수 있다. 새로 만들어 채우면
        ///   우리가 모델에 안 담은 필드(그림자·외곽선·밑줄색·글자 테두리)가 통째로 기본값이 된다.
        /// </summary>
        [JsonProperty("base")] public int Base = -1;

        /// <summary>한글 FaceName 인덱스. 라틴은 따로 두지 않는다.</summary>
        [JsonProperty("face")] public int Face;

        /// <summary>기준 크기 HWPUNIT. pt = /100.</summary>
        [JsonProperty("sizeHu")] public int SizeHu;

        [JsonProperty("bold")] public bool Bold;
        [JsonProperty("italic")] public bool Italic;

        /// <summary>0=없음 1=아래 2=가운데 3=위</summary>
        [JsonProperty("underline")] public int Underline;

        [JsonProperty("strike")] public bool Strike;
        [JsonProperty("color")] public string Color;

        /// <summary>장평 %. 100 이 기본.</summary>
        [JsonProperty("ratio")] public int Ratio = 100;

        /// <summary>자간 %. 음수면 좁힌다.</summary>
        [JsonProperty("spacing")] public int Spacing;

        [JsonProperty("sup")] public bool Sup;
        [JsonProperty("sub")] public bool Sub;

        /// <summary>
        /// 형광펜(글자 배경색). null 이면 없음.
        ///
        /// ★ hwp 의 "없음" 은 <c>0xFFFFFFFF</c> 다(실측 2026-09-12) — 흰색이 아니다.
        ///   hwpx 는 <c>shadeColor="none"</c>. 흰색으로 읽으면 모든 글자에 흰 배경이 칠해진다.
        /// </summary>
        [JsonProperty("shade")] public string Shade;

        /// <summary>밑줄 모양·색(<see cref="BorderLineModel.Type"/> 과 같은 이름표).</summary>
        [JsonProperty("ulShape")] public string UlShape = "solid";
        [JsonProperty("ulColor")] public string UlColor = "#000000";

        /// <summary>강조점 0=없음 … 12. hwp <c>EmphasisSort</c> 번호 그대로.</summary>
        [JsonProperty("emph")] public int Emph;

        /// <summary>외곽선 0=없음 … 6(hwp <c>OutterLineSort</c>), 그림자 0=없음 1=비연속 2=연속.</summary>
        [JsonProperty("outline")] public int Outline;
        [JsonProperty("shadow")] public int Shadow;

        [JsonProperty("emboss")] public bool Emboss;
        [JsonProperty("engrave")] public bool Engrave;

        /// <summary>글자 테두리가 가리키는 <see cref="BorderFillModel"/> 번호. 0 이면 없음.</summary>
        [JsonProperty("bf")] public int Bf;
    }

    public sealed class ParaShapeModel
    {
        [JsonProperty("id")] public int Id;

        /// <summary>갈라져 나온 원본 문단모양 번호. 원본이면 -1(<see cref="CharShapeModel.Base"/> 와 같은 규칙).</summary>
        [JsonProperty("base")] public int Base = -1;

        /// <summary>"justify" | "left" | "right" | "center" | "distribute" | "divide"</summary>
        [JsonProperty("align")] public string Align = "justify";

        /// <summary>첫 줄 들여쓰기(음수면 내어쓰기) HWPUNIT.</summary>
        [JsonProperty("indentHu")] public int IndentHu;

        [JsonProperty("mlHu")] public int MlHu;
        [JsonProperty("mrHu")] public int MrHu;
        [JsonProperty("mtHu")] public int MtHu;
        [JsonProperty("mbHu")] public int MbHu;

        /// <summary>"percent"(글자 크기 대비 %) | "fixed"(고정값 HWPUNIT) | "margin" | "atLeast"</summary>
        [JsonProperty("lsType")] public string LsType = "percent";
        [JsonProperty("ls")] public int Ls = 160;

        /// <summary>영문 줄나눔: "word" | "hyphen" | "letter"</summary>
        [JsonProperty("latinBreak")] public string LatinBreak = "word";

        /// <summary>한글 줄나눔이 어절 단위인가(기본은 글자 단위).</summary>
        [JsonProperty("hangulByWord")] public bool HangulByWord;

        /// <summary>문단 테두리·음영이 가리키는 <see cref="BorderFillModel"/> 번호. 0 이면 없음.</summary>
        [JsonProperty("bf")] public int Bf;

        /// <summary>테두리와 글 사이 간격(HWPUNIT).</summary>
        [JsonProperty("bsL")] public int BsL;
        [JsonProperty("bsR")] public int BsR;
        [JsonProperty("bsT")] public int BsT;
        [JsonProperty("bsB")] public int BsB;
    }

    /// <summary>
    /// 테두리 한 변. <see cref="W"/> 는 덤프 5-4 의 mm 문자열("0.12")이고 hwp 의
    /// <c>BorderThickness</c> 16단·hwpx 의 <c>width="0.12 mm"</c> 와 이 문자열로 왕복한다.
    /// </summary>
    public sealed class BorderLineModel
    {
        /// <summary>"none" | "solid" | "dash" | … (hwp <c>BorderType</c> 18종을 소문자 이름으로).</summary>
        [JsonProperty("type")] public string Type = "none";
        [JsonProperty("w")] public string W = "0.12";
        [JsonProperty("color")] public string Color = "#000000";
    }

    /// <summary>
    /// 문서 머리의 테두리/배경 표 한 줄. 문단 모양·글자 모양·표·칸이 <see cref="Id"/> 를 가리킨다.
    ///
    /// ★ <b>번호는 hwp·hwpx 둘 다 1부터</b>다 — 목록의 0번 자리는 비워 둔다. 글자모양처럼 0-기반
    ///   위치로 두면 hwp 쪽 모든 자리에 ±1 이 따라다닌다.
    /// ★ 그러데이션·그림 채우기·3D/그림자 비트는 <b>모델에 안 담는다</b> — <see cref="Base"/> 복제로
    ///   살린다(<see cref="CharShapeModel.Base"/> 와 같은 규칙).
    /// </summary>
    public sealed class BorderFillModel
    {
        [JsonProperty("id")] public int Id;
        [JsonProperty("base")] public int Base = -1;

        [JsonProperty("l")] public BorderLineModel L = new BorderLineModel();
        [JsonProperty("r")] public BorderLineModel R = new BorderLineModel();
        [JsonProperty("t")] public BorderLineModel T = new BorderLineModel();
        [JsonProperty("b")] public BorderLineModel B = new BorderLineModel();
        [JsonProperty("d")] public BorderLineModel D = new BorderLineModel();

        /// <summary>
        /// 면 색. null 이면 채우기 없음.
        ///
        /// ★ hwp 는 "없음" 을 <c>0xFFFFFFFF</c> 로 둔다(실측 2026-09-12 — 표본 3개 전부). 흰색
        ///   <c>0x00FFFFFF</c> 이 아니다. hwpx 는 <c>faceColor="none"</c>.
        /// </summary>
        [JsonProperty("fill")] public string Fill;

        /// <summary>"none" | "horz" | "vert" | "backSlash" | "slash" | "cross" | "crossDiagonal"</summary>
        [JsonProperty("pat")] public string Pat = "none";
        [JsonProperty("patColor")] public string PatColor = "#000000";
    }
}
