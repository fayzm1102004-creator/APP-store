using Marketplace.Application.DTOs.Admin;
using Marketplace.Application.Exceptions;
using Marketplace.Application.Interfaces;
using Marketplace.Domain.Enums;

namespace Marketplace.Application.Services;

public class AdminService : IAdminService
{
    private readonly IUnitOfWork _uow;

    public AdminService(IUnitOfWork uow)
    {
        _uow = uow;
    }

    public async Task<IEnumerable<AdminUserResponse>> GetUsersAsync(string? role = null, bool? isActive = null)
    {
        var users = (await _uow.Users.GetAllAsync()).ToList();

        if (!string.IsNullOrWhiteSpace(role) && Enum.TryParse<UserRole>(role.Trim(), true, out var parsedRole))
        {
            users = users.Where(u => u.Role == parsedRole).ToList();
        }

        if (isActive.HasValue)
        {
            users = users.Where(u => u.IsActive == isActive.Value).ToList();
        }

        var sellerIds = users.Where(u => u.Role == UserRole.Seller).Select(u => u.Id).ToList();
        var sellerProfiles = (await _uow.SellerProfiles.FindAsync(sp => sellerIds.Contains(sp.UserId)))
            .ToDictionary(sp => sp.UserId);

        return users.Select(u =>
        {
            sellerProfiles.TryGetValue(u.Id, out var sp);
            return new AdminUserResponse
            {
                Id = u.Id,
                Name = u.Name,
                Email = u.Email ?? string.Empty,
                Role = u.Role.ToString(),
                IsActive = u.IsActive,
                CreatedAt = u.CreatedAt,
                DispatchCity = sp?.DispatchCity,
                ContactPhone = sp?.ContactPhone
            };
        }).OrderByDescending(u => u.CreatedAt);
    }

    public async Task<AdminUserResponse> UpdateUserStatusAsync(int adminId, int targetUserId, UpdateUserStatusRequest request)
    {
        if (adminId == targetUserId && !request.IsActive)
        {
            throw new BadRequestException("Admins cannot deactivate their own account.");
        }

        var user = await _uow.Users.GetByIdAsync(targetUserId);
        if (user == null || (user.Email != null && user.Email.StartsWith("deleted_", StringComparison.OrdinalIgnoreCase)))
        {
            throw new NotFoundException($"User with ID {targetUserId} not found.");
        }

        user.IsActive = request.IsActive;
        _uow.Users.Update(user);
        await _uow.SaveChangesAsync();

        var sellerProfile = (await _uow.SellerProfiles.FindAsync(sp => sp.UserId == user.Id)).FirstOrDefault();

        return new AdminUserResponse
        {
            Id = user.Id,
            Name = user.Name,
            Email = user.Email ?? string.Empty,
            Role = user.Role.ToString(),
            IsActive = user.IsActive,
            CreatedAt = user.CreatedAt,
            DispatchCity = sellerProfile?.DispatchCity,
            ContactPhone = sellerProfile?.ContactPhone
        };
    }

    public async Task<AdminStatsResponse> GetPlatformStatsAsync()
    {
        var orders = (await _uow.Orders.GetAllAsync()).ToList();
        var products = (await _uow.Products.GetAllAsync()).ToList();
        var shipments = (await _uow.Shipments.GetAllAsync()).ToList();
        var users = (await _uow.Users.GetAllAsync()).ToList();

        decimal totalVolume = orders
            .Where(o => o.Status != OrderStatus.Cancelled)
            .Sum(o => o.TotalAmount);

        int totalRefusedCod = shipments
            .Count(s => s.ReturnReason == ReturnReason.RefusedByBuyer);

        return new AdminStatsResponse
        {
            TotalOrders = orders.Count,
            TotalVolume = totalVolume,
            TotalActiveProducts = products.Count(p => p.Stock > 0),
            TotalRefusedCodOrders = totalRefusedCod,
            TotalUsers = users.Count,
            TotalBuyers = users.Count(u => u.Role == UserRole.Buyer),
            TotalSellers = users.Count(u => u.Role == UserRole.Seller)
        };
    }
}
