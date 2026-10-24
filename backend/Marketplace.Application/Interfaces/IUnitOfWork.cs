using Marketplace.Domain.Entities;

namespace Marketplace.Application.Interfaces;

public interface IUnitOfWork : IDisposable
{
    IRepository<User> Users { get; }
    IRepository<SellerProfile> SellerProfiles { get; }
    IRepository<UserAddress> UserAddresses { get; }
    IRepository<Product> Products { get; }
    IRepository<Category> Categories { get; }
    IRepository<Order> Orders { get; }
    IRepository<Shipment> Shipments { get; }
    IRepository<OrderItem> OrderItems { get; }
    IRepository<UserConsent> UserConsents { get; }
    IRepository<VendorWallet> VendorWallets { get; }
    IRepository<WalletTransaction> WalletTransactions { get; }
    IRepository<PayoutRequest> PayoutRequests { get; }
    IRepository<Review> Reviews { get; }
    IRepository<UserDeviceToken> UserDeviceTokens { get; }
    IRepository<ProductVariant> ProductVariants { get; }
    IRepository<Coupon> Coupons { get; }
    IRepository<CouponUsage> CouponUsages { get; }
    IRepository<ReturnRequest> ReturnRequests { get; }
    IRepository<BuyerWallet> BuyerWallets { get; }
    IRepository<BuyerWalletTransaction> BuyerWalletTransactions { get; }
    IRepository<VerificationCode> VerificationCodes { get; }
    IRepository<RefreshToken> RefreshTokens { get; }

    Task<int> SaveChangesAsync();
    Task BeginTransactionAsync();
    Task CommitTransactionAsync();
    Task RollbackTransactionAsync();
    Task<int> ExecuteSqlRawAsync(string sql, params object[] parameters);
}
