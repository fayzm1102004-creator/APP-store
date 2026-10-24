using Marketplace.Application.Interfaces;
using Marketplace.Infrastructure.Auth;
using Marketplace.Infrastructure.Data;
using Marketplace.Infrastructure.Delivery;
using Marketplace.Infrastructure.Notifications;
using Marketplace.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Marketplace.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment? environment = null)
    {
        // Database (PostgreSQL only; TEST_DB environment variable overrides database name/connection string for testing)
        var connStr = configuration.GetConnectionString("DefaultConnection");
        var testDb = Environment.GetEnvironmentVariable("TEST_DB");
        if (!string.IsNullOrWhiteSpace(testDb))
        {
            if (testDb.Contains("="))
            {
                connStr = testDb;
            }
            else if (!string.IsNullOrWhiteSpace(connStr))
            {
                var csb = new Npgsql.NpgsqlConnectionStringBuilder(connStr)
                {
                    Database = testDb
                };
                connStr = csb.ConnectionString;
            }
        }

        services.AddDbContext<AppDbContext>(options =>
        {
            options.UseNpgsql(connStr);
        });

        services.AddScoped<IUnitOfWork, UnitOfWork>();

        // Auth
        services.Configure<JwtSettings>(configuration.GetSection(JwtSettings.SectionName));
        services.AddScoped<IJwtService, JwtService>();
        services.AddSingleton<IPasswordHasher, BCryptPasswordHasher>();
        services.AddScoped<IGoogleTokenValidator, GoogleTokenValidator>();

        // Email and SMS Senders
        services.AddSingleton<IFakeMessageStore, FakeMessageStore>();

        var isDev = environment?.IsDevelopment() ?? string.Equals(Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"), "Development", StringComparison.OrdinalIgnoreCase);

        if (isDev)
        {
            services.AddSingleton<IEmailSender, ConsoleEmailSender>();
            services.AddSingleton<ISmsSender, ConsoleSmsSender>();
        }
        else
        {
            services.AddHttpClient<IEmailSender, ResendEmailSender>();
            services.AddSingleton<ISmsSender, NotConfiguredSmsSender>();
        }

        // Delivery Provider (selected by configuration, defaults to "Fake")
        var deliveryProviderName = configuration["Delivery:Provider"] ?? "Fake";
        switch (deliveryProviderName.ToLowerInvariant())
        {
            case "fake":
            default:
                services.AddSingleton<IDeliveryProvider, FakeDeliveryProvider>();
                break;
        }

        // Push Notifications (Expo / FCM)
        services.AddHttpClient<IPushNotificationProvider, Marketplace.Infrastructure.Notifications.ExpoPushNotificationProvider>();

        // Background Services
        services.AddHostedService<Marketplace.Infrastructure.BackgroundServices.VerificationCodeCleanupService>();

        return services;
    }
}
