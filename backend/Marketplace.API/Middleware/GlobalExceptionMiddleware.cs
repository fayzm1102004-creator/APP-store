using System.Net;
using System.Text.Json;
using FluentValidation;
using Marketplace.Application.Exceptions;

namespace Marketplace.API.Middleware;

/// <summary>
/// Converts every unhandled exception into a consistent JSON error body:
/// { "status": 400, "error": "...", "errors": { "Field": ["msg"] } }   ("errors" only for validation failures)
/// </summary>
public class GlobalExceptionMiddleware
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private readonly RequestDelegate _next;
    private readonly ILogger<GlobalExceptionMiddleware> _logger;

    public GlobalExceptionMiddleware(RequestDelegate next, ILogger<GlobalExceptionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            await HandleExceptionAsync(context, ex);
        }
    }

    private async Task HandleExceptionAsync(HttpContext context, Exception exception)
    {
        if (exception is NotVerifiedException notVerified)
        {
            context.Response.ContentType = "application/json";
            context.Response.StatusCode = (int)HttpStatusCode.Forbidden;
            var notVerifiedBody = new
            {
                status = 403,
                error = "NOT_VERIFIED",
                code = "NOT_VERIFIED",
                message = notVerified.Message,
                target = notVerified.Target
            };
            await context.Response.WriteAsync(JsonSerializer.Serialize(notVerifiedBody, JsonOptions));
            return;
        }

        Dictionary<string, string[]>? errors = null;

        var (statusCode, message) = exception switch
        {
            ValidationException ve => (HttpStatusCode.BadRequest, "One or more validation errors occurred."),
            BadRequestException => (HttpStatusCode.BadRequest, exception.Message),
            UnauthorizedException => (HttpStatusCode.Unauthorized, exception.Message),
            ForbiddenException => (HttpStatusCode.Forbidden, exception.Message),
            NotFoundException => (HttpStatusCode.NotFound, exception.Message),
            ConflictException => (HttpStatusCode.Conflict, exception.Message),
            TooManyRequestsException => (HttpStatusCode.TooManyRequests, exception.Message),
            Microsoft.EntityFrameworkCore.DbUpdateException dbEx when dbEx.InnerException is Npgsql.PostgresException { SqlState: "23505" } =>
                (HttpStatusCode.Conflict, "A resource with this identifier already exists."),
            _ => (HttpStatusCode.InternalServerError, "An unexpected error occurred.")
        };

        if (exception is ValidationException validationException)
        {
            errors = validationException.Errors
                .GroupBy(e => e.PropertyName)
                .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray());
        }

        if (statusCode == HttpStatusCode.InternalServerError)
            _logger.LogError(exception, "Unhandled exception occurred");

        context.Response.ContentType = "application/json";
        context.Response.StatusCode = (int)statusCode;

        var body = new ErrorResponse((int)statusCode, message, errors);
        await context.Response.WriteAsync(JsonSerializer.Serialize(body, JsonOptions));
    }

    private record ErrorResponse(int Status, string Error, Dictionary<string, string[]>? Errors);
}
