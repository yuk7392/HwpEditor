using System.Globalization;
using Newtonsoft.Json;

namespace HwpEditor.Models
{
    /// <summary>
    /// 모델 ↔ JSON. 설정을 한곳에 모아 둔다 — 화면에 보내는 것과 <c>--model</c> 로 뽑아 보는 것이
    /// 다른 설정으로 나가면 눈으로 본 것이 화면이 받는 것과 달라진다.
    /// </summary>
    public static class cJson
    {
        /// <summary>
        /// ★ 반드시 InvariantCulture 다. 소수점을 쉼표로 쓰는 문화권에서 그냥 이어붙이면
        ///   문서 스크립트가 문법 오류로 죽는다(AMIS cWebTranscript.cs 실측).
        /// </summary>
        private static JsonSerializerSettings Settings(bool pIndent)
        {
            JsonSerializerSettings s = new JsonSerializerSettings();
            s.Culture = CultureInfo.InvariantCulture;
            s.Formatting = pIndent ? Formatting.Indented : Formatting.None;
            s.NullValueHandling = NullValueHandling.Include;
            return s;
        }

        public static string ToJson(object pValue, bool pIndent)
        {
            return JsonConvert.SerializeObject(pValue, Settings(pIndent));
        }
    }
}
