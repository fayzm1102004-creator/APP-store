using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Marketplace.Application.Interfaces;
using Marketplace.Application.Templates;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Marketplace.Infrastructure.Notifications;

public class ResendEmailSender : IEmailSender
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ResendEmailSender> _logger;

    public ResendEmailSender(
        HttpClient httpClient,
        IConfiguration configuration,
        ILogger<ResendEmailSender> logger)
    {
        _httpClient = httpClient;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task SendVerificationEmailAsync(string toEmail, string code, TimeSpan expiry, CancellationToken cancellationToken = default)
    {
        var (subject, plainText, html) = EmailTemplates.VerificationCode(code, (int)expiry.TotalMinutes);
        await SendEmailAsync(toEmail, subject, plainText, html, cancellationToken);
    }

    public async Task SendPasswordResetEmailAsync(string toEmail, string code, TimeSpan expiry, CancellationToken cancellationToken = default)
    {
        var (subject, plainText, html) = EmailTemplates.PasswordResetCode(code, (int)expiry.TotalMinutes);
        await SendEmailAsync(toEmail, subject, plainText, html, cancellationToken);
    }

    public async Task SendEmailAsync(
        string toEmail,
        string subject,
        string plainTextBody,
        string htmlBody,
        CancellationToken cancellationToken = default)
    {
        var apiKey = _configuration["Email:ApiKey"] ?? _configuration["Email__ApiKey"];
        var from = _configuration["Email:From"] ?? _configuration["Email__From"] ?? "onboarding@resend.dev";

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            _logger.LogError("Resend API key is not configured (Email__ApiKey / Email:ApiKey).");
            throw new InvalidOperationException("Email service is not configured.");
        }

        var requestBody = new
        {
            from,
            to = new[] { toEmail },
            subject,
            text = plainTextBody,
            html = htmlBody
        };

        var requestMessage = new HttpRequestMessage(HttpMethod.Post, "https://api.resend.com/emails")
        {
            Content = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json")
        };
        requestMessage.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        var response = await _httpClient.SendAsync(requestMessage, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError("Resend email delivery failed with HTTP status {StatusCode}.", (int)response.StatusCode);
            throw new InvalidOperationException("Failed to send email via Resend.");
        }

        // Never log the email address or verification code
        _logger.LogInformation("Email sent successfully via email service.");
    }
}
