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

        /// <summary>한글 FaceName 인덱스. 라틴은 따로 두지 않는다(1단계 범위).</summary>
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
    }

    public sealed class ParaShapeModel
    {
        [JsonProperty("id")] public int Id;

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
    }
}
