using System.Security.Claims;
using System.Text;
using Marketplace.Application.Interfaces;
using Marketplace.Domain.Entities;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Marketplace.Infrastructure.Auth;

public class JwtService : IJwtService
{
    /// <summary>Short claim names used in the token — easy for the mobile app to read after decoding.</summary>
    public static class ClaimNames
    {
        public const string UserId = JwtRegisteredClaimNames.Sub;
        public const string Email = JwtRegisteredClaimNames.Email;
        public const string Name = "name";
        public const string Role = "role";
        public const string TokenVersion = "token_version";
        public const string Phone = "phone_number";
    }

    private readonly JwtSettings _settings;

    public JwtService(IOptions<JwtSettings> settings)
    {
        _settings = settings.Value;
    }

    public JwtToken GenerateToken(User user)
    {
        var minutes = _settings.ExpiryMinutes > 0 ? _settings.ExpiryMinutes : 60;
        var expiresAt = DateTime.UtcNow.AddMinutes(minutes);
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_settings.Key));

        var claims = new List<Claim>
        {
            new(ClaimNames.UserId, user.Id.ToString()),
            new(ClaimNames.Name, user.Name ?? string.Empty),
            new(ClaimNames.Role, user.Role.ToString()),
            new(ClaimNames.TokenVersion, user.TokenVersion.ToString())
        };

        if (!string.IsNullOrEmpty(user.Email))
        {
            claims.Add(new Claim(ClaimNames.Email, user.Email));
        }

        if (!string.IsNullOrEmpty(user.Phone))
        {
            claims.Add(new Claim(ClaimNames.Phone, user.Phone));
        }

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = _settings.Issuer,
            Audience = _settings.Audience,
            Expires = expiresAt,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
            Subject = new ClaimsIdentity(claims)
        };

        var token = new JsonWebTokenHandler().CreateToken(descriptor);
        return new JwtToken(token, expiresAt);
    }
}
