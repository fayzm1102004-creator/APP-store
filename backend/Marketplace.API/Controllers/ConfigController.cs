using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Marketplace.API.Controllers;

[ApiController]
[Route("api/config")]
[AllowAnonymous]
public class ConfigController : ControllerBase
{
    private readonly IConfiguration _configuration;

    public ConfigController(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    /// <summary>
    /// Returns public, non-sensitive feature configuration flags for client apps.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(PublicConfigResponse), StatusCodes.Status200OK)]
    public ActionResult<PublicConfigResponse> GetConfig()
    {
        var response = new PublicConfigResponse
        {
            GoogleEnabled = _configuration.GetValue<bool>("Auth:GoogleEnabled", false),
            PhoneSignupEnabled = _configuration.GetValue<bool>("Auth:PhoneSignupEnabled", false),
            VerificationRequired = _configuration.GetValue<bool>("Auth:RequireVerification", true),
            WalletEnabled = _configuration.GetValue<bool>("Features:WalletEnabled", false) || _configuration.GetValue<bool>("Wallet:Enabled", false),
            CouponsEnabled = _configuration.GetValue<bool>("Features:CouponsEnabled", false) || _configuration.GetValue<bool>("Coupons:Enabled", false)
        };

        return Ok(response);
    }
}

public class PublicConfigResponse
{
    public bool GoogleEnabled { get; set; }
    public bool PhoneSignupEnabled { get; set; }
    public bool VerificationRequired { get; set; } = true;
    public bool WalletEnabled { get; set; }
    public bool CouponsEnabled { get; set; }
}
