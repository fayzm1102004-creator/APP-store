using Marketplace.Application.Interfaces;

namespace Marketplace.Infrastructure.Notifications;

public class ConsoleSmsSender : ISmsSender
{
    private readonly IFakeMessageStore _messageStore;

    public ConsoleSmsSender(IFakeMessageStore messageStore)
    {
        _messageStore = messageStore;
    }

    public Task SendVerificationSmsAsync(string toPhone, string code, TimeSpan expiry, CancellationToken cancellationToken = default)
    {
        _messageStore.RecordCode(toPhone, code, "Verify");
        var msg = $"رمز التحقق الخاص بك في سوق مصر هو: {code} (صالح لمدة {(int)expiry.TotalMinutes} دقائق). إذا لم تطلبه تجاهل هذه الرسالة.";
        Console.WriteLine($"[ConsoleSmsSender] SMS to {toPhone}: CODE={code} (expires in {expiry.TotalMinutes}m) => {msg}");
        return Task.CompletedTask;
    }

    public Task SendPasswordResetSmsAsync(string toPhone, string code, TimeSpan expiry, CancellationToken cancellationToken = default)
    {
        _messageStore.RecordCode(toPhone, code, "ResetPassword");
        var msg = $"رمز إعادة تعيين كلمة المرور في سوق مصر هو: {code} (صالح لمدة {(int)expiry.TotalMinutes} دقائق). إذا لم تطلبه تجاهل هذه الرسالة.";
        Console.WriteLine($"[ConsoleSmsSender] SMS to {toPhone}: CODE={code} (expires in {expiry.TotalMinutes}m) => {msg}");
        return Task.CompletedTask;
    }

    public Task SendSmsAsync(string toPhone, string message, CancellationToken cancellationToken = default)
    {
        Console.WriteLine($"[ConsoleSmsSender] SMS to {toPhone}: {message}");
        return Task.CompletedTask;
    }
}
