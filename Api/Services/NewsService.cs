using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Api.Services;

public interface INewsService
{
    Task<List<NewsArticle>> GetTopHeadlinesAsync(string category);
}

public class NewsArticle
{
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string UrlToImage { get; set; } = string.Empty;
    public string SourceName { get; set; } = string.Empty;
    public DateTime PublishedAt { get; set; }
}

/// <summary>
/// Aggregates real Brazilian news from public RSS feeds (no API keys required).
/// Sources: Agencia Brasil (EBC), IGN Brasil, Tecnoblog, Canaltech, Olhar Digital, Meio Bit.
/// Includes a 10-minute in-memory cache with stale-on-error fallback.
/// </summary>
public class NewsService : INewsService
{
    private readonly HttpClient _httpClient;
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);

    private static readonly Dictionary<string, (string url, string source)[]> Feeds = new(StringComparer.OrdinalIgnoreCase)
    {
        ["sports"]     = new[] { ("https://agenciabrasil.ebc.com.br/rss/esportes/feed.xml", "Agência Brasil") },
        ["politics"]   = new[] { ("https://agenciabrasil.ebc.com.br/rss/politica/feed.xml", "Agência Brasil") },
        ["games"]      = new[] { ("https://br.ign.com/feed.xml", "IGN Brasil") },
        ["technology"] = new[] { ("https://tecnoblog.net/feed/", "Tecnoblog"), ("https://canaltech.com.br/rss/", "Canaltech") },
        ["innovation"] = new[] { ("https://olhardigital.com.br/feed/", "Olhar Digital"), ("https://meiobit.com/feed/", "Meio Bit") },
        ["general"]    = new[] { ("https://agenciabrasil.ebc.com.br/rss/geral/feed.xml", "Agência Brasil") }
    };

    // cache shared across requests (static = one copy per process)
    private static readonly Dictionary<string, (DateTime at, List<NewsArticle> items)> _cache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object _lock = new();

    public NewsService(HttpClient httpClient)
    {
        _httpClient = httpClient;
        _httpClient.Timeout = TimeSpan.FromSeconds(12);
    }

    public async Task<List<NewsArticle>> GetTopHeadlinesAsync(string category)
    {
        var key = Feeds.ContainsKey(category) ? category.ToLowerInvariant() : "general";

        lock (_lock)
        {
            if (_cache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.at < CacheTtl)
                return hit.items;
        }

        foreach (var (url, source) in Feeds[key])
        {
            try
            {
                var articles = await FetchFeedAsync(url, source);
                if (articles.Count > 0)
                {
                    lock (_lock) { _cache[key] = (DateTime.UtcNow, articles); }
                    return articles;
                }
            }
            catch
            {
                // feed failed - try the next fallback feed
            }
        }

        // stale-while-error: better to show old news than none
        lock (_lock)
        {
            if (_cache.TryGetValue(key, out var stale)) return stale.items;
        }
        return new List<NewsArticle>();
    }

    private async Task<List<NewsArticle>> FetchFeedAsync(string feedUrl, string source)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, feedUrl);
        req.Headers.UserAgent.ParseAdd("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 PortalCentral/1.0");
        req.Headers.Accept.ParseAdd("application/rss+xml, application/xml, text/xml, */*");

        using var resp = await _httpClient.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
        resp.EnsureSuccessStatusCode();
        await using var stream = await resp.Content.ReadAsStreamAsync();
        var doc = await XDocument.LoadAsync(stream, LoadOptions.None, CancellationToken.None);

        return doc.Descendants("item")
            .Take(12)
            .Select(el =>
            {
                var title = el.Element("title")?.Value?.Trim() ?? "";
                var link = el.Element("link")?.Value?.Trim() ?? "";
                var rawDesc = el.Element("description")?.Value ?? "";
                var publishedRaw = el.Element("pubDate")?.Value;
                DateTime.TryParse(publishedRaw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var published);

                return new NewsArticle
                {
                    Title = WebUtility.HtmlDecode(title),
                    Description = TrimText(StripHtml(WebUtility.HtmlDecode(rawDesc)), 240),
                    Url = link,
                    UrlToImage = ExtractImage(el, rawDesc),
                    SourceName = source,
                    PublishedAt = published == default ? DateTime.UtcNow : published
                };
            })
            .Where(a => !string.IsNullOrWhiteSpace(a.Title))
            .ToList();
    }

    private static string ExtractImage(XElement item, string rawDesc)
    {
        // 1) Agencia Brasil custom element
        var featured = item.Element("imagem-destaque")?.Value?.Trim();
        if (!string.IsNullOrEmpty(featured)) return featured;

        // 2) RSS enclosure
        var enclosure = item.Element("enclosure")?.Attribute("url")?.Value;
        if (!string.IsNullOrEmpty(enclosure)) return enclosure;

        // 3) media RSS (media:content / media:thumbnail)
        XNamespace media = "http://search.yahoo.com/mrss/";
        var mediaUrl = item.Element(media + "content")?.Attribute("url")?.Value
                    ?? item.Element(media + "thumbnail")?.Attribute("url")?.Value;
        if (!string.IsNullOrEmpty(mediaUrl)) return mediaUrl;

        // 4) first <img> inside the (decoded) description HTML
        var decoded = WebUtility.HtmlDecode(rawDesc);
        var m = Regex.Match(decoded, "<img[^>]+src=[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase);
        return m.Success ? m.Groups[1].Value : "";
    }

    private static string StripHtml(string html) =>
        Regex.Replace(html ?? "", "<[^>]+>", " ");

    private static string TrimText(string text, int max)
    {
        var t = Regex.Replace(text ?? "", @"\s+", " ").Trim();
        return t.Length <= max ? t : t[..Math.Min(max, t.Length)].TrimEnd() + "…";
    }
}
