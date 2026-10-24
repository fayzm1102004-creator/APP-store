namespace Marketplace.Application.Interfaces;

public interface ISmsSender
{
    Task SendVerificationSmsAsync(string toPhone, string code, TimeSpan expiry, CancellationToken cancellationToken = default);
    Task SendPasswordResetSmsAsync(string toPhone, string code, TimeSpan expiry, CancellationToken cancellationToken = default);
    Task SendSmsAsync(string toPhone, string message, CancellationToken cancellationToken = default);
}
