using Marketplace.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Marketplace.Infrastructure.BackgroundServices;

/// <summary>
/// Background service that periodically prunes expired or consumed verification codes older than 24 hours.
/// </summary>
public class VerificationCodeCleanupService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<VerificationCodeCleanupService> _logger;
    private readonly TimeSpan _checkInterval = TimeSpan.FromHours(1);

    public VerificationCodeCleanupService(
        IServiceProvider serviceProvider,
        ILogger<VerificationCodeCleanupService> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("VerificationCodeCleanupService started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                var cutoff = DateTime.UtcNow.AddHours(-24);
                var deletedCount = await db.VerificationCodes
                    .Where(c => c.ExpiresAt < cutoff || (c.ConsumedAt != null && c.ConsumedAt < cutoff))
                    .ExecuteDeleteAsync(stoppingToken);

                if (deletedCount > 0)
                {
                    _logger.LogInformation("VerificationCodeCleanupService deleted {Count} expired/consumed codes.", deletedCount);
                }
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                _logger.LogError(ex, "Error occurred during verification code cleanup sweep.");
            }

            try
            {
                await Task.Delay(_checkInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        _logger.LogInformation("VerificationCodeCleanupService stopped.");
    }
}
