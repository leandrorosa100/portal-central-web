using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Npgsql;
using System.Text;
using System.Threading.RateLimiting;
using Scalar.AspNetCore;
using Api.Data;
using Api.Models;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;

var builder = WebApplication.CreateBuilder(args);

// Register API Services
builder.Services.AddHttpClient<Api.Services.INewsService, Api.Services.NewsService>();
builder.Services.AddHttpClient<Api.Services.IWeatherService, Api.Services.WeatherService>();

// --- Password hashing (PBKDF2-SHA256, per-user salt, constant-time compare) ---
static string HashPassword(string password)
{
    var salt = RandomNumberGenerator.GetBytes(16);
    const int iterations = 100_000;
    var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, 32);
    return $"PBKDF2${iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
}

static bool VerifyPassword(string password, string stored)
{
    if (!stored.StartsWith("PBKDF2$", StringComparison.Ordinal)) return false;
    var parts = stored.Split('$');
    if (parts.Length != 4 || !int.TryParse(parts[1], out var iterations)) return false;
    byte[] salt, expected;
    try { salt = Convert.FromBase64String(parts[2]); expected = Convert.FromBase64String(parts[3]); }
    catch (FormatException) { return false; }
    var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
    return CryptographicOperations.FixedTimeEquals(actual, expected);
}

// --- Configuration: secrets come ONLY from environment variables, never from code ---
var isProd = builder.Environment.IsProduction();
string? jwtKey = Environment.GetEnvironmentVariable("JWT_KEY");
if (string.IsNullOrWhiteSpace(jwtKey))
{
    if (isProd)
    {
        // Fail-safe: never sign tokens with a known/dev key. Ephemeral key = tokens
        // invalidate on restart until JWT_KEY is properly configured.
        jwtKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
    }
    else
    {
        jwtKey = "dev-only-insecure-jwt-key-change-me-9f8e7d6c5b4a";
    }
}
var jwtIssuer = "PortalCentral";
var jwtAudience = "PortalCentralUsers";

// --- Database: PostgreSQL (Supabase) em producao, SQLite local em dev ---
var databaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL");
if (!string.IsNullOrWhiteSpace(databaseUrl))
{
    databaseUrl = databaseUrl.Trim();
    // Render "Secret Files" entregam um caminho de arquivo em vez do valor
    if (File.Exists(databaseUrl))
        databaseUrl = File.ReadAllText(databaseUrl).Trim();
}
string npgsqlConnectionString = string.Empty;
string? dbPasswordForRedaction = null;
if (!string.IsNullOrWhiteSpace(databaseUrl))
{
    if (databaseUrl.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) ||
        databaseUrl.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
    {
        // NpgsqlConnectionStringBuilder nao aceita URI nesse caminho: converter para
        // formato chave=valor manualmente (torna tolerante a espacos/percent-encoding)
        var uri = new Uri(databaseUrl);
        var userInfo = uri.UserInfo.Split(':');
        var cs = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort ? 5432 : uri.Port,
            Username = Uri.UnescapeDataString(userInfo[0]),
            Database = uri.AbsolutePath.Trim('/'),
            SslMode = SslMode.Require
        };
        if (userInfo.Length > 1)
            cs.Password = Uri.UnescapeDataString(string.Join(":", userInfo.Skip(1)));
        npgsqlConnectionString = cs.ConnectionString;
        dbPasswordForRedaction = cs.Password;
    }
    else
    {
        npgsqlConnectionString = databaseUrl; // ja esta em formato chave=valor
    }
}
builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (!string.IsNullOrWhiteSpace(npgsqlConnectionString))
        options.UseNpgsql(npgsqlConnectionString);
    else
        options.UseSqlite("Data Source=portal_central.db");
});

// --- Security: JWT ---
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", p => p.RequireRole("Admin"));
});

// --- Security: rate limiting on login (brute-force protection) ---
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));
});

// --- Security: honor Render's reverse proxy headers (real client IP + https scheme) ---
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    // Render's LB uses private addresses; the container port is not directly internet-exposed.
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

builder.Services.AddControllers();
builder.Services.AddHttpClient();
builder.Services.AddOpenApi();

// CORS: only the Vite dev server needs it; in production the SPA is same-origin.
builder.Services.AddCors(options =>
{
    options.AddPolicy("DevOnly", policy => policy
        .WithOrigins("http://localhost:3000", "http://127.0.0.1:3000")
        .AllowAnyMethod().AllowAnyHeader());
});

var app = builder.Build();

if (isProd && string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("JWT_KEY")))
    app.Logger.LogWarning("JWT_KEY not set: an EPHEMERAL signing key was generated. Sessions invalidate on every restart. Set JWT_KEY in Render -> Environment.");

// --- Database Initializer (Seed Admin) ---
var seedUsername = Environment.GetEnvironmentVariable("ADMIN_USERNAME") ?? "admin";
string? generatedAdminPassword = null;
var seedPassword = Environment.GetEnvironmentVariable("ADMIN_PASSWORD");
if (string.IsNullOrWhiteSpace(seedPassword))
{
    if (isProd)
    {
        // Fail-safe: never seed a publicly-known default password in production.
        generatedAdminPassword = Convert.ToBase64String(RandomNumberGenerator.GetBytes(9));
        seedPassword = generatedAdminPassword;
    }
    else
    {
        seedPassword = "Admin@123";
    }
}
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    for (var attempt = 1; attempt <= 3; attempt++)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(npgsqlConnectionString))
            {
                // Postgres/Supabase: o database ja existe de fabrica, entao EnsureCreated
                // no-oparia SEM criar as tabelas. Criacao explicita e idempotente:
                await db.Database.ExecuteSqlRawAsync("""
                    CREATE TABLE IF NOT EXISTS "Users" (
                        "Id" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        "Username" TEXT NOT NULL,
                        "PasswordHash" TEXT NOT NULL,
                        "Role" TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS "Cities" (
                        "Id" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        "Name" TEXT NOT NULL,
                        "IsPrimary" BOOLEAN NOT NULL DEFAULT FALSE
                    );
                    CREATE UNIQUE INDEX IF NOT EXISTS "IX_Cities_Name" ON "Cities" ("Name");
                    CREATE TABLE IF NOT EXISTS "PinnedNews" (
                        "Id" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        "Title" TEXT NOT NULL,
                        "Url" TEXT NOT NULL,
                        "UrlToImage" TEXT NULL,
                        "Description" TEXT NULL,
                        "SourceName" TEXT NULL,
                        "PinnedAt" TIMESTAMPTZ NOT NULL
                    );
                    CREATE UNIQUE INDEX IF NOT EXISTS "IX_PinnedNews_Url" ON "PinnedNews" ("Url");
                    CREATE TABLE IF NOT EXISTS "Articles" (
                        "Id" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                        "Title" TEXT NOT NULL,
                        "Body" TEXT NOT NULL,
                        "Category" TEXT NOT NULL,
                        "Author" TEXT NOT NULL,
                        "CreatedAt" TIMESTAMPTZ NOT NULL
                    );
                    """);
            }
            else
            {
                db.Database.EnsureCreated(); // dev: SQLite nasce vazio, cria tudo
            }
            if (!db.Cities.Any())
            {
                db.Cities.Add(new City { Name = "São Paulo", IsPrimary = true });
            }
            if (!db.Users.Any(u => u.Username == seedUsername))
            {
                db.Users.Add(new User { Username = seedUsername, PasswordHash = HashPassword(seedPassword), Role = "Admin" });
            }
            await db.SaveChangesAsync();
            app.Logger.LogInformation("Banco pronto na tentativa {N}: schema verificado e seeds garantidos", attempt);
            break;
        }
        catch (Exception ex)
        {
            app.Logger.LogError(ex, "Banco indisponivel no boot (tentativa {N}/3): {Msg}", attempt, RedactDb(ex.Message, dbPasswordForRedaction));
            if (attempt < 3) await Task.Delay(TimeSpan.FromSeconds(10));
        }
    }
}
if (generatedAdminPassword is not null)
    app.Logger.LogWarning("ADMIN_PASSWORD not set: admin '{User}' was created with one-time password '{Pwd}' (visible only here, in your private service logs). Set ADMIN_PASSWORD in Render -> Environment to choose your own.", seedUsername, generatedAdminPassword);

// --- Middleware pipeline ---
app.UseForwardedHeaders();
app.UseRateLimiter();

// Security headers (defense in depth)
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    // Scalar's UI needs an inline bootstrap script + its doc served from a relative path.
    // Keep the strict policy for the app; relax script-src only for the docs pages.
    var isScalarPage = context.Request.Path.StartsWithSegments("/scalar");
    context.Response.Headers["Content-Security-Policy"] = isScalarPage
        ? "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'"
        : "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'";
    await next();
});

// Scalar resolves its OpenAPI document relative to /scalar/ — serve it from there too
app.MapGet("/scalar/openapi/v1.json", () => Results.Redirect("/openapi/v1.json", permanent: false));

// API documentation (OpenAPI + Scalar UI) available in all environments
app.MapOpenApi();
app.MapScalarApiReference();

if (app.Environment.IsDevelopment())
{
    app.UseCors("DevOnly");
}

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

// --- Auth endpoints ---
app.MapPost("/api/auth/login", async (LoginRequest request, AppDbContext db) =>
{
    var user = await db.Users.FirstOrDefaultAsync(u => u.Username == request.Username);
    if (user is null) return Results.Unauthorized();

    var ok = user.PasswordHash.StartsWith("PBKDF2$", StringComparison.Ordinal)
        ? VerifyPassword(request.Password, user.PasswordHash)
        : string.Equals(user.PasswordHash, request.Password, StringComparison.Ordinal); // legacy dev plaintext
    if (!ok) return Results.Unauthorized();

    // Transparently upgrade legacy plaintext entries to PBKDF2
    if (!user.PasswordHash.StartsWith("PBKDF2$", StringComparison.Ordinal))
    {
        user.PasswordHash = HashPassword(request.Password);
        await db.SaveChangesAsync();
    }

    var tokenHandler = new JwtSecurityTokenHandler();
    var tokenDescriptor = new SecurityTokenDescriptor
    {
        Subject = new ClaimsIdentity(new[] { new Claim(ClaimTypes.Name, user.Username), new Claim(ClaimTypes.Role, user.Role) }),
        Expires = DateTime.UtcNow.AddDays(7),
        Issuer = jwtIssuer,
        Audience = jwtAudience,
        SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)), SecurityAlgorithms.HmacSha256Signature)
    };
    var token = tokenHandler.CreateToken(tokenDescriptor);
    return Results.Ok(new { token = tokenHandler.WriteToken(token), username = user.Username });
}).RequireRateLimiting("login");

app.MapGet("/api/auth/me", (ClaimsPrincipal user) =>
    Results.Ok(new { username = user.Identity?.Name, role = user.FindFirst(ClaimTypes.Role)?.Value }))
    .RequireAuthorization();

// Diagnostico do banco (demo): expoe so estrutura e codigo do erro, nunca credenciais
static string RedactDb(string msg, string? pw)
{
    if (!string.IsNullOrEmpty(pw) && msg.Contains(pw, StringComparison.Ordinal))
        msg = msg.Replace(pw, "***");
    return msg.Length > 400 ? msg[..400] : msg;
}

app.MapGet("/api/db/health", async (AppDbContext db) =>
{
    var hasUrl = !string.IsNullOrWhiteSpace(databaseUrl);
    var r = new Dictionary<string, object?>
    {
        ["mode"] = hasUrl ? "postgresql" : "sqlite",
        ["format_uri"] = hasUrl && databaseUrl!.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase),
        ["host_is_pooler"] = hasUrl && databaseUrl!.Contains("pooler.supabase.com", StringComparison.OrdinalIgnoreCase),
        ["host_is_direct"] = hasUrl && databaseUrl!.Contains(".supabase.co", StringComparison.OrdinalIgnoreCase),
        ["username_has_tenant"] = hasUrl && databaseUrl!.Contains("postgres.", StringComparison.Ordinal),
    };
    try
    {
        await db.Database.OpenConnectionAsync();
        r["can_connect"] = true;
        try { r["users_table"] = await db.Users.AnyAsync(); }
        catch (Exception ex2) { r["users_table_error"] = RedactDb(ex2.Message, dbPasswordForRedaction); }
        db.Database.CloseConnection();
    }
    catch (Exception ex)
    {
        r["can_connect"] = false;
        var sb = new StringBuilder(ex.Message);
        var inner = ex.InnerException;
        for (var d = 0; inner is not null && d < 2; d++)
        {
            sb.Append(" | inner: ").Append(inner.Message);
            inner = inner.InnerException;
        }
        r["error"] = RedactDb(sb.ToString(), dbPasswordForRedaction);
    }
    return Results.Ok(r);
});

// ---------- Area administrativa ----------

// --- Publicos (leitura) ---
app.MapGet("/api/cities", async (AppDbContext db) =>
    Results.Ok(await db.Cities.OrderBy(c => c.Id).ToListAsync()));

app.MapGet("/api/news/pinned", async (AppDbContext db) =>
    Results.Ok(await db.PinnedNews.OrderByDescending(p => p.PinnedAt).Take(10).ToListAsync()));

app.MapGet("/api/articles", async (AppDbContext db) =>
    Results.Ok(await db.Articles.OrderByDescending(a => a.CreatedAt).Take(24).ToListAsync()));

// --- Cidades (admin) ---
app.MapGet("/api/cities/suggest", async (string? q, Api.Services.IWeatherService weather) =>
    Results.Ok(await weather.SuggestCitiesAsync(q ?? string.Empty)))
    .RequireAuthorization("AdminOnly");

app.MapPost("/api/admin/cities", async (City input, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest(new { message = "Nome da cidade obrigatorio" });
    var name = input.Name.Trim();
    if (await db.Cities.AnyAsync(c => c.Name == name)) return Results.Conflict(new { message = "Cidade ja cadastrada" });
    if (input.IsPrimary)
        foreach (var c in db.Cities.Where(c => c.IsPrimary)) c.IsPrimary = false;
    db.Cities.Add(new City { Name = name, IsPrimary = input.IsPrimary });
    await db.SaveChangesAsync();
    return Results.Ok(await db.Cities.OrderBy(c => c.Id).ToListAsync());
}).RequireAuthorization("AdminOnly");

app.MapDelete("/api/admin/cities/{id:int}", async (int id, AppDbContext db) =>
{
    var city = await db.Cities.FindAsync(id);
    if (city is null) return Results.NotFound();
    db.Cities.Remove(city);
    await db.SaveChangesAsync();
    return Results.Ok(await db.Cities.OrderBy(c => c.Id).ToListAsync());
}).RequireAuthorization("AdminOnly");

// --- Noticias fixadas (admin) ---
app.MapPost("/api/admin/pins", async (PinnedNews input, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(input.Title) || string.IsNullOrWhiteSpace(input.Url))
        return Results.BadRequest(new { message = "Titulo e URL obrigatorios" });
    if (await db.PinnedNews.AnyAsync(p => p.Url == input.Url))
        return Results.Conflict(new { message = "Noticia ja fixada" });
    db.PinnedNews.Add(new PinnedNews
    {
        Title = input.Title.Trim(), Url = input.Url.Trim(),
        UrlToImage = input.UrlToImage, Description = input.Description,
        SourceName = input.SourceName, PinnedAt = DateTime.UtcNow
    });
    await db.SaveChangesAsync();
    return Results.Ok(await db.PinnedNews.OrderByDescending(p => p.PinnedAt).ToListAsync());
}).RequireAuthorization("AdminOnly");

app.MapDelete("/api/admin/pins/{id:int}", async (int id, AppDbContext db) =>
{
    var pin = await db.PinnedNews.FindAsync(id);
    if (pin is null) return Results.NotFound();
    db.PinnedNews.Remove(pin);
    await db.SaveChangesAsync();
    return Results.Ok(await db.PinnedNews.OrderByDescending(p => p.PinnedAt).ToListAsync());
}).RequireAuthorization("AdminOnly");

// --- Editoria (admin) ---
app.MapPost("/api/admin/articles", async (Article input, AppDbContext db, ClaimsPrincipal user) =>
{
    if (string.IsNullOrWhiteSpace(input.Title) || string.IsNullOrWhiteSpace(input.Body))
        return Results.BadRequest(new { message = "Titulo e corpo obrigatorios" });
    db.Articles.Add(new Article
    {
        Title = input.Title.Trim(), Body = input.Body.Trim(),
        Category = string.IsNullOrWhiteSpace(input.Category) ? "Geral" : input.Category.Trim(),
        Author = user.Identity?.Name ?? "Redacao",
        CreatedAt = DateTime.UtcNow
    });
    await db.SaveChangesAsync();
    return Results.Ok(await db.Articles.OrderByDescending(a => a.CreatedAt).ToListAsync());
}).RequireAuthorization("AdminOnly");

app.MapPut("/api/admin/articles/{id:int}", async (int id, Article input, AppDbContext db) =>
{
    var article = await db.Articles.FindAsync(id);
    if (article is null) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(input.Title) || string.IsNullOrWhiteSpace(input.Body))
        return Results.BadRequest(new { message = "Titulo e corpo obrigatorios" });
    article.Title = input.Title.Trim();
    article.Body = input.Body.Trim();
    article.Category = string.IsNullOrWhiteSpace(input.Category) ? "Geral" : input.Category.Trim();
    await db.SaveChangesAsync();
    return Results.Ok(await db.Articles.OrderByDescending(a => a.CreatedAt).ToListAsync());
}).RequireAuthorization("AdminOnly");

app.MapDelete("/api/admin/articles/{id:int}", async (int id, AppDbContext db) =>
{
    var article = await db.Articles.FindAsync(id);
    if (article is null) return Results.NotFound();
    db.Articles.Remove(article);
    await db.SaveChangesAsync();
    return Results.Ok(await db.Articles.OrderByDescending(a => a.CreatedAt).ToListAsync());
}).RequireAuthorization("AdminOnly");

// --- Usuarios (admin) ---
app.MapGet("/api/admin/users", async (AppDbContext db) =>
    Results.Ok(await db.Users.OrderBy(u => u.Id)
        .Select(u => new { u.Id, u.Username, u.Role }).ToListAsync()))
    .RequireAuthorization("AdminOnly");

app.MapPost("/api/admin/users", async (CreateUserRequest input, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(input.Username) || input.Password.Length < 8)
        return Results.BadRequest(new { message = "Usuario obrigatorio e senha com 8+ caracteres" });
    var username = input.Username.Trim();
    if (await db.Users.AnyAsync(u => u.Username == username))
        return Results.Conflict(new { message = "Usuario ja existe" });
    var role = input.Role == "Admin" ? "Admin" : "Editor";
    db.Users.Add(new User { Username = username, PasswordHash = HashPassword(input.Password), Role = role });
    await db.SaveChangesAsync();
    return Results.Ok(await db.Users.OrderBy(u => u.Id)
        .Select(u => new { u.Id, u.Username, u.Role }).ToListAsync());
}).RequireAuthorization("AdminOnly");

app.MapDelete("/api/admin/users/{id:int}", async (int id, AppDbContext db, ClaimsPrincipal user) =>
{
    var target = await db.Users.FindAsync(id);
    if (target is null) return Results.NotFound();
    var selfName = user.Identity?.Name;
    if (target.Username == selfName) return Results.BadRequest(new { message = "Voce nao pode excluir a si mesmo" });
    if (target.Role == "Admin" && await db.Users.CountAsync(u => u.Role == "Admin") <= 1)
        return Results.BadRequest(new { message = "Nao e possivel excluir o ultimo admin" });
    db.Users.Remove(target);
    await db.SaveChangesAsync();
    return Results.Ok(await db.Users.OrderBy(u => u.Id)
        .Select(u => new { u.Id, u.Username, u.Role }).ToListAsync());
}).RequireAuthorization("AdminOnly");

// --- Estatisticas (admin) ---
app.MapGet("/api/admin/stats", async (AppDbContext db) =>
    Results.Ok(new
    {
        users = await db.Users.CountAsync(),
        cities = await db.Cities.CountAsync(),
        pins = await db.PinnedNews.CountAsync(),
        articles = await db.Articles.CountAsync()
    }))
    .RequireAuthorization("AdminOnly");

// SPA fallback: any non-API route serves the React app
app.MapFallbackToFile("index.html");

// Render sets PORT; locally we default to 5001
var port = Environment.GetEnvironmentVariable("PORT") ?? "5001";
app.Run($"http://0.0.0.0:{port}");
