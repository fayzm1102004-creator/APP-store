using Marketplace.Application.Interfaces;
using Marketplace.Application.Templates;

namespace Marketplace.Infrastructure.Notifications;

public class ConsoleEmailSender : IEmailSender
{
    private readonly IFakeMessageStore _messageStore;

    public ConsoleEmailSender(IFakeMessageStore messageStore)
    {
        _messageStore = messageStore;
    }

    public Task SendVerificationEmailAsync(string toEmail, string code, TimeSpan expiry, CancellationToken cancellationToken = default)
    {
        _messageStore.RecordCode(toEmail, code, "Verify");
        var (subject, plainText, html) = EmailTemplates.VerificationCode(code, (int)expiry.TotalMinutes);
        Console.WriteLine($"[ConsoleEmailSender] Verification email to {toEmail}: CODE={code} (expires in {expiry.TotalMinutes}m)");
        return Task.CompletedTask;
    }

    public Task SendPasswordResetEmailAsync(string toEmail, string code, TimeSpan expiry, CancellationToken cancellationToken = default)
    {
        _messageStore.RecordCode(toEmail, code, "ResetPassword");
        var (subject, plainText, html) = EmailTemplates.PasswordResetCode(code, (int)expiry.TotalMinutes);
        Console.WriteLine($"[ConsoleEmailSender] Password reset email to {toEmail}: CODE={code} (expires in {expiry.TotalMinutes}m)");
        return Task.CompletedTask;
    }

    public Task SendEmailAsync(string toEmail, string subject, string plainTextBody, string htmlBody, CancellationToken cancellationToken = default)
    {
        Console.WriteLine($"[ConsoleEmailSender] Email to {toEmail}: Subject={subject}\n{plainTextBody}");
        return Task.CompletedTask;
    }
}
