using Microsoft.EntityFrameworkCore;
using Marketplace.Domain.Entities;
using Marketplace.Domain.Enums;

namespace Marketplace.Infrastructure.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<SellerProfile> SellerProfiles => Set<SellerProfile>();
    public DbSet<UserAddress> UserAddresses => Set<UserAddress>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<Shipment> Shipments => Set<Shipment>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();
    public DbSet<UserConsent> UserConsents => Set<UserConsent>();
    public DbSet<VendorWallet> VendorWallets => Set<VendorWallet>();
    public DbSet<WalletTransaction> WalletTransactions => Set<WalletTransaction>();
    public DbSet<PayoutRequest> PayoutRequests => Set<PayoutRequest>();
    public DbSet<Review> Reviews => Set<Review>();
    public DbSet<UserDeviceToken> UserDeviceTokens => Set<UserDeviceToken>();
    public DbSet<ProductVariant> ProductVariants => Set<ProductVariant>();
    public DbSet<Coupon> Coupons => Set<Coupon>();
    public DbSet<CouponUsage> CouponUsages => Set<CouponUsage>();
    public DbSet<ReturnRequest> ReturnRequests => Set<ReturnRequest>();
    public DbSet<BuyerWallet> BuyerWallets => Set<BuyerWallet>();
    public DbSet<BuyerWalletTransaction> BuyerWalletTransactions => Set<BuyerWalletTransaction>();
    public DbSet<VerificationCode> VerificationCodes => Set<VerificationCode>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // --- User ------------------------------------------------
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(u => u.Id);

            entity.Property(u => u.Name)
                .IsRequired()
                .HasMaxLength(100);

            entity.Property(u => u.Email)
                .IsRequired(false)
                .HasMaxLength(200);

            entity.HasIndex(u => u.Email)
                .IsUnique()
                .HasFilter("\"Email\" IS NOT NULL");

            entity.Property(u => u.Phone)
                .IsRequired(false)
                .HasMaxLength(20);

            entity.HasIndex(u => u.Phone)
                .IsUnique()
                .HasFilter("\"Phone\" IS NOT NULL");

            entity.Property(u => u.EmailVerifiedAt)
                .IsRequired(false);

            entity.Property(u => u.PhoneVerifiedAt)
                .IsRequired(false);

            entity.Property(u => u.TokenVersion)
                .IsRequired()
                .HasDefaultValue(0);

            entity.Property(u => u.PasswordHash)
                .IsRequired();

            entity.Property(u => u.Role)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(20);

            entity.Property(u => u.IsActive)
                .IsRequired()
                .HasDefaultValue(true);

            entity.Property(u => u.CreatedAt)
                .IsRequired();
        });

        // --- VerificationCode ------------------------------------
        modelBuilder.Entity<VerificationCode>(entity =>
        {
            entity.HasKey(vc => vc.Id);

            entity.Property(vc => vc.UserId)
                .IsRequired();

            entity.Property(vc => vc.Channel)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(20);

            entity.Property(vc => vc.Target)
                .IsRequired()
                .HasMaxLength(200);

            entity.Property(vc => vc.Purpose)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(50);

            entity.Property(vc => vc.CodeHash)
                .IsRequired()
                .HasMaxLength(256);

            entity.Property(vc => vc.ExpiresAt)
                .IsRequired();

            entity.Property(vc => vc.AttemptCount)
                .IsRequired()
                .HasDefaultValue(0);

            entity.Property(vc => vc.ConsumedAt)
                .IsRequired(false);

            entity.Property(vc => vc.CreatedAt)
                .IsRequired();

            entity.HasIndex(vc => vc.Target);
            entity.HasIndex(vc => vc.UserId);
            entity.HasIndex(vc => vc.ExpiresAt);

            entity.HasOne(vc => vc.User)
                .WithMany(u => u.VerificationCodes)
                .HasForeignKey(vc => vc.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // --- SellerProfile ---------------------------------------
        modelBuilder.Entity<SellerProfile>(entity =>
        {
            entity.HasKey(sp => sp.Id);

            entity.HasIndex(sp => sp.UserId)
                .IsUnique();

            entity.Property(sp => sp.DispatchCity)
                .IsRequired()
                .HasMaxLength(100);

            entity.Property(sp => sp.DispatchAddress)
                .HasMaxLength(300);

            entity.Property(sp => sp.ContactPhone)
                .HasMaxLength(20);

            entity.HasOne(sp => sp.User)
                .WithOne(u => u.SellerProfile)
                .HasForeignKey<SellerProfile>(sp => sp.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // --- UserAddress -----------------------------------------
        modelBuilder.Entity<UserAddress>(entity =>
        {
            entity.HasKey(ua => ua.Id);

            entity.Property(ua => ua.Label)
                .HasMaxLength(50);

            entity.Property(ua => ua.RecipientName)
                .IsRequired()
                .HasMaxLength(100);

            entity.Property(ua => ua.RecipientPhone)
                .IsRequired()
                .HasMaxLength(20);

            entity.Property(ua => ua.Governorate)
                .IsRequired()
                .HasMaxLength(100);

            entity.Property(ua => ua.City)
                .IsRequired()
                .HasMaxLength(100);

            entity.Property(ua => ua.Area)
                .IsRequired()
                .HasMaxLength(100);

            entity.Property(ua => ua.StreetBuilding)
                .IsRequired()
                .HasMaxLength(300);

            entity.Property(ua => ua.IsDefault)
                .IsRequired();

            entity.Property(ua => ua.CreatedAt)
                .IsRequired();

            entity.HasOne(ua => ua.User)
                .WithMany(u => u.Addresses)
                .HasForeignKey(ua => ua.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // --- Category --------------------------------------------
        modelBuilder.Entity<Category>(entity =>
        {
            entity.HasKey(c => c.Id);

            entity.Property(c => c.Key)
                .IsRequired()
                .HasMaxLength(50);

            entity.HasIndex(c => c.Key)
                .IsUnique();

            entity.Property(c => c.IconName)
                .IsRequired()
                .HasMaxLength(50);

            entity.HasData(
                new Category { Id = 1, Key = "electronics", IconName = "devices" },
                new Category { Id = 2, Key = "clothing", IconName = "shirt" },
                new Category { Id = 3, Key = "shoes", IconName = "shoe-sneaker" },
                new Category { Id = 4, Key = "home", IconName = "home" },
                new Category { Id = 5, Key = "beauty", IconName = "sparkles" },
                new Category { Id = 6, Key = "kids", IconName = "baby" },
                new Category { Id = 7, Key = "sports", IconName = "basketball" },
                new Category { Id = 8, Key = "accessories", IconName = "watch" },
                new Category { Id = 9, Key = "other", IconName = "dots-horizontal" }
            );
        });

        // --- Product ---------------------------------------------
        modelBuilder.Entity<Product>(entity =>
        {
            entity.HasKey(p => p.Id);

            entity.Property(p => p.Name)
                .IsRequired()
                .HasMaxLength(200);

            entity.Property(p => p.Description)
                .HasMaxLength(2000);

            entity.Property(p => p.Price)
                .IsRequired()
                .HasColumnType("decimal(18,2)");

            entity.Property(p => p.OldPrice)
                .HasColumnType("decimal(18,2)");

            entity.Property(p => p.Stock)
                .IsRequired();

            // Documented default of 500g for existing product rows
            entity.Property(p => p.WeightGrams)
                .IsRequired()
                .HasDefaultValue(500);

            entity.Property(p => p.LengthCm);
            entity.Property(p => p.WidthCm);
            entity.Property(p => p.HeightCm);

            entity.Property(p => p.AverageRating)
                .HasColumnType("decimal(3,2)")
                .HasDefaultValue(0.00m)
                .IsRequired();

            entity.Property(p => p.ReviewsCount)
                .HasDefaultValue(0)
                .IsRequired();

            entity.Property(p => p.CreatedAt)
                .IsRequired();

            // Store ImageUrls as JSON array in a text column
            entity.Property(p => p.ImageUrls)
                .HasConversion(
                    v => System.Text.Json.JsonSerializer.Serialize(v, (System.Text.Json.JsonSerializerOptions?)null),
                    v => System.Text.Json.JsonSerializer.Deserialize<List<string>>(v, (System.Text.Json.JsonSerializerOptions?)null) ?? new List<string>())
                .HasColumnType("text")
                .Metadata.SetValueComparer(
                    new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<List<string>>(
                        (c1, c2) => c1!.SequenceEqual(c2!),
                        c => c.Aggregate(0, (a, v) => HashCode.Combine(a, v.GetHashCode())),
                        c => c.ToList()));

            entity.HasOne(p => p.Seller)
                .WithMany(u => u.Products)
                .HasForeignKey(p => p.SellerId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(p => p.Category)
                .WithMany(c => c.Products)
                .HasForeignKey(p => p.CategoryId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // --- Order -----------------------------------------------
        modelBuilder.Entity<Order>(entity =>
        {
            entity.HasKey(o => o.Id);

            entity.Property(o => o.TotalAmount)
                .IsRequired()
                .HasColumnType("decimal(18,2)");

            entity.Property(o => o.DiscountAmount)
                .IsRequired()
                .HasColumnType("decimal(18,2)")
                .HasDefaultValue(0m);

            entity.Property(o => o.CouponCode)
                .HasMaxLength(50);

            entity.Property(o => o.WalletAmountUsed)
                .IsRequired()
                .HasColumnType("decimal(18,2)")
                .HasDefaultValue(0m);

            entity.Property(o => o.Status)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(20);

            entity.Property(o => o.DeliveryMethod)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(20)
                .HasDefaultValue(DeliveryMethod.Pickup);

            entity.Property(o => o.PickupPointId)
                .HasMaxLength(100);

            entity.Property(o => o.RecipientName)
                .IsRequired()
                .HasMaxLength(100)
                .HasDefaultValue(string.Empty);

            entity.Property(o => o.RecipientPhone)
                .IsRequired()
                .HasMaxLength(20)
                .HasDefaultValue(string.Empty);

            entity.Property(o => o.Governorate)
                .IsRequired()
                .HasMaxLength(100);

            entity.Property(o => o.City)
                .IsRequired()
                .HasMaxLength(100);

            entity.Property(o => o.Area)
                .IsRequired()
                .HasMaxLength(100);

            entity.Property(o => o.StreetBuilding)
                .IsRequired()
                .HasMaxLength(300);

            entity.Property(o => o.PaymentMethod)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(20)
                .HasDefaultValue(PaymentMethod.OnReceipt);

            entity.Property(o => o.CreatedAt)
                .IsRequired();

            entity.HasOne(o => o.Buyer)
                .WithMany(u => u.Orders)
                .HasForeignKey(o => o.BuyerId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // --- Shipment --------------------------------------------
        modelBuilder.Entity<Shipment>(entity =>
        {
            entity.HasKey(s => s.Id);

            entity.Property(s => s.Status)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(s => s.TrackingNumber)
                .IsRequired()
                .HasMaxLength(100);

            entity.Property(s => s.DeliveryCost)
                .IsRequired()
                .HasColumnType("decimal(18,2)");

            entity.Property(s => s.CodAmount)
                .IsRequired()
                .HasColumnType("decimal(18,2)");

            entity.Property(s => s.ReturnReason)
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(s => s.EtaMinDays)
                .IsRequired();

            entity.Property(s => s.EtaMaxDays)
                .IsRequired();

            entity.Property(s => s.CreatedAt)
                .IsRequired();

            entity.Property(s => s.DeliveredAt);

            entity.HasOne(s => s.Order)
                .WithMany(o => o.Shipments)
                .HasForeignKey(s => s.OrderId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(s => s.Seller)
                .WithMany(u => u.Shipments)
                .HasForeignKey(s => s.SellerId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // --- OrderItem -------------------------------------------
        modelBuilder.Entity<OrderItem>(entity =>
        {
            entity.HasKey(oi => oi.Id);

            entity.Property(oi => oi.Quantity)
                .IsRequired();

            entity.Property(oi => oi.UnitPrice)
                .IsRequired()
                .HasColumnType("decimal(18,2)");

            entity.Property(oi => oi.VariantId);

            entity.Property(oi => oi.VariantSummary)
                .HasMaxLength(200);

            entity.HasOne(oi => oi.Order)
                .WithMany(o => o.Items)
                .HasForeignKey(oi => oi.OrderId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(oi => oi.Shipment)
                .WithMany(s => s.Items)
                .HasForeignKey(oi => oi.ShipmentId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(oi => oi.Product)
                .WithMany()
                .HasForeignKey(oi => oi.ProductId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(oi => oi.Variant)
                .WithMany()
                .HasForeignKey(oi => oi.VariantId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // --- UserConsent (PDPL 151/2020) -------------------------
        modelBuilder.Entity<UserConsent>(entity =>
        {
            entity.HasKey(uc => uc.Id);

            entity.Property(uc => uc.PolicyVersion)
                .IsRequired()
                .HasMaxLength(20);

            entity.Property(uc => uc.AcceptedAt)
                .IsRequired();

            entity.Property(uc => uc.MarketingConsent)
                .IsRequired();

            entity.HasOne(uc => uc.User)
                .WithMany(u => u.Consents)
                .HasForeignKey(uc => uc.UserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // --- VendorWallet ----------------------------------------
        modelBuilder.Entity<VendorWallet>(entity =>
        {
            entity.HasKey(w => w.Id);

            entity.HasIndex(w => w.SellerId)
                .IsUnique();

            entity.Property(w => w.Balance)
                .HasColumnType("decimal(18,2)")
                .HasDefaultValue(0m);

            entity.Property(w => w.PendingBalance)
                .HasColumnType("decimal(18,2)")
                .HasDefaultValue(0m);

            entity.Property(w => w.TotalEarned)
                .HasColumnType("decimal(18,2)")
                .HasDefaultValue(0m);

            entity.Property(w => w.UpdatedAt)
                .IsRequired();

            entity.HasOne(w => w.Seller)
                .WithOne(u => u.Wallet)
                .HasForeignKey<VendorWallet>(w => w.SellerId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // --- WalletTransaction -----------------------------------
        modelBuilder.Entity<WalletTransaction>(entity =>
        {
            entity.HasKey(t => t.Id);

            entity.Property(t => t.Amount)
                .HasColumnType("decimal(18,2)")
                .IsRequired();

            entity.Property(t => t.Type)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(t => t.Description)
                .HasMaxLength(250);

            entity.Property(t => t.CreatedAt)
                .IsRequired();

            entity.HasOne(t => t.Wallet)
                .WithMany(w => w.Transactions)
                .HasForeignKey(t => t.WalletId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(t => t.Order)
                .WithMany()
                .HasForeignKey(t => t.OrderId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(t => t.Shipment)
                .WithMany()
                .HasForeignKey(t => t.ShipmentId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // --- PayoutRequest ---------------------------------------
        modelBuilder.Entity<PayoutRequest>(entity =>
        {
            entity.HasKey(p => p.Id);

            entity.Property(p => p.Amount)
                .HasColumnType("decimal(18,2)")
                .IsRequired();

            entity.Property(p => p.Method)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(p => p.DestinationAccount)
                .IsRequired()
                .HasMaxLength(150);

            entity.Property(p => p.Status)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(p => p.AdminNotes)
                .HasMaxLength(500);

            entity.Property(p => p.CreatedAt)
                .IsRequired();

            entity.HasOne(p => p.Seller)
                .WithMany(u => u.PayoutRequests)
                .HasForeignKey(p => p.SellerId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // --- Review ----------------------------------------------
        modelBuilder.Entity<Review>(entity =>
        {
            entity.HasKey(r => r.Id);

            entity.Property(r => r.Rating)
                .IsRequired();

            entity.Property(r => r.Comment)
                .HasMaxLength(1000);

            entity.Property(r => r.CreatedAt)
                .IsRequired();

            entity.HasOne(r => r.Product)
                .WithMany(p => p.Reviews)
                .HasForeignKey(r => r.ProductId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(r => r.Buyer)
                .WithMany(u => u.Reviews)
                .HasForeignKey(r => r.BuyerId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(r => new { r.ProductId, r.BuyerId });
        });

        // --- UserDeviceToken -------------------------------------
        modelBuilder.Entity<UserDeviceToken>(entity =>
        {
            entity.HasKey(t => t.Id);

            entity.Property(t => t.DeviceToken)
                .IsRequired()
                .HasMaxLength(500);

            entity.Property(t => t.Platform)
                .IsRequired()
                .HasMaxLength(50);

            entity.Property(t => t.UpdatedAt)
                .IsRequired();

            entity.HasOne(t => t.User)
                .WithMany(u => u.DeviceTokens)
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(t => new { t.UserId, t.DeviceToken })
                .IsUnique();
        });

        // --- ProductVariant --------------------------------------
        modelBuilder.Entity<ProductVariant>(entity =>
        {
            entity.HasKey(pv => pv.Id);

            entity.Property(pv => pv.Sku)
                .HasMaxLength(100);

            entity.Property(pv => pv.Size)
                .HasMaxLength(50);

            entity.Property(pv => pv.Color)
                .HasMaxLength(50);

            entity.Property(pv => pv.AttributeName)
                .HasMaxLength(50);

            entity.Property(pv => pv.AttributeValue)
                .HasMaxLength(100);

            entity.Property(pv => pv.PriceOverride)
                .HasColumnType("decimal(18,2)");

            entity.Property(pv => pv.Stock)
                .IsRequired();

            entity.Property(pv => pv.ImageUrl)
                .HasMaxLength(500);

            entity.HasOne(pv => pv.Product)
                .WithMany(p => p.Variants)
                .HasForeignKey(pv => pv.ProductId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(pv => pv.ProductId);
        });

        // --- Coupon ----------------------------------------------
        modelBuilder.Entity<Coupon>(entity =>
        {
            entity.HasKey(c => c.Id);

            entity.Property(c => c.Code)
                .IsRequired()
                .HasMaxLength(50);

            entity.HasIndex(c => c.Code)
                .IsUnique();

            entity.Property(c => c.DiscountType)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(20);

            entity.Property(c => c.DiscountValue)
                .IsRequired()
                .HasColumnType("decimal(18,2)");

            entity.Property(c => c.MinOrderSubtotal)
                .IsRequired()
                .HasColumnType("decimal(18,2)");

            entity.Property(c => c.MaxDiscountAmount)
                .HasColumnType("decimal(18,2)");

            entity.Property(c => c.MaxUsage)
                .IsRequired();

            entity.Property(c => c.UsedCount)
                .IsRequired()
                .HasDefaultValue(0);

            entity.Property(c => c.PerUserLimit)
                .IsRequired()
                .HasDefaultValue(1);

            entity.Property(c => c.ExpiresAt)
                .IsRequired();

            entity.Property(c => c.IsActive)
                .IsRequired()
                .HasDefaultValue(true);

            entity.Property(c => c.CreatedAt)
                .IsRequired();

            entity.HasOne(c => c.Seller)
                .WithMany()
                .HasForeignKey(c => c.SellerId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // --- CouponUsage -----------------------------------------
        modelBuilder.Entity<CouponUsage>(entity =>
        {
            entity.HasKey(cu => cu.Id);

            entity.Property(cu => cu.DiscountApplied)
                .IsRequired()
                .HasColumnType("decimal(18,2)");

            entity.Property(cu => cu.UsedAt)
                .IsRequired();

            entity.HasOne(cu => cu.Coupon)
                .WithMany(c => c.Usages)
                .HasForeignKey(cu => cu.CouponId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(cu => cu.Buyer)
                .WithMany()
                .HasForeignKey(cu => cu.BuyerId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(cu => cu.Order)
                .WithMany()
                .HasForeignKey(cu => cu.OrderId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(cu => new { cu.CouponId, cu.BuyerId });
        });

        // --- ReturnRequest ---------------------------------------
        modelBuilder.Entity<ReturnRequest>(entity =>
        {
            entity.HasKey(r => r.Id);

            entity.Property(r => r.Quantity)
                .IsRequired();

            entity.Property(r => r.Reason)
                .IsRequired()
                .HasMaxLength(500);

            entity.Property(r => r.DefectImageUrl)
                .HasMaxLength(500);

            entity.Property(r => r.Status)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(20);

            entity.Property(r => r.RefundAmount)
                .IsRequired()
                .HasColumnType("decimal(18,2)");

            entity.Property(r => r.CreatedAt)
                .IsRequired();

            entity.Property(r => r.ResolvedAt);

            entity.HasOne(r => r.Order)
                .WithMany()
                .HasForeignKey(r => r.OrderId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(r => r.Shipment)
                .WithMany()
                .HasForeignKey(r => r.ShipmentId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(r => r.OrderItem)
                .WithMany()
                .HasForeignKey(r => r.OrderItemId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(r => r.Buyer)
                .WithMany()
                .HasForeignKey(r => r.BuyerId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(r => r.Seller)
                .WithMany()
                .HasForeignKey(r => r.SellerId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // --- BuyerWallet -----------------------------------------
        modelBuilder.Entity<BuyerWallet>(entity =>
        {
            entity.HasKey(w => w.Id);

            entity.Property(w => w.Balance)
                .IsRequired()
                .HasColumnType("decimal(18,2)")
                .HasDefaultValue(0m);

            entity.Property(w => w.UpdatedAt)
                .IsRequired();

            entity.HasOne(w => w.Buyer)
                .WithOne(u => u.BuyerWallet)
                .HasForeignKey<BuyerWallet>(w => w.BuyerId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(w => w.BuyerId)
                .IsUnique();
        });

        // --- BuyerWalletTransaction ------------------------------
        modelBuilder.Entity<BuyerWalletTransaction>(entity =>
        {
            entity.HasKey(t => t.Id);

            entity.Property(t => t.Amount)
                .IsRequired()
                .HasColumnType("decimal(18,2)");

            entity.Property(t => t.Type)
                .IsRequired()
                .HasConversion<string>()
                .HasMaxLength(30);

            entity.Property(t => t.Description)
                .IsRequired()
                .HasMaxLength(250);

            entity.Property(t => t.CreatedAt)
                .IsRequired();

            entity.HasOne(t => t.Buyer)
                .WithMany()
                .HasForeignKey(t => t.BuyerId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(t => t.Order)
                .WithMany()
                .HasForeignKey(t => t.OrderId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(t => t.ReturnRequest)
                .WithMany()
                .HasForeignKey(t => t.ReturnRequestId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // --- RefreshToken ----------------------------------------
        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.HasKey(r => r.Id);

            entity.Property(r => r.UserId)
                .IsRequired();

            entity.Property(r => r.TokenHash)
                .IsRequired()
                .HasMaxLength(64);

            entity.HasIndex(r => r.TokenHash)
                .IsUnique();

            entity.Property(r => r.DeviceId)
                .IsRequired()
                .HasMaxLength(100);

            entity.Property(r => r.DeviceName)
                .IsRequired(false)
                .HasMaxLength(100);

            entity.Property(r => r.CreatedAt)
                .IsRequired();

            entity.Property(r => r.ExpiresAt)
                .IsRequired();

            entity.Property(r => r.LastUsedAt)
                .IsRequired(false);

            entity.Property(r => r.RevokedAt)
                .IsRequired(false);

            entity.Property(r => r.ReplacedByTokenId)
                .IsRequired(false);

            entity.HasIndex(r => r.UserId);
            entity.HasIndex(r => new { r.UserId, r.DeviceId });

            entity.HasOne(r => r.User)
                .WithMany(u => u.RefreshTokens)
                .HasForeignKey(r => r.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(r => r.ReplacedByToken)
                .WithMany()
                .HasForeignKey(r => r.ReplacedByTokenId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
