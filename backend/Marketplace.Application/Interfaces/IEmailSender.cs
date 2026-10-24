namespace Marketplace.Application.Interfaces;

public interface IEmailSender
{
    Task SendVerificationEmailAsync(string toEmail, string code, TimeSpan expiry, CancellationToken cancellationToken = default);
    Task SendPasswordResetEmailAsync(string toEmail, string code, TimeSpan expiry, CancellationToken cancellationToken = default);
    Task SendEmailAsync(string toEmail, string subject, string plainTextBody, string htmlBody, CancellationToken cancellationToken = default);
}
