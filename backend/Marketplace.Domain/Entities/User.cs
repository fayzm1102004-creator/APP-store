using Marketplace.Domain.Enums;

namespace Marketplace.Domain.Entities;

public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public DateTime? EmailVerifiedAt { get; set; }
    public DateTime? PhoneVerifiedAt { get; set; }
    public int TokenVersion { get; set; } = 0;
    public string PasswordHash { get; set; } = string.Empty;
    public UserRole Role { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public SellerProfile? SellerProfile { get; set; }
    public VendorWallet? Wallet { get; set; }
    public ICollection<UserAddress> Addresses { get; set; } = new List<UserAddress>();
    public ICollection<Product> Products { get; set; } = new List<Product>();
    public ICollection<Order> Orders { get; set; } = new List<Order>();
    public ICollection<Shipment> Shipments { get; set; } = new List<Shipment>();
    public ICollection<UserConsent> Consents { get; set; } = new List<UserConsent>();
    public ICollection<PayoutRequest> PayoutRequests { get; set; } = new List<PayoutRequest>();
    public ICollection<Review> Reviews { get; set; } = new List<Review>();
    public ICollection<UserDeviceToken> DeviceTokens { get; set; } = new List<UserDeviceToken>();
    public BuyerWallet? BuyerWallet { get; set; }
    public ICollection<VerificationCode> VerificationCodes { get; set; } = new List<VerificationCode>();
    public ICollection<RefreshToken> RefreshTokens { get; set; } = new List<RefreshToken>();
}
