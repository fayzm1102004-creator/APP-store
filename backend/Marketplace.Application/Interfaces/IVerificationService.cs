using Marketplace.Domain.Entities;
using Marketplace.Domain.Enums;

namespace Marketplace.Application.Interfaces;

public interface IVerificationService
{
    Task<string> GenerateAndSendCodeAsync(User user, string target, VerificationChannel channel, VerificationPurpose purpose, string? clientIp = null, CancellationToken cancellationToken = default);
    Task<VerificationCode> ValidateAndConsumeCodeAsync(string target, string code, VerificationPurpose purpose, CancellationToken cancellationToken = default);
    string MaskTarget(string target);
    string NormalizeTarget(string target, out VerificationChannel channel);
}
