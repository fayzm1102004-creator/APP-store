using Microsoft.EntityFrameworkCore;
using System.Reflection;
using System.Text;
using System.Threading.RateLimiting;
using Marketplace.API.Filters;
using Marketplace.API.Middleware;
using Marketplace.Application;
using Marketplace.Infrastructure;
using Marketplace.Infrastructure.Auth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;

var builder = WebApplication.CreateBuilder(args);

// ─── Startup Validation (Fail-Fast) ───────────────────────────

// 1. Connection string validation
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
var testDbEnv = Environment.GetEnvironmentVariable("TEST_DB");
if (string.IsNullOrWhiteSpace(connectionString) && string.IsNullOrWhiteSpace(testDbEnv))
{
    throw new InvalidOperationException("Startup failed: Database connection string 'DefaultConnection' is missing.");
}

// 2. JWT secret validation
var jwtKey = builder.Configuration["Jwt:Key"]
    ?? builder.Configuration["JWT_SECRET"]
    ?? builder.Configuration["JwtSettings:Key"];

if (string.IsNullOrWhiteSpace(jwtKey))
{
    throw new InvalidOperationException("Startup failed: JWT secret is missing.");
}

if (jwtKey.Length < 32)
{
    throw new InvalidOperationException($"Startup failed: JWT secret must be at least 32 characters long (current length: {jwtKey.Length}).");
}

var knownDefaultSecrets = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
{
    "SuperSecretKeyForDevelopmentOnly123!AtLeast32Chars",
    "your-secret-key-must-be-at-least-32-characters-long",
    "12345678901234567890123456789012",
    "defaultsecretkeydefaultsecretkey123",
    "abcdefghijklmnopqrstuvwxyz123456",
    "secretkeysecretkeysecretkey123456"
};

if (!builder.Environment.IsDevelopment() && knownDefaultSecrets.Contains(jwtKey))
{
    throw new InvalidOperationException("Startup failed: A known default JWT secret cannot be used in a non-Development environment.");
}

// 3. Dedicated Verification Code Secret validation (Auth:CodeSecret)
var codeSecret = builder.Configuration["Auth:CodeSecret"]
    ?? builder.Configuration["AUTH_CODE_SECRET"];

if (string.IsNullOrWhiteSpace(codeSecret))
{
    throw new InvalidOperationException("Startup failed: Auth:CodeSecret is missing. A dedicated HMAC secret is required for verification codes.");
}

if (codeSecret.Length < 32)
{
    throw new InvalidOperationException($"Startup failed: Auth:CodeSecret must be at least 32 characters long (current length: {codeSecret.Length}).");
}

// 4. Verification requirement safety check
var requireVerification = builder.Configuration.GetValue<bool>("Auth:RequireVerification", true);
if (!requireVerification)
{
    Console.ForegroundColor = ConsoleColor.Yellow;
    Console.WriteLine("⚠️ WARNING: Auth:RequireVerification is set to FALSE! Account verification is bypassed. This setting MUST NEVER be used in production.");
    Console.ResetColor();
}

// ─── Layers ─────────────────────────────────────────────────
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration, builder.Environment);

// ─── Controllers + FluentValidation filter ──────────────────
builder.Services.AddControllers(options => options.Filters.Add<ValidationFilter>())
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
    });

// ─── Forwarded Headers (Reverse Proxy / Load Balancer) ───────
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1; // Strictly 1 hop (never null) to prevent X-Forwarded-For spoofing

    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();

    var configuredProxies = builder.Configuration.GetSection("ReverseProxy:KnownProxies").Get<string[]>() ?? Array.Empty<string>();
    foreach (var proxyStr in configuredProxies)
    {
        if (System.Net.IPAddress.TryParse(proxyStr?.Trim(), out var ipAddr))
        {
            options.KnownProxies.Add(ipAddr);
        }
    }

    var configuredNetworks = builder.Configuration.GetSection("ReverseProxy:KnownNetworks").Get<string[]>() ?? Array.Empty<string>();
    foreach (var cidr in configuredNetworks)
    {
        if (!string.IsNullOrWhiteSpace(cidr) && System.Net.IPNetwork.TryParse(cidr.Trim(), out var net))
        {
            options.KnownIPNetworks.Add(net);
        }
    }

    // Important: In ASP.NET Core, if KnownProxies and KnownIPNetworks are both empty,
    // ForwardedHeadersMiddleware trusts ALL proxies. Adding IPAddress.None when no
    // trusted proxy is configured prevents untrusted clients from spoofing X-Forwarded-For.
    if (options.KnownProxies.Count == 0 && options.KnownIPNetworks.Count == 0)
    {
        options.KnownProxies.Add(System.Net.IPAddress.None);
    }
});

// ─── Authentication (JWT Bearer) ────────────────────────────
var jwt = builder.Configuration.GetSection(JwtSettings.SectionName).Get<JwtSettings>()
          ?? throw new InvalidOperationException("Jwt settings are missing.");

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false; // keep short claim names: sub, email, name, role
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            NameClaimType = JwtService.ClaimNames.Name,
            RoleClaimType = JwtService.ClaimNames.Role, // makes [Authorize(Roles = "Seller")] work
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                var subClaim = context.Principal?.FindFirst(JwtService.ClaimNames.UserId)?.Value;
                var tvClaim = context.Principal?.FindFirst(JwtService.ClaimNames.TokenVersion)?.Value;

                if (int.TryParse(subClaim, out var userId) && int.TryParse(tvClaim, out var tokenVersion))
                {
                    var db = context.HttpContext.RequestServices.GetRequiredService<Marketplace.Infrastructure.Data.AppDbContext>();
                    var currentVersion = await db.Users
                        .Where(u => u.Id == userId)
                        .Select(u => (int?)u.TokenVersion)
                        .FirstOrDefaultAsync();

                    if (currentVersion == null || currentVersion != tokenVersion)
                    {
                        context.Fail("Token has been invalidated (revoked token version).");
                    }
                }
            }
        };
    });

builder.Services.AddAuthorization();

// ─── Swagger (Development Only) ─────────────────────────────
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "Marketplace API", Version = "v1" });

    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        Description = "Paste the JWT token returned by /api/auth/login"
    });

    c.AddSecurityRequirement(document => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("Bearer", document)] = new List<string>()
    });

    var xmlFile = $"{System.Reflection.Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    if (File.Exists(xmlPath))
    {
        c.IncludeXmlComments(xmlPath);
    }

    c.DocInclusionPredicate((docName, apiDesc) =>
    {
        if (!builder.Environment.IsDevelopment() &&
            apiDesc.RelativePath?.StartsWith("api/dev", StringComparison.OrdinalIgnoreCase) == true)
        {
            return false;
        }
        return true;
    });
});

// ─── CORS ───────────────────────────────────────────────────
builder.Services.AddCors(options =>
{
    if (builder.Environment.IsDevelopment())
    {
        options.AddPolicy("AllowAll", policy =>
            policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
    }
    else
    {
        var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() 
                             ?? Array.Empty<string>();

        options.AddPolicy("AllowAll", policy =>
        {
            if (allowedOrigins.Length > 0)
            {
                policy.WithOrigins(allowedOrigins)
                      .AllowAnyMethod()
                      .AllowAnyHeader()
                      .AllowCredentials();
            }
            else
            {
                policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
            }
        });
    }
});

// ─── Rate Limiting (Per-IP, Per-UserId when authenticated, and Per-Normalized-Target) ───
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    static string GetPartitionKey(HttpContext httpContext, string prefix)
    {
        var ip = httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var userId = httpContext.User?.FindFirst(JwtService.ClaimNames.UserId)?.Value
                     ?? httpContext.User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var normalizedTarget = httpContext.Items.TryGetValue("RateLimitTarget", out var t) && t is string ts && !string.IsNullOrWhiteSpace(ts)
            ? ts
            : null;

        if (!string.IsNullOrWhiteSpace(userId))
            return $"{prefix}:user:{userId}:ip:{ip}";
        if (!string.IsNullOrWhiteSpace(normalizedTarget))
            return $"{prefix}:ip:{ip}";
        return $"{prefix}:ip:{ip}";
    }

    // Policy for auth operations: login, register, verify, resend, forgot/reset password, google
    options.AddPolicy("auth-policy", httpContext =>
    {
        var isDev = builder.Environment.IsDevelopment();
        var permitLimit = builder.Configuration.GetValue<int>("RateLimiting:AuthPermitLimit", isDev ? 1000 : 15);
        var key = GetPartitionKey(httpContext, "auth");
        return RateLimitPartition.GetFixedWindowLimiter(
            key,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = TimeSpan.FromMinutes(1),
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            });
    });

    // Policy for refresh operations
    options.AddPolicy("refresh-policy", httpContext =>
    {
        var isDev = builder.Environment.IsDevelopment();
        var permitLimit = builder.Configuration.GetValue<int>("RateLimiting:RefreshPermitLimit", isDev ? 1000 : 30);
        var key = GetPartitionKey(httpContext, "refresh");
        return RateLimitPartition.GetFixedWindowLimiter(
            key,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = TimeSpan.FromMinutes(1),
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            });
    });

    // Policy for upload operations
    options.AddPolicy("upload-policy", httpContext =>
    {
        var isDev = builder.Environment.IsDevelopment();
        var permitLimit = builder.Configuration.GetValue<int>("RateLimiting:UploadPermitLimit", isDev ? 1000 : 10);
        var key = GetPartitionKey(httpContext, "upload");
        return RateLimitPartition.GetFixedWindowLimiter(
            key,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = TimeSpan.FromMinutes(1),
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                QueueLimit = 0
            });
    });
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    var db = scope.ServiceProvider.GetRequiredService<Marketplace.Infrastructure.Data.AppDbContext>();

    try
    {
        var isInMemoryProvider = string.Equals(
            db.Database.ProviderName,
            "Microsoft.EntityFrameworkCore.InMemory",
            StringComparison.Ordinal);

        if (isInMemoryProvider)
        {
            // Explicit provider check: only used when a test host explicitly configures Microsoft.EntityFrameworkCore.InMemory
            await db.Database.EnsureCreatedAsync();
            logger.LogInformation("Database initialized using InMemory provider (test host only).");
        }
        else
        {
            // Startup Guard: inspect public schema for user tables and __EFMigrationsHistory
            bool hasHistoryTable = false;
            long existingUserTables = 0;

            var conn = db.Database.GetDbConnection();
            var shouldClose = conn.State != System.Data.ConnectionState.Open;
            if (shouldClose)
            {
                await conn.OpenAsync();
            }

            try
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
                    SELECT
                        EXISTS (
                            SELECT 1
                            FROM information_schema.tables
                            WHERE table_schema = 'public'
                              AND table_name = '__EFMigrationsHistory'
                        ) AS has_history,
                        COUNT(*) FILTER (WHERE table_name <> '__EFMigrationsHistory') AS user_table_count
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_type = 'BASE TABLE';";

                using var reader = await cmd.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    hasHistoryTable = reader.GetBoolean(0);
                    existingUserTables = reader.GetInt64(1);
                }
            }
            finally
            {
                if (shouldClose)
                {
                    await conn.CloseAsync();
                }
            }

            // 1. Refuse to start if the database has tables but no __EFMigrationsHistory table (e.g. EnsureCreated)
            if (existingUserTables > 0 && !hasHistoryTable)
            {
                throw new InvalidOperationException(
                    "Startup refused: The database contains existing tables in schema 'public' but no '__EFMigrationsHistory' table. " +
                    "The schema must come only from EF Core migrations (never EnsureCreated).");
            }

            // 2. Database:AutoMigrate (default false) for test deployments only; must also refuse when history table is missing
            var autoMigrate = app.Configuration.GetValue<bool>("Database:AutoMigrate", false);
            if (autoMigrate)
            {
                if (!hasHistoryTable)
                {
                    throw new InvalidOperationException(
                        "Startup refused: Database:AutoMigrate is enabled, but the '__EFMigrationsHistory' table is missing.");
                }

                logger.LogWarning("Database:AutoMigrate is enabled (for test deployments only). Applying EF Core PostgreSQL migrations on startup...");
                await db.Database.MigrateAsync();
                logger.LogInformation("Database migrations applied successfully.");
            }
        }

        // Seed initial categories if none exist
        if (!await db.Categories.AnyAsync())
        {
            db.Categories.AddRange(
                new Marketplace.Domain.Entities.Category { Id = 1, Key = "electronics", IconName = "devices" },
                new Marketplace.Domain.Entities.Category { Id = 2, Key = "clothing", IconName = "shirt" },
                new Marketplace.Domain.Entities.Category { Id = 3, Key = "shoes", IconName = "shoe-sneaker" },
                new Marketplace.Domain.Entities.Category { Id = 4, Key = "home", IconName = "home" },
                new Marketplace.Domain.Entities.Category { Id = 5, Key = "beauty", IconName = "sparkles" },
                new Marketplace.Domain.Entities.Category { Id = 6, Key = "kids", IconName = "baby" },
                new Marketplace.Domain.Entities.Category { Id = 7, Key = "sports", IconName = "basketball" },
                new Marketplace.Domain.Entities.Category { Id = 8, Key = "accessories", IconName = "watch" },
                new Marketplace.Domain.Entities.Category { Id = 9, Key = "other", IconName = "dots-horizontal" }
            );
            await db.SaveChangesAsync();
            logger.LogInformation("Core categories seeded successfully.");
        }

        // Admin Seeding: Off by default. No hardcoded or default credentials.
        // Runs ONLY when both Admin__Email and Admin__Password env vars are explicitly set.
        // Requires password length of at least 16 characters; never logs credentials.
        var adminEmail = Environment.GetEnvironmentVariable("Admin__Email")
            ?? Environment.GetEnvironmentVariable("ADMIN_EMAIL");
        var adminPassword = Environment.GetEnvironmentVariable("Admin__Password")
            ?? Environment.GetEnvironmentVariable("ADMIN_PASSWORD");

        if (!string.IsNullOrWhiteSpace(adminEmail) && !string.IsNullOrWhiteSpace(adminPassword))
        {
            if (adminPassword.Length < 16)
            {
                throw new InvalidOperationException("Startup failed: Admin password must be at least 16 characters long.");
            }

            var normalizedEmail = adminEmail.Trim().ToLowerInvariant();
            if (!await db.Users.AnyAsync(u => u.Email == normalizedEmail))
            {
                var hasher = scope.ServiceProvider.GetRequiredService<Marketplace.Application.Interfaces.IPasswordHasher>();
                db.Users.Add(new Marketplace.Domain.Entities.User
                {
                    Name = "Platform Admin",
                    Email = normalizedEmail,
                    PasswordHash = hasher.Hash(adminPassword),
                    Role = Marketplace.Domain.Enums.UserRole.Admin,
                    IsActive = true,
                    EmailVerifiedAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow
                });
                await db.SaveChangesAsync();
                // Zero-PII logging: never log email or credentials
                logger.LogInformation("Platform admin seeded from configured environment variables.");
            }
        }
    }
    catch (InvalidOperationException ex)
    {
        logger.LogCritical(ex, "Fatal startup validation error.");
        throw;
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "An error occurred during database startup checks or seeding.");
        if (!app.Environment.IsDevelopment())
        {
            throw;
        }
    }
}

app.UseMiddleware<GlobalExceptionMiddleware>();

// Forwarded headers for reverse proxies (e.g. Railway, Nginx)
app.UseForwardedHeaders();

// Restrict Swagger to Development environment only
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Block /api/dev/* endpoints in non-Development environments
app.Use(async (context, next) =>
{
    if (!app.Environment.IsDevelopment() &&
        context.Request.Path.StartsWithSegments("/api/dev", StringComparison.OrdinalIgnoreCase))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }
    await next();
});

app.UseCors("AllowAll");

app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        ctx.Context.Response.Headers.Append("Access-Control-Allow-Origin", "*");
        ctx.Context.Response.Headers.Append("Access-Control-Allow-Headers", "*");
        ctx.Context.Response.Headers.Append("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    }
});

app.UseAuthentication();

// Multi-key Rate Limiting enforcement:
// 1) Per client IP (after ForwardedHeaders with ForwardLimit = 1 and KnownProxies validation)
// 2) Per authenticated UserId (when authenticated)
// 3) Per normalized target (email lowercase or +20... phone on auth endpoints)
var multiKeyCounters = new System.Collections.Concurrent.ConcurrentDictionary<string, (int Count, DateTime WindowStart)>(StringComparer.Ordinal);
app.Use(async (context, next) =>
{
    var isDev = app.Environment.IsDevelopment();
    var window = TimeSpan.FromMinutes(1);
    var now = DateTime.UtcNow;

    bool TryAcquireBucket(string bucketKey, int limit)
    {
        while (true)
        {
            var current = multiKeyCounters.GetOrAdd(bucketKey, _ => (0, now));
            if (now - current.WindowStart >= window)
            {
                if (multiKeyCounters.TryUpdate(bucketKey, (1, now), current))
                    return true;
            }
            else
            {
                if (current.Count >= limit)
                    return false;
                if (multiKeyCounters.TryUpdate(bucketKey, (current.Count + 1, current.WindowStart), current))
                    return true;
            }
        }
    }

    var remoteIp = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    var ipLimit = app.Configuration.GetValue<int>("RateLimiting:IpPermitLimit", isDev ? 1000 : 60);
    if (!TryAcquireBucket($"ip:{remoteIp}", ipLimit))
    {
        context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        return;
    }

    var userId = context.User?.FindFirst(JwtService.ClaimNames.UserId)?.Value
                 ?? context.User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
    if (!string.IsNullOrWhiteSpace(userId))
    {
        var userLimit = app.Configuration.GetValue<int>("RateLimiting:UserPermitLimit", isDev ? 1000 : 60);
        if (!TryAcquireBucket($"user:{userId}", userLimit))
        {
            context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            return;
        }
    }

    if (HttpMethods.IsPost(context.Request.Method) &&
        context.Request.Path.StartsWithSegments("/api/auth", StringComparison.OrdinalIgnoreCase) &&
        context.Request.ContentType?.Contains("application/json", StringComparison.OrdinalIgnoreCase) == true)
    {
        context.Request.EnableBuffering();
        try
        {
            using var doc = await System.Text.Json.JsonDocument.ParseAsync(context.Request.Body);
            context.Request.Body.Position = 0;
            var root = doc.RootElement;
            if (root.ValueKind == System.Text.Json.JsonValueKind.Object)
            {
                string? rawTarget = null;
                foreach (var prop in root.EnumerateObject())
                {
                    if (prop.Value.ValueKind == System.Text.Json.JsonValueKind.String &&
                        (string.Equals(prop.Name, "email", StringComparison.OrdinalIgnoreCase) ||
                         string.Equals(prop.Name, "phone", StringComparison.OrdinalIgnoreCase) ||
                         string.Equals(prop.Name, "identifier", StringComparison.OrdinalIgnoreCase) ||
                         string.Equals(prop.Name, "target", StringComparison.OrdinalIgnoreCase)))
                    {
                        var val = prop.Value.GetString();
                        if (!string.IsNullOrWhiteSpace(val))
                        {
                            rawTarget = val.Trim();
                            break;
                        }
                    }
                }

                if (!string.IsNullOrWhiteSpace(rawTarget))
                {
                    var normalizedTarget = rawTarget.Contains('@')
                        ? rawTarget.ToLowerInvariant()
                        : Marketplace.Application.Common.EgyptianPhoneNormalizer.Normalize(rawTarget).ToLowerInvariant();

                    context.Items["RateLimitTarget"] = normalizedTarget;
                    var targetLimit = app.Configuration.GetValue<int>("RateLimiting:TargetPermitLimit", isDev ? 1000 : 10);
                    if (!TryAcquireBucket($"target:{normalizedTarget}", targetLimit))
                    {
                        context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                        return;
                    }
                }
            }
        }
        catch
        {
            context.Request.Body.Position = 0;
        }
    }

    await next();
});

app.UseRateLimiter();
app.UseAuthorization();

app.MapControllers();

var getHealthResponse = () =>
{
    var commitSha = Environment.GetEnvironmentVariable("RAILWAY_GIT_COMMIT_SHA")
        ?? Environment.GetEnvironmentVariable("GIT_COMMIT_SHA")
        ?? Environment.GetEnvironmentVariable("COMMIT_SHA");

    var assembly = typeof(Program).Assembly;
    var infoVersion = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
    var buildDate = File.Exists(assembly.Location)
        ? File.GetLastWriteTimeUtc(assembly.Location).ToString("yyyy-MM-ddTHH:mm:ssZ")
        : DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");

    var version = !string.IsNullOrEmpty(commitSha)
        ? commitSha
        : (!string.IsNullOrEmpty(infoVersion) ? infoVersion : buildDate);

    return Results.Ok(new
    {
        status = "Healthy",
        version,
        commit = commitSha,
        buildDate
    });
};

app.MapGet("/health", getHealthResponse).AllowAnonymous();
app.MapGet("/api/health", getHealthResponse).AllowAnonymous();

app.Run();
