using Marketplace.API.Extensions;
using Marketplace.Application.DTOs.Auth;
using Marketplace.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Marketplace.API.Controllers;

[ApiController]
[Route("api/auth")]
[EnableRateLimiting("auth-policy")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;
    private readonly IConfiguration _configuration;

    public AuthController(IAuthService authService, IConfiguration configuration)
    {
        _authService = authService;
        _configuration = configuration;
    }

    /// <summary>
    /// Register a new Buyer or Seller account with email or phone.
    /// Creates an unverified user, dispatches a verification code, and returns 202 with masked target.
    /// </summary>
    [HttpPost("register")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(RegisterResponse), StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<RegisterResponse>> Register(RegisterRequest request, CancellationToken cancellationToken)
    {
        var clientIp = HttpContext.Connection.RemoteIpAddress?.ToString();
        var response = await _authService.RegisterAsync(request, clientIp, cancellationToken);
        return StatusCode(StatusCodes.Status202Accepted, response);
    }

    /// <summary>
    /// Verify email or phone target with the 6-digit code. Marks verified and returns a JWT.
    /// </summary>
    [HttpPost("verify")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<AuthResponse>> Verify(VerifyRequest request, CancellationToken cancellationToken)
    {
        var response = await _authService.VerifyAsync(request, cancellationToken);
        return Ok(response);
    }

    /// <summary>
    /// Resend verification code. Always returns generic 202.
    /// </summary>
    [HttpPost("resend")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public async Task<IActionResult> Resend(ResendCodeRequest request, CancellationToken cancellationToken)
    {
        var clientIp = HttpContext.Connection.RemoteIpAddress?.ToString();
        await _authService.ResendCodeAsync(request, clientIp, cancellationToken);
        return StatusCode(StatusCodes.Status202Accepted, new
        {
            message = "If an unverified account matches this target, a new verification code has been sent."
        });
    }

    /// <summary>
    /// Log in with email or phone identifier and password. Returns a JWT.
    /// Returns 403 Forbidden with NOT_VERIFIED if unverified.
    /// </summary>
    [HttpPost("login")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request, CancellationToken cancellationToken)
    {
        return Ok(await _authService.LoginAsync(request, cancellationToken));
    }

    /// <summary>
    /// Request password reset code for email or phone. Always returns generic 202.
    /// </summary>
    [HttpPost("forgot-password")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request, CancellationToken cancellationToken)
    {
        var clientIp = HttpContext.Connection.RemoteIpAddress?.ToString();
        await _authService.ForgotPasswordAsync(request, clientIp, cancellationToken);
        return StatusCode(StatusCodes.Status202Accepted, new
        {
            message = "If an account matches this identifier, a password reset code has been sent."
        });
    }

    /// <summary>
    /// Reset password using 6-digit code. Increments TokenVersion to invalidate previous tokens.
    /// </summary>
    [HttpPost("reset-password")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request, CancellationToken cancellationToken)
    {
        await _authService.ResetPasswordAsync(request, cancellationToken);
        return Ok(new
        {
            message = "Password has been reset successfully. Please log in with your new password."
        });
    }

    /// <summary>
    /// Log in or register with Google ID token. Returns a JWT.
    /// </summary>
    [HttpPost("google")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<AuthResponse>> Google([FromBody] GoogleAuthRequest request, CancellationToken cancellationToken)
    {
        var googleEnabled = _configuration.GetValue<bool>("Auth:GoogleEnabled", false);
        if (!googleEnabled)
        {
            return NotFound(new { error = "Google authentication is disabled." });
        }

        return Ok(await _authService.GoogleAuthAsync(request, cancellationToken));
    }

    /// <summary>
    /// Refresh access token using refresh token and device ID. Rotates refresh token.
    /// </summary>
    [HttpPost("refresh")]
    [AllowAnonymous]
    [EnableRateLimiting("refresh-policy")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<AuthResponse>> Refresh([FromBody] RefreshTokenRequest request, CancellationToken cancellationToken)
    {
        var response = await _authService.RefreshTokenAsync(request, cancellationToken);
        return Ok(response);
    }

    /// <summary>
    /// Log out by revoking the specified refresh token.
    /// </summary>
    [HttpPost("logout")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> Logout([FromBody] LogoutRequest request, CancellationToken cancellationToken)
    {
        await _authService.LogoutAsync(request, cancellationToken);
        return Ok(new { message = "Logged out successfully." });
    }

    /// <summary>
    /// Log out from all devices by revoking all refresh tokens and incrementing token version.
    /// </summary>
    [HttpPost("logout-all")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> LogoutAll(CancellationToken cancellationToken)
    {
        var userId = User.GetUserId();
        await _authService.LogoutAllAsync(userId, cancellationToken);
        return Ok(new { message = "Logged out from all devices successfully." });
    }
}
