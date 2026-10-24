using FluentValidation;
using Marketplace.Application.Interfaces;
using Marketplace.Application.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Marketplace.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddValidatorsFromAssembly(typeof(DependencyInjection).Assembly);

        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IVerificationService, VerificationService>();
        services.AddScoped<IProductService, ProductService>();
        services.AddScoped<ICategoryService, CategoryService>();
        services.AddScoped<IOrderService, OrderService>();
        services.AddScoped<IUserService, UserService>();
        services.AddScoped<IShipmentService, ShipmentService>();
        services.AddScoped<IAdminService, AdminService>();
        services.AddScoped<IWalletService, WalletService>();
        services.AddScoped<IReviewService, ReviewService>();
        services.AddScoped<INotificationService, NotificationService>();
        services.AddScoped<ICouponService, CouponService>();
        services.AddScoped<IReturnService, ReturnService>();

        return services;
    }
}
