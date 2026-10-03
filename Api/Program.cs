using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
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

// --- Database ---
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite("Data Source=neon_app.db"));

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

builder.Services.AddAuthorization();

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
    db.Database.EnsureCreated();
    if (!db.Users.Any(u => u.Username == seedUsername))
    {
        db.Users.Add(new User { Username = seedUsername, PasswordHash = HashPassword(seedPassword), Role = "Admin" });
        db.SaveChanges();
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

// SPA fallback: any non-API route serves the React app
app.MapFallbackToFile("index.html");

// Render sets PORT; locally we default to 5001
var port = Environment.GetEnvironmentVariable("PORT") ?? "5001";
app.Run($"http://0.0.0.0:{port}");
