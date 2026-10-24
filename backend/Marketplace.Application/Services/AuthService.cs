using System.Security.Cryptography;
using System.Text;
using Marketplace.Application.Common;
using Marketplace.Application.DTOs.Auth;
using Marketplace.Application.Exceptions;
using Marketplace.Application.Interfaces;
using Marketplace.Application.Validators.Users;
using Marketplace.Domain.Entities;
using Marketplace.Domain.Enums;
using Microsoft.Extensions.Configuration;

namespace Marketplace.Application.Services;

public class AuthService : IAuthService
{
    private readonly IUnitOfWork _uow;
    private readonly IPasswordHasher _hasher;
    private readonly IJwtService _jwt;
    private readonly IGoogleTokenValidator _googleValidator;
    private readonly IVerificationService _verificationService;
    private readonly IConfiguration _configuration;

    public AuthService(
        IUnitOfWork uow,
        IPasswordHasher hasher,
        IJwtService jwt,
        IGoogleTokenValidator googleValidator,
        IVerificationService verificationService,
        IConfiguration configuration)
    {
        _uow = uow;
        _hasher = hasher;
        _jwt = jwt;
        _googleValidator = googleValidator;
        _verificationService = verificationService;
        _configuration = configuration;
    }

    public async Task<RegisterResponse> RegisterAsync(RegisterRequest request, string? clientIp = null, CancellationToken cancellationToken = default)
    {
        // 1. Role must be Buyer or Seller only (never Admin)
        if (string.Equals(request.Role, nameof(UserRole.Admin), StringComparison.OrdinalIgnoreCase))
        {
            throw new BadRequestException("Admin accounts cannot be registered via public registration.");
        }

        if (!Enum.TryParse<UserRole>(request.Role, ignoreCase: true, out var role) || role == UserRole.Admin)
        {
            throw new BadRequestException("Role must be either 'Buyer' or 'Seller'.");
        }

        // 2. Must provide email OR phone
        var hasEmail = !string.IsNullOrWhiteSpace(request.Email);
        var hasPhone = !string.IsNullOrWhiteSpace(request.Phone);

        if (!hasEmail && !hasPhone)
        {
            throw new BadRequestException("At least one contact identifier (email or phone) is required.");
        }

        // 3. If phone is provided, check if phone signup is enabled
        var phoneSignupEnabled = _configuration.GetValue<bool>("Auth:PhoneSignupEnabled", false);
        string? normalizedPhone = null;

        if (hasPhone)
        {
            if (!phoneSignupEnabled)
            {
                throw new NotFoundException("Phone registration is currently disabled.");
            }

            if (!EgyptianPhoneValidation.PhoneRegex.IsMatch(request.Phone!.Trim()))
            {
                throw new BadRequestException("Phone must be a valid Egyptian mobile number (e.g. 01012345678 or +201012345678).");
            }

            normalizedPhone = EgyptianPhoneNormalizer.Normalize(request.Phone);
        }

        string? normalizedEmail = null;
        if (hasEmail)
        {
            normalizedEmail = NormalizeEmail(request.Email!);
        }

        // 4. Check for existing users
        User? existingUser = null;
        if (normalizedEmail != null)
        {
            existingUser = (await _uow.Users.FindAsync(u => u.Email == normalizedEmail)).FirstOrDefault();
        }

        if (existingUser == null && normalizedPhone != null)
        {
            existingUser = (await _uow.Users.FindAsync(u => u.Phone == normalizedPhone)).FirstOrDefault();
        }

        User user;

        if (existingUser != null)
        {
            // If already verified, reject with 409 Conflict
            var isVerified = existingUser.EmailVerifiedAt != null || existingUser.PhoneVerifiedAt != null;
            if (isVerified)
            {
                throw new ConflictException("A verified user with this email or phone already exists.");
            }

            // Unverified user: Overwrite it!
            user = existingUser;
            user.Name = request.Name.Trim();
            user.PasswordHash = _hasher.Hash(request.Password);
            user.Role = role;
            user.CreatedAt = DateTime.UtcNow;
            if (normalizedEmail != null) user.Email = normalizedEmail;
            if (normalizedPhone != null) user.Phone = normalizedPhone;

            try
            {
                await _uow.SaveChangesAsync();
            }
            catch (Exception ex) when (ex.GetType().Name == "DbUpdateException")
            {
                throw new ConflictException("A user with this email or phone is already registered.");
            }
        }
        else
        {
            // Create new unverified user
            user = new User
            {
                Name = request.Name.Trim(),
                Email = normalizedEmail,
                Phone = normalizedPhone,
                PasswordHash = _hasher.Hash(request.Password),
                Role = role,
                IsActive = true,
                EmailVerifiedAt = null,
                PhoneVerifiedAt = null,
                TokenVersion = 0,
                CreatedAt = DateTime.UtcNow
            };

            try
            {
                await _uow.Users.AddAsync(user);
                await _uow.SaveChangesAsync();
            }
            catch (Exception ex) when (ex.GetType().Name == "DbUpdateException")
            {
                throw new ConflictException("A user with this email or phone is already registered.");
            }

            var consent = new UserConsent
            {
                UserId = user.Id,
                PolicyVersion = string.IsNullOrWhiteSpace(request.PolicyVersion) ? "1.0" : request.PolicyVersion.Trim(),
                AcceptedAt = DateTime.UtcNow,
                MarketingConsent = request.MarketingConsent
            };
            await _uow.UserConsents.AddAsync(consent);
            await _uow.SaveChangesAsync();
        }

        // 5. Send verification code
        // Target priority: phone if phone provided and phone signup, otherwise email
        string target;
        VerificationChannel channel;

        if (normalizedPhone != null && !hasEmail)
        {
            target = normalizedPhone;
            channel = VerificationChannel.Phone;
        }
        else if (normalizedEmail != null)
        {
            target = normalizedEmail;
            channel = VerificationChannel.Email;
        }
        else
        {
            target = normalizedPhone!;
            channel = VerificationChannel.Phone;
        }

        var maskedTarget = await _verificationService.GenerateAndSendCodeAsync(
            user,
            target,
            channel,
            VerificationPurpose.Verify,
            clientIp,
            cancellationToken);

        return new RegisterResponse
        {
            Message = "Verification code sent successfully.",
            Target = maskedTarget
        };
    }

    public async Task<AuthResponse> VerifyAsync(VerifyRequest request, CancellationToken cancellationToken = default)
    {
        var codeRecord = await _verificationService.ValidateAndConsumeCodeAsync(
            request.Target,
            request.Code,
            VerificationPurpose.Verify,
            cancellationToken);

        var user = await _uow.Users.GetByIdAsync(codeRecord.UserId);
        if (user == null)
        {
            throw new NotFoundException("User not found.");
        }

        if (codeRecord.Channel == VerificationChannel.Email)
        {
            user.EmailVerifiedAt = DateTime.UtcNow;
        }
        else
        {
            user.PhoneVerifiedAt = DateTime.UtcNow;
        }

        await _uow.SaveChangesAsync();

        return await BuildResponseAsync(user, request.DeviceId, request.DeviceName, cancellationToken);
    }

    public async Task ResendCodeAsync(ResendCodeRequest request, string? clientIp = null, CancellationToken cancellationToken = default)
    {
        var normalizedTarget = _verificationService.NormalizeTarget(request.Target, out var channel);

        // Find user
        User? user = null;
        if (channel == VerificationChannel.Email)
        {
            user = (await _uow.Users.FindAsync(u => u.Email == normalizedTarget)).FirstOrDefault();
        }
        else
        {
            user = (await _uow.Users.FindAsync(u => u.Phone == normalizedTarget)).FirstOrDefault();
        }

        // Always generic 202: only send if user exists and is unverified
        if (user != null)
        {
            var isVerified = (channel == VerificationChannel.Email && user.EmailVerifiedAt != null) ||
                             (channel == VerificationChannel.Phone && user.PhoneVerifiedAt != null);

            if (!isVerified)
            {
                await _verificationService.GenerateAndSendCodeAsync(
                    user,
                    normalizedTarget,
                    channel,
                    VerificationPurpose.Verify,
                    clientIp,
                    cancellationToken);
            }
        }
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        var rawIdentifier = request.GetEffectiveIdentifier();
        if (string.IsNullOrWhiteSpace(rawIdentifier))
        {
            throw new UnauthorizedException("Invalid email/phone or password.");
        }

        User? user = null;

        if (rawIdentifier.Contains('@'))
        {
            var email = NormalizeEmail(rawIdentifier);
            user = (await _uow.Users.FindAsync(u => u.Email == email)).FirstOrDefault();
        }
        else if (EgyptianPhoneValidation.PhoneRegex.IsMatch(rawIdentifier.Trim()))
        {
            var phone = EgyptianPhoneNormalizer.Normalize(rawIdentifier);
            user = (await _uow.Users.FindAsync(u => u.Phone == phone)).FirstOrDefault();
        }
        else
        {
            var email = NormalizeEmail(rawIdentifier);
            user = (await _uow.Users.FindAsync(u => u.Email == email)).FirstOrDefault();
        }

        if (user == null || !_hasher.Verify(request.Password, user.PasswordHash))
        {
            throw new UnauthorizedException("Invalid email or password.");
        }

        var isLegacyDeletedEmail = user.Email != null && user.Email.StartsWith("deleted_", StringComparison.OrdinalIgnoreCase);
        if (!user.IsActive || isLegacyDeletedEmail)
        {
            throw new UnauthorizedException("Invalid email or password.");
        }

        // Verification check
        var requireVerification = _configuration.GetValue<bool>("Auth:RequireVerification", true);
        if (requireVerification)
        {
            var isVerified = user.EmailVerifiedAt != null || user.PhoneVerifiedAt != null;
            if (!isVerified)
            {
                var target = user.Email ?? user.Phone ?? rawIdentifier;
                var masked = _verificationService.MaskTarget(target);
                throw new NotVerifiedException(masked, "الحساب غير مؤكد. يرجى تأكيد البريد الإلكتروني أو رقم الهاتف.");
            }
        }

        return await BuildResponseAsync(user, request.DeviceId, request.DeviceName, cancellationToken);
    }

    public async Task ForgotPasswordAsync(ForgotPasswordRequest request, string? clientIp = null, CancellationToken cancellationToken = default)
    {
        var rawIdentifier = request.Identifier.Trim();
        if (string.IsNullOrWhiteSpace(rawIdentifier))
            return;

        var normalizedTarget = _verificationService.NormalizeTarget(rawIdentifier, out var channel);

        User? user = null;
        if (channel == VerificationChannel.Email)
        {
            user = (await _uow.Users.FindAsync(u => u.Email == normalizedTarget)).FirstOrDefault();
        }
        else
        {
            user = (await _uow.Users.FindAsync(u => u.Phone == normalizedTarget)).FirstOrDefault();
        }

        // Always generic 202: only generate code if user exists and is active
        if (user != null && user.IsActive)
        {
            await _verificationService.GenerateAndSendCodeAsync(
                user,
                normalizedTarget,
                channel,
                VerificationPurpose.ResetPassword,
                clientIp,
                cancellationToken);
        }
    }

    public async Task ResetPasswordAsync(ResetPasswordRequest request, CancellationToken cancellationToken = default)
    {
        var codeRecord = await _verificationService.ValidateAndConsumeCodeAsync(
            request.Identifier,
            request.Code,
            VerificationPurpose.ResetPassword,
            cancellationToken);

        var user = await _uow.Users.GetByIdAsync(codeRecord.UserId);
        if (user == null)
        {
            throw new NotFoundException("User not found.");
        }

        user.PasswordHash = _hasher.Hash(request.NewPassword);
        user.TokenVersion++; // Invalidate existing JWT tokens!
        _uow.Users.Update(user);

        var userTokens = await _uow.RefreshTokens.FindAsync(r => r.UserId == user.Id && r.RevokedAt == null);
        foreach (var t in userTokens)
        {
            t.RevokedAt = DateTime.UtcNow;
            _uow.RefreshTokens.Update(t);
        }

        await _uow.SaveChangesAsync();
    }

    public async Task<AuthResponse> GoogleAuthAsync(GoogleAuthRequest request, CancellationToken cancellationToken = default)
    {
        var googleUser = await _googleValidator.ValidateTokenAsync(request.IdToken, cancellationToken);
        var email = NormalizeEmail(googleUser.Email);

        var existing = await _uow.Users.FindAsync(u => u.Email == email);
        var user = existing.FirstOrDefault();

        if (user is not null)
        {
            if (!user.IsActive)
                throw new ForbiddenException("This account has been deactivated by an administrator.");

            return await BuildResponseAsync(user, request.DeviceId, request.DeviceName, cancellationToken);
        }

        // New registration through Google OAuth
        if (!request.AcceptedTermsAndPrivacy)
        {
            throw new BadRequestException("الموافقة الصريحة على الشروط وسياسة الخصوصية مطلوبة لإنشاء حساب (وفقاً للقانون المصري رقم 151 لسنة 2020 لحماية البيانات الشخصية).");
        }

        var roleStr = string.IsNullOrWhiteSpace(request.Role) ? "Buyer" : request.Role;
        if (!Enum.TryParse<UserRole>(roleStr, ignoreCase: true, out var role) || role == UserRole.Admin)
        {
            role = UserRole.Buyer;
        }

        var userName = string.IsNullOrWhiteSpace(googleUser.Name)
            ? email.Split('@')[0]
            : googleUser.Name.Trim();

        user = new User
        {
            Name = userName,
            Email = email,
            PasswordHash = _hasher.Hash(Guid.NewGuid().ToString("N")),
            Role = role,
            EmailVerifiedAt = DateTime.UtcNow, // Google verifies email
            TokenVersion = 0,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        await _uow.Users.AddAsync(user);
        await _uow.SaveChangesAsync();

        var consent = new UserConsent
        {
            UserId = user.Id,
            PolicyVersion = string.IsNullOrWhiteSpace(request.PolicyVersion) ? "1.0" : request.PolicyVersion.Trim(),
            AcceptedAt = DateTime.UtcNow,
            MarketingConsent = request.MarketingConsent
        };
        await _uow.UserConsents.AddAsync(consent);
        await _uow.SaveChangesAsync();

        return await BuildResponseAsync(user, request.DeviceId, request.DeviceName, cancellationToken);
    }

    public async Task<AuthResponse> RefreshTokenAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken) || string.IsNullOrWhiteSpace(request.DeviceId))
        {
            throw new UnauthorizedException("Refresh token and device ID are required.");
        }

        var hash = HashRefreshToken(request.RefreshToken.Trim());
        var tokenRecord = (await _uow.RefreshTokens.FindAsync(r => r.TokenHash == hash)).FirstOrDefault();

        if (tokenRecord == null)
        {
            throw new UnauthorizedException("Invalid refresh token.");
        }

        // Reuse detection with Grace Window (default 20s):
        // Accepts the immediately previous refresh token once, so a crash between rotation
        // and storage does not log the user out; reuse beyond the window or repeat reuse still revokes the family.
        var graceWindowSeconds = _configuration.GetValue<int>("Auth:RefreshTokenGraceWindowSeconds", 20);
        bool handledInGrace = false;

        if (tokenRecord.RevokedAt != null)
        {
            if (tokenRecord.ReplacedByTokenId != null &&
                tokenRecord.RevokedAt.HasValue &&
                (DateTime.UtcNow - tokenRecord.RevokedAt.Value).TotalSeconds <= graceWindowSeconds &&
                string.Equals(tokenRecord.DeviceId, request.DeviceId.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                // Verify the replacement token exists and has NOT yet been used/revoked
                var replacementToken = await _uow.RefreshTokens.GetByIdAsync(tokenRecord.ReplacedByTokenId.Value);
                if (replacementToken != null && replacementToken.RevokedAt == null)
                {
                    handledInGrace = true;
                    // Revoke the unreceived replacement token
                    replacementToken.RevokedAt = DateTime.UtcNow;
                    _uow.RefreshTokens.Update(replacementToken);

                    // Invalidate grace eligibility for this token so it cannot be used a second time
                    tokenRecord.RevokedAt = DateTime.UtcNow.AddSeconds(-graceWindowSeconds - 10);
                    _uow.RefreshTokens.Update(tokenRecord);
                    await _uow.SaveChangesAsync();
                }
            }

            if (!handledInGrace)
            {
                var familyTokens = await _uow.RefreshTokens.FindAsync(r => r.UserId == tokenRecord.UserId && r.DeviceId == tokenRecord.DeviceId && r.RevokedAt == null);
                foreach (var t in familyTokens)
                {
                    t.RevokedAt = DateTime.UtcNow;
                    _uow.RefreshTokens.Update(t);
                }
                await _uow.SaveChangesAsync();
                throw new UnauthorizedException("Revoked refresh token reuse detected. All sessions for this device have been revoked.");
            }
        }

        // Expired check
        if (tokenRecord.ExpiresAt <= DateTime.UtcNow)
        {
            tokenRecord.RevokedAt = DateTime.UtcNow;
            _uow.RefreshTokens.Update(tokenRecord);
            await _uow.SaveChangesAsync();
            throw new UnauthorizedException("Refresh token has expired.");
        }

        // Wrong deviceId check
        if (!string.Equals(tokenRecord.DeviceId, request.DeviceId.Trim(), StringComparison.OrdinalIgnoreCase))
        {
            throw new UnauthorizedException("Device ID mismatch.");
        }

        var user = await _uow.Users.GetByIdAsync(tokenRecord.UserId);
        if (user == null || !user.IsActive)
        {
            throw new UnauthorizedException("User account is inactive or not found.");
        }

        // Rotation: issue new token, revoke old token, link ReplacedByTokenId
        var (newRawToken, newTokenEntity) = await IssueRefreshTokenAsync(
            user.Id,
            tokenRecord.DeviceId,
            request.DeviceName ?? tokenRecord.DeviceName,
            cancellationToken: cancellationToken);

        tokenRecord.RevokedAt = handledInGrace ? DateTime.UtcNow.AddSeconds(-graceWindowSeconds - 10) : DateTime.UtcNow;
        tokenRecord.LastUsedAt = DateTime.UtcNow;
        tokenRecord.ReplacedByTokenId = newTokenEntity.Id;
        _uow.RefreshTokens.Update(tokenRecord);
        await _uow.SaveChangesAsync();

        var jwt = _jwt.GenerateToken(user);
        var expiresInSeconds = (int)Math.Max(0, (jwt.ExpiresAt - DateTime.UtcNow).TotalSeconds);

        return new AuthResponse
        {
            AccessToken = jwt.Token,
            Token = jwt.Token,
            RefreshToken = newRawToken,
            ExpiresIn = expiresInSeconds,
            ExpiresAt = jwt.ExpiresAt,
            UserId = user.Id,
            Name = user.Name,
            Email = user.Email,
            Phone = user.Phone,
            Role = user.Role.ToString()
        };
    }

    public async Task LogoutAsync(LogoutRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken))
            return;

        var hash = HashRefreshToken(request.RefreshToken.Trim());
        var tokenRecord = (await _uow.RefreshTokens.FindAsync(r => r.TokenHash == hash)).FirstOrDefault();

        if (tokenRecord != null && tokenRecord.RevokedAt == null)
        {
            tokenRecord.RevokedAt = DateTime.UtcNow;
            _uow.RefreshTokens.Update(tokenRecord);
            await _uow.SaveChangesAsync();
        }
    }

    public async Task LogoutAllAsync(int userId, CancellationToken cancellationToken = default)
    {
        var user = await _uow.Users.GetByIdAsync(userId);
        if (user == null)
            throw new NotFoundException("User not found.");

        user.TokenVersion++;
        _uow.Users.Update(user);

        var userTokens = await _uow.RefreshTokens.FindAsync(r => r.UserId == userId && r.RevokedAt == null);
        foreach (var t in userTokens)
        {
            t.RevokedAt = DateTime.UtcNow;
            _uow.RefreshTokens.Update(t);
        }

        await _uow.SaveChangesAsync();
    }

    private static string GenerateRawRefreshToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes).Replace("+", "-").Replace("/", "_").TrimEnd('=');
    }

    private static string HashRefreshToken(string rawToken)
    {
        var hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken));
        return Convert.ToHexString(hashBytes).ToLowerInvariant();
    }

    private async Task<(string rawToken, RefreshToken entity)> IssueRefreshTokenAsync(
        int userId,
        string? deviceId,
        string? deviceName,
        int? replacedByTokenId = null,
        CancellationToken cancellationToken = default)
    {
        var effectiveDeviceId = string.IsNullOrWhiteSpace(deviceId)
            ? Guid.NewGuid().ToString("D")
            : deviceId.Trim();

        var effectiveDeviceName = !string.IsNullOrWhiteSpace(deviceName)
            ? (deviceName.Trim().Length > 100 ? deviceName.Trim()[..100] : deviceName.Trim())
            : null;

        var lifetimeDays = _configuration.GetValue<int>("Auth:RefreshTokenLifetimeDays", 60);
        if (lifetimeDays <= 0) lifetimeDays = 60;
        var expiresAt = DateTime.UtcNow.AddDays(lifetimeDays);

        var maxDevices = _configuration.GetValue<int>("Auth:MaxActiveDevicesPerUser", 5);
        if (maxDevices <= 0) maxDevices = 5;

        // Enforce max active devices per user
        var activeUserTokens = (await _uow.RefreshTokens.FindAsync(r => r.UserId == userId && r.RevokedAt == null && r.ExpiresAt > DateTime.UtcNow)).ToList();
        var activeDeviceIds = activeUserTokens.Select(r => r.DeviceId).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        if (!activeDeviceIds.Contains(effectiveDeviceId, StringComparer.OrdinalIgnoreCase) && activeDeviceIds.Count >= maxDevices)
        {
            var oldestDevice = activeUserTokens
                .GroupBy(r => r.DeviceId, StringComparer.OrdinalIgnoreCase)
                .OrderBy(g => g.Max(r => r.LastUsedAt ?? r.CreatedAt))
                .FirstOrDefault();

            if (oldestDevice != null)
            {
                foreach (var tok in oldestDevice)
                {
                    tok.RevokedAt = DateTime.UtcNow;
                    _uow.RefreshTokens.Update(tok);
                }
            }
        }

        var rawToken = GenerateRawRefreshToken();
        var tokenHash = HashRefreshToken(rawToken);

        var tokenEntity = new RefreshToken
        {
            UserId = userId,
            TokenHash = tokenHash,
            DeviceId = effectiveDeviceId,
            DeviceName = effectiveDeviceName,
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = expiresAt,
            LastUsedAt = DateTime.UtcNow,
            RevokedAt = null,
            ReplacedByTokenId = replacedByTokenId
        };

        await _uow.RefreshTokens.AddAsync(tokenEntity);
        await _uow.SaveChangesAsync();

        return (rawToken, tokenEntity);
    }

    private async Task<AuthResponse> BuildResponseAsync(User user, string? deviceId = null, string? deviceName = null, CancellationToken cancellationToken = default)
    {
        var jwt = _jwt.GenerateToken(user);
        var (refreshToken, _) = await IssueRefreshTokenAsync(user.Id, deviceId, deviceName, cancellationToken: cancellationToken);
        var expiresInSeconds = (int)Math.Max(0, (jwt.ExpiresAt - DateTime.UtcNow).TotalSeconds);

        return new AuthResponse
        {
            AccessToken = jwt.Token,
            Token = jwt.Token,
            RefreshToken = refreshToken,
            ExpiresIn = expiresInSeconds,
            ExpiresAt = jwt.ExpiresAt,
            UserId = user.Id,
            Name = user.Name,
            Email = user.Email,
            Phone = user.Phone,
            Role = user.Role.ToString()
        };
    }

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
}
