using Marketplace.Domain.Enums;

namespace Marketplace.Domain.Entities;

public class VerificationCode
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    public VerificationChannel Channel { get; set; }
    public string Target { get; set; } = string.Empty;
    public VerificationPurpose Purpose { get; set; }
    public string CodeHash { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public int AttemptCount { get; set; } = 0;
    public DateTime? ConsumedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
