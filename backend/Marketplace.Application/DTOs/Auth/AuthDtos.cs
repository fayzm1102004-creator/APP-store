namespace Marketplace.Application.DTOs.Auth;

public class RegisterRequest
{
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string Password { get; set; } = string.Empty;
    /// <summary>"Buyer" or "Seller" ONLY. Admin cannot be registered here.</summary>
    public string Role { get; set; } = "Buyer";

    /// <summary>
    /// Explicit user consent to Terms & Conditions and Privacy Policy under Egyptian Law (PDPL 151/2020).
    /// Mandatory at registration.
    /// </summary>
    public bool AcceptedTermsAndPrivacy { get; set; }

    /// <summary>
    /// Optional marketing communication consent.
    /// </summary>
    public bool MarketingConsent { get; set; }

    /// <summary>
    /// Document version of privacy policy agreed to (defaults to "1.0").
    /// </summary>
    public string? PolicyVersion { get; set; } = "1.0";
}

public class RegisterResponse
{
    public string Message { get; set; } = "Verification code sent.";
    public string Target { get; set; } = string.Empty;
}

public class VerifyRequest
{
    public string Target { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string? DeviceId { get; set; }
    public string? DeviceName { get; set; }
}

public class ResendCodeRequest
{
    public string Target { get; set; } = string.Empty;
}

public class LoginRequest
{
    public string? Identifier { get; set; }
    public string? Email { get; set; }
    public string Password { get; set; } = string.Empty;
    public string? DeviceId { get; set; }
    public string? DeviceName { get; set; }

    public string GetEffectiveIdentifier()
    {
        if (!string.IsNullOrWhiteSpace(Identifier))
            return Identifier.Trim();
        if (!string.IsNullOrWhiteSpace(Email))
            return Email.Trim();
        return string.Empty;
    }
}

public class ForgotPasswordRequest
{
    public string Identifier { get; set; } = string.Empty;
}

public class ResetPasswordRequest
{
    public string Identifier { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string NewPassword { get; set; } = string.Empty;
}

public class RefreshTokenRequest
{
    public string RefreshToken { get; set; } = string.Empty;
    public string DeviceId { get; set; } = string.Empty;
    public string? DeviceName { get; set; }
}

public class LogoutRequest
{
    public string? RefreshToken { get; set; }
}

public class ConfigResponse
{
    public bool PhoneSignupEnabled { get; set; }
    public bool GoogleEnabled { get; set; }
    public bool VerificationRequired { get; set; }
}

public class AuthResponse
{
    public string AccessToken { get; set; } = string.Empty;
    public string Token { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
    public int ExpiresIn { get; set; } = 3600;
    public DateTime ExpiresAt { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string Role { get; set; } = string.Empty;
}

public class GoogleAuthRequest
{
    /// <summary>
    /// Google ID token (JWT) from Google OAuth / Sign-In.
    /// </summary>
    public string IdToken { get; set; } = string.Empty;

    /// <summary>
    /// Account role if user is new ("Buyer" or "Seller"). Defaults to "Buyer".
    /// </summary>
    public string Role { get; set; } = "Buyer";

    /// <summary>
    /// Explicit user consent to Terms & Conditions and Privacy Policy under Egyptian Law (PDPL 151/2020).
    /// Mandatory when registering for the first time.
    /// </summary>
    public bool AcceptedTermsAndPrivacy { get; set; }

    /// <summary>
    /// Optional marketing communication consent.
    /// </summary>
    public bool MarketingConsent { get; set; }

    /// <summary>
    /// Privacy policy document version.
    /// </summary>
    public string? PolicyVersion { get; set; } = "1.0";

    public string? DeviceId { get; set; }
    public string? DeviceName { get; set; }
}
