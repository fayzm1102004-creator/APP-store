using Marketplace.API.Extensions;
using Marketplace.Application.DTOs.Products;
using Marketplace.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Marketplace.API.Controllers;

[ApiController]
[Route("api/products")]
[Authorize(Roles = "Seller")] // Restrict entire controller to Sellers for now (Phase 4 scope)
public class ProductsController : ControllerBase
{
    private readonly IProductService _productService;
    private readonly IWebHostEnvironment _environment;

    public ProductsController(IProductService productService, IWebHostEnvironment environment)
    {
        _productService = productService;
        _environment = environment;
    }

    /// <summary>Upload a product image. (Seller only)</summary>
    [HttpPost("upload-image")]
    [Authorize(Roles = "Seller")]
    [EnableRateLimiting("upload-policy")]
    [Consumes("multipart/form-data")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> UploadImage(IFormFile? file)
    {
        if (file == null || file.Length == 0)
        {
            return BadRequest(new { error = "No image file provided." });
        }

        const long maxFileSize = 5 * 1024 * 1024; // 5 MB
        if (file.Length > maxFileSize)
        {
            return BadRequest(new { error = "File size exceeds 5MB limit." });
        }

        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".webp" };
        var extension = Path.GetExtension(file.FileName)?.ToLowerInvariant();
        if (string.IsNullOrEmpty(extension) || !allowedExtensions.Contains(extension))
        {
            return BadRequest(new { error = "Invalid file type. Only jpg, jpeg, png, and webp are allowed." });
        }

        var uploadsFolder = Path.Combine(_environment.WebRootPath ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"), "uploads");
        if (!Directory.Exists(uploadsFolder))
        {
            Directory.CreateDirectory(uploadsFolder);
        }

        await using var memoryStream = new MemoryStream();
        await file.CopyToAsync(memoryStream);
        var bytes = memoryStream.ToArray();

        if (!IsValidImageHeader(bytes, extension))
        {
            return BadRequest(new { error = "Invalid image file header. Magic bytes do not match expected image signature." });
        }

        var fileName = $"{Guid.NewGuid()}{extension}";
        var filePath = Path.Combine(uploadsFolder, fileName);

        await System.IO.File.WriteAllBytesAsync(filePath, bytes);

        return Ok(new { url = $"/uploads/{fileName}" });
    }

    private static bool IsValidImageHeader(byte[] bytes, string extension)
    {
        if (bytes.Length < 12) return false;

        // JPEG: FF D8 FF
        if (extension is ".jpg" or ".jpeg")
            return bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (extension == ".png")
            return bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47 &&
                   bytes[4] == 0x0D && bytes[5] == 0x0A && bytes[6] == 0x1A && bytes[7] == 0x0A;

        // WEBP: RIFF....WEBP (52 49 46 46 .... 57 45 42 50)
        if (extension == ".webp")
            return bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46 &&
                   bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50;

        return false;
    }

    /// <summary>Add a new product. (Seller only)</summary>
    [HttpPost]
    [ProducesResponseType(typeof(ProductResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<ProductResponse>> CreateProduct(CreateProductRequest request)
    {
        var sellerId = User.GetUserId();
        var product = await _productService.CreateProductAsync(sellerId, request);
        
        // We will add GetProductById in Phase 5, so we just return the object for now
        return StatusCode(StatusCodes.Status201Created, product);
    }

    /// <summary>Update an existing product. Must be the owner. (Seller only)</summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(typeof(ProductResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductResponse>> UpdateProduct(int id, UpdateProductRequest request)
    {
        var sellerId = User.GetUserId();
        var product = await _productService.UpdateProductAsync(sellerId, id, request);
        return Ok(product);
    }

    /// <summary>Quick update product stock and/or price from seller dashboard. (Seller only)</summary>
    [HttpPatch("{id:int}/quick-stock")]
    [Authorize(Roles = "Seller")]
    [ProducesResponseType(typeof(ProductResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductResponse>> QuickStock(int id, Marketplace.Application.DTOs.Dashboard.QuickStockUpdateRequest request)
    {
        var sellerId = User.GetUserId();
        var product = await _productService.QuickStockUpdateAsync(sellerId, id, request);
        return Ok(product);
    }

    /// <summary>Delete a product. Must be the owner. (Seller only)</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> DeleteProduct(int id)
    {
        var sellerId = User.GetUserId();
        await _productService.DeleteProductAsync(sellerId, id);
        return NoContent();
    }

    /// <summary>Get all products belonging to the logged-in seller. (Seller only)</summary>
    [HttpGet("my-products")]
    [ProducesResponseType(typeof(IEnumerable<ProductResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<IEnumerable<ProductResponse>>> GetMyProducts()
    {
        var sellerId = User.GetUserId();
        var products = await _productService.GetSellerProductsAsync(sellerId);
        return Ok(products);
    }

    /// <summary>Get all products with optional filters, sort, search, and pagination. (Public)</summary>
    [HttpGet]
    [AllowAnonymous]
    [ProducesResponseType(typeof(IEnumerable<ProductResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IEnumerable<ProductResponse>>> GetAllProducts(
        [FromQuery] int? categoryId = null,
        [FromQuery] string? sort = null,
        [FromQuery] string? search = null,
        [FromQuery] int? page = null,
        [FromQuery] int? pageSize = null,
        [FromQuery] bool? hasDiscount = null)
    {
        var products = await _productService.GetAllProductsAsync(categoryId, sort, search, page, pageSize, hasDiscount);
        return Ok(products);
    }

    /// <summary>Get a product by ID. (Public)</summary>
    [HttpGet("{id:int}")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(ProductResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductResponse>> GetProductById(int id)
    {
        var product = await _productService.GetProductByIdAsync(id);
        return Ok(product);
    }

    /// <summary>Search products by name or description. (Public)</summary>
    [HttpGet("search")]
    [AllowAnonymous]
    [ProducesResponseType(typeof(IEnumerable<ProductResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<IEnumerable<ProductResponse>>> SearchProducts([FromQuery] string query)
    {
        var products = await _productService.SearchProductsAsync(query);
        return Ok(products);
    }
}
