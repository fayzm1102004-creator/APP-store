using Marketplace.Application.DTOs.Auth;

namespace Marketplace.Application.Interfaces;

public interface IAuthService
{
    Task<RegisterResponse> RegisterAsync(RegisterRequest request, string? clientIp = null, CancellationToken cancellationToken = default);
    Task<AuthResponse> VerifyAsync(VerifyRequest request, CancellationToken cancellationToken = default);
    Task ResendCodeAsync(ResendCodeRequest request, string? clientIp = null, CancellationToken cancellationToken = default);
    Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);
    Task ForgotPasswordAsync(ForgotPasswordRequest request, string? clientIp = null, CancellationToken cancellationToken = default);
    Task ResetPasswordAsync(ResetPasswordRequest request, CancellationToken cancellationToken = default);
    Task<AuthResponse> GoogleAuthAsync(GoogleAuthRequest request, CancellationToken cancellationToken = default);
    Task<AuthResponse> RefreshTokenAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
    Task LogoutAsync(LogoutRequest request, CancellationToken cancellationToken = default);
    Task LogoutAllAsync(int userId, CancellationToken cancellationToken = default);
}
