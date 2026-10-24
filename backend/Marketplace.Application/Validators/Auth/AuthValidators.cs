using FluentValidation;
using Marketplace.Application.DTOs.Auth;
using Marketplace.Application.Validators.Users;
using Marketplace.Domain.Enums;

namespace Marketplace.Application.Validators.Auth;

public class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty()
            .MaximumLength(100);

        RuleFor(x => x)
            .Must(x => !string.IsNullOrWhiteSpace(x.Email) || !string.IsNullOrWhiteSpace(x.Phone))
            .WithMessage("Either email or phone is required.");

        RuleFor(x => x.Email)
            .EmailAddress()
            .MaximumLength(200)
            .When(x => !string.IsNullOrWhiteSpace(x.Email));

        RuleFor(x => x.Phone)
            .Matches(EgyptianPhoneValidation.PhoneRegex)
            .WithMessage("Phone must be a valid Egyptian mobile number (e.g. 01012345678 or +201012345678).")
            .When(x => !string.IsNullOrWhiteSpace(x.Phone));

        RuleFor(x => x.Password)
            .NotEmpty()
            .MinimumLength(6)
            .MaximumLength(100);

        RuleFor(x => x.Role)
            .NotEmpty()
            .Must(r => string.Equals(r, nameof(UserRole.Buyer), StringComparison.OrdinalIgnoreCase) ||
                       string.Equals(r, nameof(UserRole.Seller), StringComparison.OrdinalIgnoreCase))
            .WithMessage("Role must be either 'Buyer' or 'Seller'. Admin role is forbidden.");

        RuleFor(x => x.AcceptedTermsAndPrivacy)
            .Equal(true)
            .WithMessage("الموافقة الصريحة على الشروط وسياسة الخصوصية مطلوبة للتسجيل (وفقاً للقانون المصري رقم 151 لسنة 2020 لحماية البيانات الشخصية).");
    }
}

public class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x)
            .Must(x => !string.IsNullOrWhiteSpace(x.GetEffectiveIdentifier()))
            .WithMessage("Email or phone identifier is required.");

        RuleFor(x => x.Password)
            .NotEmpty()
            .WithMessage("Password is required.");
    }
}

public class VerifyRequestValidator : AbstractValidator<VerifyRequest>
{
    public VerifyRequestValidator()
    {
        RuleFor(x => x.Target)
            .NotEmpty()
            .WithMessage("Target (email or phone) is required.");

        RuleFor(x => x.Code)
            .NotEmpty()
            .Length(6)
            .Matches(@"^\d{6}$")
            .WithMessage("Verification code must be exactly 6 digits.");
    }
}

public class ResendCodeRequestValidator : AbstractValidator<ResendCodeRequest>
{
    public ResendCodeRequestValidator()
    {
        RuleFor(x => x.Target)
            .NotEmpty()
            .WithMessage("Target (email or phone) is required.");
    }
}

public class ForgotPasswordRequestValidator : AbstractValidator<ForgotPasswordRequest>
{
    public ForgotPasswordRequestValidator()
    {
        RuleFor(x => x.Identifier)
            .NotEmpty()
            .WithMessage("Identifier (email or phone) is required.");
    }
}

public class ResetPasswordRequestValidator : AbstractValidator<ResetPasswordRequest>
{
    public ResetPasswordRequestValidator()
    {
        RuleFor(x => x.Identifier)
            .NotEmpty()
            .WithMessage("Identifier (email or phone) is required.");

        RuleFor(x => x.Code)
            .NotEmpty()
            .Length(6)
            .Matches(@"^\d{6}$")
            .WithMessage("Verification code must be exactly 6 digits.");

        RuleFor(x => x.NewPassword)
            .NotEmpty()
            .MinimumLength(6)
            .MaximumLength(100)
            .WithMessage("New password must be at least 6 characters long.");
    }
}

public class GoogleAuthRequestValidator : AbstractValidator<GoogleAuthRequest>
{
    public GoogleAuthRequestValidator()
    {
        RuleFor(x => x.IdToken)
            .NotEmpty()
            .WithMessage("Google ID Token is required.");

        RuleFor(x => x.Role)
            .Must(r => string.IsNullOrEmpty(r) ||
                       string.Equals(r, nameof(UserRole.Buyer), StringComparison.OrdinalIgnoreCase) ||
                       string.Equals(r, nameof(UserRole.Seller), StringComparison.OrdinalIgnoreCase))
            .WithMessage("Role must be either 'Buyer' or 'Seller'.");
    }
}

public class RefreshTokenRequestValidator : AbstractValidator<RefreshTokenRequest>
{
    public RefreshTokenRequestValidator()
    {
        RuleFor(x => x.RefreshToken)
            .NotEmpty()
            .WithMessage("Refresh token is required.");

        RuleFor(x => x.DeviceId)
            .NotEmpty()
            .WithMessage("Device ID is required.");
    }
}
