using Marketplace.Application.Interfaces;
using Microsoft.Extensions.Logging;

namespace Marketplace.Infrastructure.Notifications;

public class NotConfiguredSmsSender : ISmsSender
{
    private readonly ILogger<NotConfiguredSmsSender> _logger;

    public NotConfiguredSmsSender(ILogger<NotConfiguredSmsSender> logger)
    {
        _logger = logger;
    }

    public Task SendVerificationSmsAsync(string toPhone, string code, TimeSpan expiry, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("SMS dispatch attempted, but SMS service is not configured.");
        throw new InvalidOperationException("SMS provider is not configured. Real SMS provider will be integrated in a future release.");
    }

    public Task SendPasswordResetSmsAsync(string toPhone, string code, TimeSpan expiry, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("SMS dispatch attempted, but SMS service is not configured.");
        throw new InvalidOperationException("SMS provider is not configured. Real SMS provider will be integrated in a future release.");
    }

    public Task SendSmsAsync(string toPhone, string message, CancellationToken cancellationToken = default)
    {
        _logger.LogWarning("SMS dispatch attempted, but SMS service is not configured.");
        throw new InvalidOperationException("SMS provider is not configured. Real SMS provider will be integrated in a future release.");
    }
}
