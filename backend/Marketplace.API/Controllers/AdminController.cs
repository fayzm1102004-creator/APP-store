using Marketplace.API.Extensions;
using Marketplace.Application.DTOs.Admin;
using Marketplace.Application.DTOs.Wallet;
using Marketplace.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Marketplace.API.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize(Roles = "Admin")]
public class AdminController : ControllerBase
{
    private readonly IAdminService _adminService;
    private readonly IWalletService _walletService;
    private readonly IConfiguration _configuration;

    public AdminController(
        IAdminService adminService,
        IWalletService walletService,
        IConfiguration configuration)
    {
        _adminService = adminService;
        _walletService = walletService;
        _configuration = configuration;
    }

    private bool IsWalletEnabled =>
        _configuration.GetValue<bool>("Features:WalletEnabled", false) ||
        _configuration.GetValue<bool>("Wallet:Enabled", false);

    /// <summary>List platform users with optional role and status filters. (Admin only)</summary>
    [HttpGet("users")]
    [ProducesResponseType(typeof(IEnumerable<AdminUserResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<IEnumerable<AdminUserResponse>>> GetUsers(
        [FromQuery] string? role = null,
        [FromQuery] bool? isActive = null)
    {
        var users = await _adminService.GetUsersAsync(role, isActive);
        return Ok(users);
    }

    /// <summary>Activate or deactivate/ban a platform user. (Admin only)</summary>
    [HttpPut("users/{id:int}/status")]
    [ProducesResponseType(typeof(AdminUserResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<AdminUserResponse>> UpdateUserStatus(int id, [FromBody] UpdateUserStatusRequest request)
    {
        var adminId = User.GetUserId();
        var updated = await _adminService.UpdateUserStatusAsync(adminId, id, request);
        return Ok(updated);
    }

    /// <summary>Get platform financial and operational metrics. (Admin only)</summary>
    [HttpGet("stats")]
    [ProducesResponseType(typeof(AdminStatsResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<AdminStatsResponse>> GetStats()
    {
        var stats = await _adminService.GetPlatformStatsAsync();
        return Ok(stats);
    }

    /// <summary>List vendor payout requests with optional status filter. (Admin only)</summary>
    [HttpGet("wallet/payouts")]
    [ProducesResponseType(typeof(IEnumerable<PayoutRequestResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IEnumerable<PayoutRequestResponse>>> GetPayouts([FromQuery] string? status = null)
    {
        if (!IsWalletEnabled) return NotFound(new { error = "Wallet feature is disabled." });

        var payouts = await _walletService.GetAllPayoutRequestsAsync(status);
        return Ok(payouts);
    }

    /// <summary>Process a vendor payout request (Completed or Rejected). (Admin only)</summary>
    [HttpPost("wallet/payouts/{id:int}/process")]
    [ProducesResponseType(typeof(PayoutRequestResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PayoutRequestResponse>> ProcessPayout(int id, [FromBody] ProcessPayoutRequest request)
    {
        if (!IsWalletEnabled) return NotFound(new { error = "Wallet feature is disabled." });

        var processed = await _walletService.ProcessPayoutAsync(id, request);
        return Ok(processed);
    }
}
