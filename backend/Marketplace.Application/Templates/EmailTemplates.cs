namespace Marketplace.Application.Templates;

public static class EmailTemplates
{
    public static (string Subject, string PlainText, string Html) VerificationCode(string code, int expiryMinutes = 10)
    {
        var subject = "رمز التحقق الخاص بك - سوق مصر";

        var plainText =
$@"رمز التحقق الخاص بك هو: {code}
هذا الرمز صالح لمدة {expiryMinutes} دقائق.
إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.";

        var html =
$@"<!DOCTYPE html>
<html dir=""rtl"" lang=""ar"">
<head>
  <meta charset=""utf-8"">
  <title>{subject}</title>
</head>
<body style=""font-family: Arial, Tahoma, sans-serif; direction: rtl; text-align: right; background-color: #f8fafc; margin: 0; padding: 24px;"">
  <div style=""max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);"">
    <h2 style=""color: #0f172a; margin-top: 0; font-size: 20px; text-align: center;"">رمز التحقق</h2>
    <p style=""color: #475569; font-size: 15px; line-height: 1.6; text-align: center;"">استخدم الرمز التالي لإتمام عملية التحقق في سوق مصر:</p>
    <div style=""background-color: #f1f5f9; border-radius: 8px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #ff6b00; padding: 18px; margin: 24px 0;"">
      {code}
    </div>
    <p style=""color: #64748b; font-size: 14px; text-align: center;"">هذا الرمز صالح لمدة {expiryMinutes} دقائق فقط.</p>
    <hr style=""border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;"" />
    <p style=""color: #94a3b8; font-size: 13px; text-align: center; margin-bottom: 0;"">إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.</p>
  </div>
</body>
</html>";

        return (subject, plainText, html);
    }

    public static (string Subject, string PlainText, string Html) PasswordResetCode(string code, int expiryMinutes = 10)
    {
        var subject = "رمز إعادة تعيين كلمة المرور - سوق مصر";

        var plainText =
$@"رمز إعادة تعيين كلمة المرور هو: {code}
هذا الرمز صالح لمدة {expiryMinutes} دقائق.
إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.";

        var html =
$@"<!DOCTYPE html>
<html dir=""rtl"" lang=""ar"">
<head>
  <meta charset=""utf-8"">
  <title>{subject}</title>
</head>
<body style=""font-family: Arial, Tahoma, sans-serif; direction: rtl; text-align: right; background-color: #f8fafc; margin: 0; padding: 24px;"">
  <div style=""max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);"">
    <h2 style=""color: #0f172a; margin-top: 0; font-size: 20px; text-align: center;"">إعادة تعيين كلمة المرور</h2>
    <p style=""color: #475569; font-size: 15px; line-height: 1.6; text-align: center;"">استخدم الرمز التالي لإعادة تعيين كلمة المرور الخاصة بحسابك:</p>
    <div style=""background-color: #f1f5f9; border-radius: 8px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #ff6b00; padding: 18px; margin: 24px 0;"">
      {code}
    </div>
    <p style=""color: #64748b; font-size: 14px; text-align: center;"">هذا الرمز صالح لمدة {expiryMinutes} دقائق فقط.</p>
    <hr style=""border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;"" />
    <p style=""color: #94a3b8; font-size: 13px; text-align: center; margin-bottom: 0;"">إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.</p>
  </div>
</body>
</html>";

        return (subject, plainText, html);
    }
}
