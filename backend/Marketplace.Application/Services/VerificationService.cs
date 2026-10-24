using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Marketplace.Application.Common;
using Marketplace.Application.Exceptions;
using Marketplace.Application.Interfaces;
using Marketplace.Application.Validators.Users;
using Marketplace.Domain.Entities;
using Marketplace.Domain.Enums;
using Microsoft.Extensions.Configuration;

namespace Marketplace.Application.Services;

public class VerificationService : IVerificationService
{
    private readonly IUnitOfWork _uow;
    private readonly IEmailSender _emailSender;
    private readonly ISmsSender _smsSender;
    private readonly IConfiguration _configuration;

    // In-memory sliding window for IP rate limiting (20 requests/hour per IP)
    private static readonly ConcurrentDictionary<string, ConcurrentQueue<DateTime>> IpRequestLog = new();

    public VerificationService(
        IUnitOfWork uow,
        IEmailSender emailSender,
        ISmsSender smsSender,
        IConfiguration configuration)
    {
        _uow = uow;
        _emailSender = emailSender;
        _smsSender = smsSender;
        _configuration = configuration;
    }

    public string NormalizeTarget(string target, out VerificationChannel channel)
    {
        if (string.IsNullOrWhiteSpace(target))
            throw new BadRequestException("Target cannot be empty.");

        var trimmed = target.Trim();

        if (trimmed.Contains('@'))
        {
            channel = VerificationChannel.Email;
            return trimmed.ToLowerInvariant();
        }

        // Validate Egyptian phone number
        if (!EgyptianPhoneValidation.PhoneRegex.IsMatch(trimmed))
        {
            throw new BadRequestException("Phone number must be a valid Egyptian mobile number (e.g. 01012345678 or +201012345678).");
        }

        channel = VerificationChannel.Phone;
        return EgyptianPhoneNormalizer.Normalize(trimmed);
    }

    public async Task<string> GenerateAndSendCodeAsync(
        User user,
        string target,
        VerificationChannel channel,
        VerificationPurpose purpose,
        string? clientIp = null,
        CancellationToken cancellationToken = default)
    {
        var normalizedTarget = NormalizeTarget(target, out var detectedChannel);
        channel = detectedChannel;

        // 1. IP Rate Limiting (20/hour per IP)
        if (!string.IsNullOrWhiteSpace(clientIp))
        {
            EnforceIpRateLimit(clientIp);
        }

        // 2. Target Rate Limiting (5/hour per target)
        var oneHourAgo = DateTime.UtcNow.AddHours(-1);
        var targetCodesLastHour = await _uow.VerificationCodes.FindAsync(c =>
            c.Target == normalizedTarget && c.CreatedAt >= oneHourAgo);

        if (targetCodesLastHour.Count() >= 5)
        {
            throw new TooManyRequestsException("تم تجاوز الحد الأقصى للرموز لهذا الحساب (5 رموز في الساعة). يرجى المحاولة لاحقاً.");
        }

        // 3. 60-Second Resend Cooldown per Target
        var sixtySecondsAgo = DateTime.UtcNow.AddSeconds(-60);
        var recentCode = (await _uow.VerificationCodes.FindAsync(c =>
            c.Target == normalizedTarget && c.CreatedAt >= sixtySecondsAgo)).FirstOrDefault();

        if (recentCode != null)
        {
            throw new TooManyRequestsException("يرجى الانتظار 60 ثانية قبل طلب رمز جديد (Please wait 60 seconds before requesting a new code).");
        }

        // 4. Global Daily SMS Cap
        if (channel == VerificationChannel.Phone)
        {
            int dailySmsCap = _configuration.GetValue<int>("Auth:DailySmsCap", 100);
            var todayUtc = DateTime.UtcNow.Date;
            var smsCountToday = (await _uow.VerificationCodes.FindAsync(c =>
                c.Channel == VerificationChannel.Phone && c.CreatedAt >= todayUtc)).Count();

            if (smsCountToday >= dailySmsCap)
            {
                throw new BadRequestException("تم الوصول إلى الحد اليومي الأقصى لرسائل SMS. يرجى المحاولة غداً أو استخدام البريد الإلكتروني.");
            }
        }

        // 5. Invalidate any previous unconsumed codes for this target and purpose
        var previousActiveCodes = await _uow.VerificationCodes.FindAsync(c =>
            c.Target == normalizedTarget && c.Purpose == purpose && c.ConsumedAt == null);

        foreach (var oldCode in previousActiveCodes)
        {
            oldCode.ConsumedAt = DateTime.UtcNow; // invalidated
        }

        // Lazy cleanup: prune expired or consumed codes older than 24 hours
        var cleanupCutoff = DateTime.UtcNow.AddHours(-24);
        var staleCodes = (await _uow.VerificationCodes.FindAsync(c =>
            c.ExpiresAt < cleanupCutoff || (c.ConsumedAt != null && c.ConsumedAt < cleanupCutoff))).ToList();
        foreach (var stale in staleCodes)
        {
            _uow.VerificationCodes.Remove(stale);
        }

        // 6. Generate 6-digit code using RandomNumberGenerator
        var codeInt = RandomNumberGenerator.GetInt32(100000, 1000000);
        var code = codeInt.ToString("D6");

        // 7. Store as HMAC-SHA256 with server secret
        var serverSecret = GetServerSecret();
        var codeHash = ComputeHmacSha256(code, serverSecret);

        var expiry = TimeSpan.FromMinutes(10);
        var verificationCode = new VerificationCode
        {
            UserId = user.Id,
            Channel = channel,
            Target = normalizedTarget,
            Purpose = purpose,
            CodeHash = codeHash,
            ExpiresAt = DateTime.UtcNow.Add(expiry),
            AttemptCount = 0,
            ConsumedAt = null,
            CreatedAt = DateTime.UtcNow
        };

        await _uow.VerificationCodes.AddAsync(verificationCode);
        await _uow.SaveChangesAsync();

        // 8. Dispatch code via appropriate sender
        if (channel == VerificationChannel.Email)
        {
            if (purpose == VerificationPurpose.ResetPassword)
            {
                await _emailSender.SendPasswordResetEmailAsync(normalizedTarget, code, expiry, cancellationToken);
            }
            else
            {
                await _emailSender.SendVerificationEmailAsync(normalizedTarget, code, expiry, cancellationToken);
            }
        }
        else
        {
            if (purpose == VerificationPurpose.ResetPassword)
            {
                await _smsSender.SendPasswordResetSmsAsync(normalizedTarget, code, expiry, cancellationToken);
            }
            else
            {
                await _smsSender.SendVerificationSmsAsync(normalizedTarget, code, expiry, cancellationToken);
            }
        }

        return MaskTarget(normalizedTarget);
    }

    public async Task<VerificationCode> ValidateAndConsumeCodeAsync(
        string target,
        string code,
        VerificationPurpose purpose,
        CancellationToken cancellationToken = default)
    {
        var normalizedTarget = NormalizeTarget(target, out _);

        if (string.IsNullOrWhiteSpace(code) || code.Trim().Length != 6)
        {
            throw new BadRequestException("Verification code must be 6 digits.");
        }

        var trimmedCode = code.Trim();

        // Find the active, unconsumed code for this target and purpose
        var codes = await _uow.VerificationCodes.FindAsync(c =>
            c.Target == normalizedTarget && c.Purpose == purpose && c.ConsumedAt == null);

        var codeRecord = codes.OrderByDescending(c => c.CreatedAt).FirstOrDefault();

        if (codeRecord == null)
        {
            throw new BadRequestException("Invalid or expired verification code.");
        }

        // Check if expired
        if (codeRecord.ExpiresAt < DateTime.UtcNow)
        {
            codeRecord.ConsumedAt = DateTime.UtcNow; // mark consumed/expired
            await _uow.SaveChangesAsync();
            throw new BadRequestException("Verification code has expired. Please request a new code.");
        }

        // Check if locked from too many attempts (max 5)
        if (codeRecord.AttemptCount >= 5)
        {
            codeRecord.ConsumedAt = DateTime.UtcNow; // invalidate
            await _uow.SaveChangesAsync();
            throw new BadRequestException("This verification code has been invalidated due to too many failed attempts (5). Please request a new code.");
        }

        // Compute HMAC-SHA256 of supplied code
        var serverSecret = GetServerSecret();
        var computedHash = ComputeHmacSha256(trimmedCode, serverSecret);

        // Constant-time comparison
        var computedBytes = Encoding.UTF8.GetBytes(computedHash);
        var storedBytes = Encoding.UTF8.GetBytes(codeRecord.CodeHash);

        var isMatch = CryptographicOperations.FixedTimeEquals(computedBytes, storedBytes);

        if (!isMatch)
        {
            codeRecord.AttemptCount++;
            if (codeRecord.AttemptCount >= 5)
            {
                codeRecord.ConsumedAt = DateTime.UtcNow; // lock code
            }
            await _uow.SaveChangesAsync();

            if (codeRecord.AttemptCount >= 5)
            {
                throw new BadRequestException("Incorrect code. You have reached the maximum of 5 attempts. This code is now invalidated.");
            }

            int attemptsLeft = 5 - codeRecord.AttemptCount;
            throw new BadRequestException($"Incorrect verification code. Attempts remaining: {attemptsLeft}.");
        }

        // Valid match! Consume code.
        codeRecord.ConsumedAt = DateTime.UtcNow;
        await _uow.SaveChangesAsync();

        return codeRecord;
    }

    public string MaskTarget(string target)
    {
        if (string.IsNullOrWhiteSpace(target))
            return string.Empty;

        var trimmed = target.Trim();

        if (trimmed.Contains('@'))
        {
            var parts = trimmed.Split('@');
            var name = parts[0];
            var domain = parts[1];

            if (name.Length <= 2)
            {
                return $"{name[0]}***@{domain}";
            }

            return $"{name[0]}***{name[^1]}@{domain}";
        }

        // Egyptian phone number: +201012345678 -> +2010****5678
        var normalized = EgyptianPhoneNormalizer.Normalize(trimmed);
        if (normalized.Length == 13) // +20 + 10 digits
        {
            return $"{normalized[..5]}****{normalized[^4..]}";
        }

        if (normalized.Length > 6)
        {
            return $"{normalized[..3]}****{normalized[^3..]}";
        }

        return normalized;
    }

    private void EnforceIpRateLimit(string ip)
    {
        var now = DateTime.UtcNow;
        var queue = IpRequestLog.GetOrAdd(ip, _ => new ConcurrentQueue<DateTime>());

        // Clean timestamps older than 1 hour
        while (queue.TryPeek(out var oldest) && (now - oldest).TotalHours >= 1)
        {
            queue.TryDequeue(out _);
        }

        if (queue.Count >= 20)
        {
            throw new TooManyRequestsException("تم تجاوز الحد الأقصى للطلبات من هذا العنوان (20 في الساعة).");
        }

        queue.Enqueue(now);
    }

    private string GetServerSecret()
    {
        var secret = _configuration["Auth:CodeSecret"]
            ?? _configuration["AUTH_CODE_SECRET"];

        if (string.IsNullOrWhiteSpace(secret))
        {
            throw new InvalidOperationException("Auth:CodeSecret is missing. A dedicated HMAC secret is required.");
        }

        return secret;
    }

    public static string ComputeHmacSha256(string code, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(code));
        return Convert.ToHexString(hash);
    }
}
