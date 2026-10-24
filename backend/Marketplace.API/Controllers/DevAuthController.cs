using Marketplace.Application.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace Marketplace.API.Controllers;

[ApiController]
[Route("api/dev/auth")]
public class DevAuthController : ControllerBase
{
    private readonly IFakeMessageStore _messageStore;
    private readonly IHostEnvironment _env;

    public DevAuthController(IFakeMessageStore messageStore, IHostEnvironment env)
    {
        _messageStore = messageStore;
        _env = env;
    }

    [HttpGet("last-code")]
    public async Task<IActionResult> GetLastCode(
        [FromQuery] string target,
        [FromServices] Marketplace.Infrastructure.Data.AppDbContext db)
    {
        if (!_env.IsDevelopment())
        {
            return NotFound();
        }

        var code = _messageStore.GetLastCode(target);
        var normalized = target.Trim().ToLowerInvariant();
        var codeRecord = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.FirstOrDefaultAsync(
            db.VerificationCodes.Where(c => c.Target == normalized).OrderByDescending(c => c.CreatedAt));

        return Ok(new { target, code, userId = codeRecord?.UserId });
    }

    [HttpGet("codes")]
    public IActionResult GetAllCodes()
    {
        if (!_env.IsDevelopment())
        {
            return NotFound();
        }

        return Ok(_messageStore.GetAllCodes());
    }

    [HttpPost("clear")]
    public IActionResult Clear()
    {
        if (!_env.IsDevelopment())
        {
            return NotFound();
        }

        _messageStore.Clear();
        return Ok(new { message = "Codes cleared." });
    }

    [HttpPost("expire-code")]
    public async Task<IActionResult> ExpireCode([FromQuery] string target, [FromServices] Marketplace.Infrastructure.Data.AppDbContext db)
    {
        if (!_env.IsDevelopment())
        {
            return NotFound();
        }

        var normalizedTarget = target.Trim().ToLowerInvariant();
        var code = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.FirstOrDefaultAsync(
            db.VerificationCodes.Where(c => c.Target == normalizedTarget).OrderByDescending(c => c.CreatedAt));

        if (code == null)
        {
            return NotFound(new { error = "No active code found." });
        }

        code.ExpiresAt = DateTime.UtcNow.AddMinutes(-5);
        code.CreatedAt = DateTime.UtcNow.AddMinutes(-2);
        await db.SaveChangesAsync();

        return Ok(new { message = "Code marked as expired." });
    }

    [HttpGet("token")]
    public async Task<IActionResult> GetTokenForUser(
        [FromQuery] int userId,
        [FromServices] Marketplace.Infrastructure.Data.AppDbContext db,
        [FromServices] Marketplace.Application.Interfaces.IJwtService jwt)
    {
        if (!_env.IsDevelopment())
        {
            return NotFound();
        }

        var user = await db.Users.FindAsync(userId);
        if (user == null)
        {
            return NotFound();
        }

        return Ok(new { token = jwt.GenerateToken(user).Token });
    }
}
