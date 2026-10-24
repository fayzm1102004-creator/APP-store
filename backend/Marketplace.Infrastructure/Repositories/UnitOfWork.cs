using Marketplace.Application.Interfaces;
using Marketplace.Domain.Entities;
using Marketplace.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Marketplace.Infrastructure.Repositories;

public class UnitOfWork : IUnitOfWork
{
    private readonly AppDbContext _context;
    private IDbContextTransaction? _transaction;

    public UnitOfWork(AppDbContext context)
    {
        _context = context;
        Users = new Repository<User>(context);
        SellerProfiles = new Repository<SellerProfile>(context);
        UserAddresses = new Repository<UserAddress>(context);
        Products = new Repository<Product>(context);
        Categories = new Repository<Category>(context);
        Orders = new Repository<Order>(context);
        Shipments = new Repository<Shipment>(context);
        OrderItems = new Repository<OrderItem>(context);
        UserConsents = new Repository<UserConsent>(context);
        VendorWallets = new Repository<VendorWallet>(context);
        WalletTransactions = new Repository<WalletTransaction>(context);
        PayoutRequests = new Repository<PayoutRequest>(context);
        Reviews = new Repository<Review>(context);
        UserDeviceTokens = new Repository<UserDeviceToken>(context);
        ProductVariants = new Repository<ProductVariant>(context);
        Coupons = new Repository<Coupon>(context);
        CouponUsages = new Repository<CouponUsage>(context);
        ReturnRequests = new Repository<ReturnRequest>(context);
        BuyerWallets = new Repository<BuyerWallet>(context);
        BuyerWalletTransactions = new Repository<BuyerWalletTransaction>(context);
        VerificationCodes = new Repository<VerificationCode>(context);
        RefreshTokens = new Repository<RefreshToken>(context);
    }

    public IRepository<User> Users { get; }
    public IRepository<SellerProfile> SellerProfiles { get; }
    public IRepository<UserAddress> UserAddresses { get; }
    public IRepository<Product> Products { get; }
    public IRepository<Category> Categories { get; }
    public IRepository<Order> Orders { get; }
    public IRepository<Shipment> Shipments { get; }
    public IRepository<OrderItem> OrderItems { get; }
    public IRepository<UserConsent> UserConsents { get; }
    public IRepository<VendorWallet> VendorWallets { get; }
    public IRepository<WalletTransaction> WalletTransactions { get; }
    public IRepository<PayoutRequest> PayoutRequests { get; }
    public IRepository<Review> Reviews { get; }
    public IRepository<UserDeviceToken> UserDeviceTokens { get; }
    public IRepository<ProductVariant> ProductVariants { get; }
    public IRepository<Coupon> Coupons { get; }
    public IRepository<CouponUsage> CouponUsages { get; }
    public IRepository<ReturnRequest> ReturnRequests { get; }
    public IRepository<BuyerWallet> BuyerWallets { get; }
    public IRepository<BuyerWalletTransaction> BuyerWalletTransactions { get; }
    public IRepository<VerificationCode> VerificationCodes { get; }
    public IRepository<RefreshToken> RefreshTokens { get; }

    public async Task<int> SaveChangesAsync()
        => await _context.SaveChangesAsync();

    public async Task BeginTransactionAsync()
    {
        if (_context.Database.IsRelational())
        {
            _transaction = await _context.Database.BeginTransactionAsync();
        }
    }

    public async Task CommitTransactionAsync()
    {
        if (_transaction != null)
        {
            await _transaction.CommitAsync();
            await _transaction.DisposeAsync();
            _transaction = null;
        }
    }

    public async Task RollbackTransactionAsync()
    {
        if (_transaction != null)
        {
            await _transaction.RollbackAsync();
            await _transaction.DisposeAsync();
            _transaction = null;
        }
    }

    public async Task<int> ExecuteSqlRawAsync(string sql, params object[] parameters)
    {
        if (_context.Database.IsRelational())
        {
            return await _context.Database.ExecuteSqlRawAsync(sql, parameters);
        }
        return 1;
    }

    public void Dispose()
    {
        _transaction?.Dispose();
        _context.Dispose();
    }
}
