using Google.Apis.Auth;
using Marketplace.Application.DTOs.Auth;
using Marketplace.Application.Exceptions;
using Marketplace.Application.Interfaces;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Marketplace.Infrastructure.Auth;

public class GoogleTokenValidator : IGoogleTokenValidator
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<GoogleTokenValidator> _logger;

    public GoogleTokenValidator(IConfiguration configuration, ILogger<GoogleTokenValidator> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<GoogleUserInfo> ValidateTokenAsync(string idToken, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(idToken))
        {
            throw new BadRequestException("Google ID Token is empty or missing.");
        }

        try
        {
            var settings = new GoogleJsonWebSignature.ValidationSettings();

            var clientIds = new List<string>();
            var configuredArray = _configuration.GetSection("Google:ClientIds").Get<string[]>()
                ?? _configuration.GetSection("Auth:GoogleClientIds").Get<string[]>();
            if (configuredArray != null)
            {
                clientIds.AddRange(configuredArray.Where(c => !string.IsNullOrWhiteSpace(c)));
            }

            foreach (var key in new[] { "Google:ClientId", "Authentication:Google:ClientId", "Auth:GoogleClientId" })
            {
                var val = _configuration[key];
                if (!string.IsNullOrWhiteSpace(val) && !clientIds.Contains(val))
                {
                    clientIds.Add(val);
                }
            }

            if (clientIds.Count > 0)
            {
                settings.Audience = clientIds;
            }

            var payload = await GoogleJsonWebSignature.ValidateAsync(idToken, settings);

            if (payload is null || string.IsNullOrWhiteSpace(payload.Email))
            {
                throw new UnauthorizedException("Google authentication failed: token did not contain a valid email.");
            }

            if (!payload.EmailVerified)
            {
                throw new UnauthorizedException("Google authentication failed: account email is not verified.");
            }

            if (clientIds.Count > 0 && (payload.Audience == null || !clientIds.Contains(payload.Audience.ToString() ?? string.Empty)))
            {
                throw new UnauthorizedException("Google authentication failed: token audience does not match configured client IDs.");
            }

            return new GoogleUserInfo
            {
                GoogleId = payload.Subject,
                Email = payload.Email,
                Name = payload.Name ?? string.Empty,
                PictureUrl = payload.Picture,
                EmailVerified = payload.EmailVerified
            };
        }
        catch (InvalidJwtException)
        {
            _logger.LogWarning("Invalid or expired Google JWT token.");
            throw new UnauthorizedException("Invalid or expired Google token.");
        }
        catch (Exception ex) when (ex is not AppException)
        {
            _logger.LogError("Unexpected error occurred while validating Google token.");
            throw new UnauthorizedException("Failed to verify Google token with provider.");
        }
    }
}
