using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Api.Services;

public interface IWeatherService
{
    Task<WeatherDetails> GetCurrentWeatherAsync(string city);
    Task<List<CitySuggestion>> SuggestCitiesAsync(string query);
}

public record CitySuggestion(string Name, string? Admin1, string? Country, string? CountryCode);

public class WeatherDetails
{
    public string City { get; set; } = string.Empty;
    public string Temp { get; set; } = string.Empty;
    public string Condition { get; set; } = string.Empty;
    public string Icon { get; set; } = string.Empty;
    public string MinTemp { get; set; } = string.Empty;
    public string MaxTemp { get; set; } = string.Empty;
}

/// <summary>
/// Free real-time weather via Open-Meteo (no API key required).
/// Geocoding: https://geocoding-api.open-meteo.com  Forecast: https://api.open-meteo.com
/// </summary>
public class WeatherService : IWeatherService
{
    private readonly HttpClient _httpClient;
    private static readonly Dictionary<string, (double lat, double lon, string name)> _geoCache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object _lock = new();

    // fallback when geocoding fails
    private const double DefaultLat = -23.5505, DefaultLon = -46.6333;
    private const string DefaultCity = "São Paulo";

    public WeatherService(HttpClient httpClient)
    {
        _httpClient = httpClient;
        _httpClient.Timeout = TimeSpan.FromSeconds(10);
    }

    public async Task<WeatherDetails> GetCurrentWeatherAsync(string city = "São Paulo")
    {
        var (lat, lon, name) = await ResolveGeoAsync(city);
        var inv = CultureInfo.InvariantCulture;

        var url = "https://api.open-meteo.com/v1/forecast"
                + $"?latitude={lat.ToString(inv)}&longitude={lon.ToString(inv)}"
                + "&current=temperature_2m,weather_code"
                + "&daily=temperature_2m_max,temperature_2m_min"
                + "&forecast_days=1&timezone=auto";

        var data = await _httpClient.GetFromJsonAsync<OpenMeteoResponse>(url);
        var cur = data?.Current;

        if (cur == null)
            return new WeatherDetails { City = name, Temp = "--°", Condition = "Indisponível", Icon = "Unknown", MinTemp = "--°", MaxTemp = "--°" };

        var (condition, icon) = MapWeatherCode(cur.WeatherCode);
        var max = data?.Daily?.TempMax is { Length: > 0 } ? $"{Math.Round(data.Daily.TempMax[0])}°" : "--°";
        var min = data?.Daily?.TempMin is { Length: > 0 } ? $"{Math.Round(data.Daily.TempMin[0])}°" : "--°";

        return new WeatherDetails
        {
            City = name,
            Temp = $"{Math.Round(cur.Temperature)}°",
            Condition = condition,
            Icon = icon,
            MaxTemp = max,
            MinTemp = min
        };
    }

    private static async Task<(double lat, double lon, string name)> ResolveGeoAsync(string city)
    {
        if (string.IsNullOrWhiteSpace(city)) city = DefaultCity;

        lock (_lock)
        {
            if (_geoCache.TryGetValue(city, out var hit)) return hit;
        }

        try
        {
            var geo = await Task.Run(async () =>
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
                var u = $"https://geocoding-api.open-meteo.com/v1/search?name={Uri.EscapeDataString(city)}&count=1&language=pt&format=json";
                var r = await http.GetFromJsonAsync<GeoResponse>(u);
                var first = r?.Results?.FirstOrDefault();
                return first == null ? ((double lat, double lon, string name)?)null : ((double)first.Latitude, first.Longitude, first.Name ?? city);
            });

            if (geo.HasValue)
            {
                lock (_lock) { _geoCache[city] = geo.Value; }
                return geo.Value;
            }
        }
        catch { /* fall through to default */ }

        return (DefaultLat, DefaultLon, DefaultCity);
    }

    // Autocomplete de cidades para o painel admin (mesma API de geocoding do clima)
    public async Task<List<CitySuggestion>> SuggestCitiesAsync(string query)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Trim().Length < 2)
            return new List<CitySuggestion>();
        try
        {
            var u = $"https://geocoding-api.open-meteo.com/v1/search?name={Uri.EscapeDataString(query.Trim())}&count=8&language=pt&format=json";
            var r = await _httpClient.GetFromJsonAsync<GeoSearchResponse>(u);
            return r?.Results?.Select(g => new CitySuggestion(g.Name ?? "", g.Admin1, g.Country, g.CountryCode)).ToList() ?? new List<CitySuggestion>();
        }
        catch
        {
            return new List<CitySuggestion>();
        }
    }

    private static (string condition, string icon) MapWeatherCode(int code) => code switch
    {
        0 => ("Céu limpo", "Clear"),
        1 or 2 => ("Parcialmente nublado", "PartlyCloudy"),
        3 => ("Nublado", "Clouds"),
        45 or 48 => ("Nevoeiro", "Fog"),
        >= 51 and <= 57 => ("Garoa", "Drizzle"),
        >= 61 and <= 67 => ("Chuva", "Rain"),
        >= 71 and <= 77 => ("Neve", "Snow"),
        80 or 81 or 82 => ("Pancadas de chuva", "Showers"),
        85 or 86 => ("Pancadas de neve", "Snow"),
        >= 95 => ("Tempestade", "Storm"),
        _ => ("Tempo instável", "PartlyCloudy")
    };

    // ---- Open-Meteo response contract ----
    private class OpenMeteoResponse
    {
        [JsonPropertyName("current")] public CurrentData? Current { get; set; }
        [JsonPropertyName("daily")] public DailyData? Daily { get; set; }
    }

    private class CurrentData
    {
        [JsonPropertyName("temperature_2m")] public double Temperature { get; set; }
        [JsonPropertyName("weather_code")] public int WeatherCode { get; set; }
    }

    private class DailyData
    {
        [JsonPropertyName("temperature_2m_max")] public double[]? TempMax { get; set; }
        [JsonPropertyName("temperature_2m_min")] public double[]? TempMin { get; set; }
    }

    private class GeoResponse
    {
        [JsonPropertyName("results")] public List<GeoResult>? Results { get; set; }
    }

    private class GeoSearchResponse
    {
        [JsonPropertyName("results")] public List<GeoFull>? Results { get; set; }
    }

    private class GeoFull
    {
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("admin1")] public string? Admin1 { get; set; }
        [JsonPropertyName("country")] public string? Country { get; set; }
        [JsonPropertyName("country_code")] public string? CountryCode { get; set; }
    }

    private class GeoResult
    {
        [JsonPropertyName("latitude")] public double Latitude { get; set; }
        [JsonPropertyName("longitude")] public double Longitude { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
    }
}
