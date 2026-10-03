using Microsoft.AspNetCore.Authentication.JwtBearer;
using System.Text;
using Scalar.AspNetCore;
using Api.Data;
using Api.Models;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;

var builder = WebApplication.CreateBuilder(args);

// Register API Services
builder.Services.AddHttpClient<Api.Services.INewsService, Api.Services.NewsService>();
builder.Services.AddHttpClient<Api.Services.IWeatherService, Api.Services.WeatherService>();


// --- Configurations ---
// JWT_KEY must be set in production (e.g. Render Environment). Fallback is dev-only.
var jwtKey = Environment.GetEnvironmentVariable("JWT_KEY") ?? "dev-only-insecure-jwt-key-change-me-9f8e7d6c5b4a";
var jwtIssuer = "PortalCentral";
var jwtAudience = "PortalCentralUsers";

// --- Database ---
builder.Services.AddDbContext<AppDbContext>(options => 
    options.UseSqlite("Data Source=neon_app.db"));

// --- Security ---
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
builder.Services.AddControllers();
builder.Services.AddHttpClient();
builder.Services.AddOpenApi();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

var app = builder.Build();

// --- Database Initializer (Seed Admin) ---
var seedUsername = Environment.GetEnvironmentVariable("ADMIN_USERNAME") ?? "admin";
var seedPassword = Environment.GetEnvironmentVariable("ADMIN_PASSWORD") ?? "Admin@123"; // change in production via env
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    if (!db.Users.Any(u => u.Username == seedUsername))
    {
        // Demo only: plaintext compare. Full hashing comes with the auth task.
        db.Users.Add(new User { Username = seedUsername, PasswordHash = seedPassword, Role = "Admin" });
        db.SaveChanges();
    }
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.UseCors("AllowAll");
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

// Auth Endpoint
app.MapPost("/api/auth/login", async (LoginRequest request, AppDbContext db) =>
{
    var user = await db.Users.FirstOrDefaultAsync(u => u.Username == request.Username && u.PasswordHash == request.Password);
    if (user == null) return Results.Unauthorized();

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
    return Results.Ok(new { token = tokenHandler.WriteToken(token) });
});

// SPA fallback: any non-API route serves the React app
app.MapFallbackToFile("index.html");

// Render sets PORT; locally we default to 5001
var port = Environment.GetEnvironmentVariable("PORT") ?? "5001";
app.Run($"http://0.0.0.0:{port}");
