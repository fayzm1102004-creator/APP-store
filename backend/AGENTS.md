# Egyptian Marketplace Implementation Instructions

## Project Paths
- **Repository Root**: `D:\Backend\marketplace`
- **Backend Project Folder**: `D:\Backend\marketplace\backend`
- **Mobile Project Folder**: `D:\Backend\marketplace\mobile`

## Global Rules
1. Work only in the single unified project folders (`D:\Backend\marketplace\backend` and `D:\Backend\marketplace\mobile`).
2. NEVER run database commands (no `dotnet ef database update/drop`, `psql`, `pg_dump`). Generate migrations only, show the SQL for the user to apply.
3. Tests run only against the database named in the env var `TEST_DB` (or InMemory).
4. Do NOT deploy anything; the hosting platform is paused. Local work only.
5. Never print or commit secrets. Secrets come from environment variables.
6. Execute ONE stage at a time. After each stage report: files changed, endpoints added, raw test output, and what could NOT be verified. Then STOP and wait for confirmation.

## Target Market & Architecture Rules — All Phases

- **Market & Jurisdiction**: Egypt (جمهورية مصر العربية). Regulated under Egyptian Law, including the Personal Data Protection Law (PDPL 151/2020). Production database and services storing personal data must be hosted inside Egypt. No foreign SaaS for personal data.
- **Currency**: Egyptian Pound (`ج.م` / `EGP`). Format: `"1,299 ج.م"` with Western digits (`0123456789`). Server is authoritative for prices, delivery costs, and totals.
- **Primary Language & RTL**: Arabic (العربية) as default/primary with complete RTL (Right-to-Left) layout support (`I18nManager`, mirrored layouts, mirrored navigation arrows, no hardcoded left/right). English (`en`) as secondary. Russian is completely dropped.
- **Theme & Colors (Option A — Modern Egyptian E-Commerce)**:
  - Primary / Brand: Dark Navy (`#0F172A` / `#1E293B`) — trustworthy, professional retail feel.
  - Accent / Actions / CTA: Warm vibrant Orange (`#FF6B00` / `#EA580C`) — high conversion, eye-catching.
  - Surface & Background: Pure white cards (`#FFFFFF`) on light crisp gray (`#F8FAFC`).
  - Text: Dark slate (`#0F172A`) for prices and headings, muted slate (`#64748B`) for subtitles.
  - Badges: Green (`#16A34A`) for in-stock, Red (`#DC2626`) for discounts and low-stock.
- **External Services**: Every external service (carrier, payments, SMS, push, image storage) sits behind an interface in `Application`, with a fake/local implementation in `Infrastructure` selected by configuration. Never commit API keys.
- **Privacy & Security**: Secrets and URLs come from environment variables or user-secrets. Never log phones, addresses, tokens, or payment data. Never store card data.

---

## Egyptian Market Implementation Roadmap

### 1. UI & Mobile Experience (RTL & Arabic Primary)
- Arabic (`ar`) as primary with full RTL layout mirroring (`I18nManager.isRTL`).
- English (`en`) as secondary. Russian (`ru`) completely removed.
- Use Western digits (`0, 1, 2, ... 9`) across all UI strings and number formatters.
- Directional styles use start/end and dynamic RTL mirroring for icons (`chevron-forward`/`chevron-back`).

### 2. Currency
- Currency display: `ج.م` (Arabic) / `EGP` (English), e.g. `"1,299 ج.م"`.
- Centralized helper in `src/utils/currency.js`.

### 3. Egyptian Phones
- Egyptian mobile validation replacing +7:
  - Formats: `010xxxxxxxx`, `011xxxxxxxx`, `012xxxxxxxx`, `015xxxxxxxx`, or `+20 1[0125]xxxxxxxx`.
  - Regex: `^(?:\+20|0)?1[0125]\d{8}$`.
  - Applied on both Backend (FluentValidation) and Mobile forms.

### 4. Egyptian Addresses
- Structure: Governorate (المحافظة) + City/Center (المدينة/المركز) + Area/District (الحي/المنطقة) + Street & Building/Apartment (الشارع والعمارة).
- Clearly label test addresses and pickup points as test data (e.g., `نقطة استلام تجريبية رقم N`).

### 5. Delivery (Bosta Integration)
- `IDeliveryProvider` in Application, with `FakeDeliveryProvider` in Infrastructure (simulating Bosta with Egyptian test branches and realistic EGP tariffs and ETAs).
- Real Bosta integration will plug in seamlessly behind `IDeliveryProvider` using API keys from environment variables.

### 6. Payments (Cash on Delivery & Payment Gateway)
- **Cash on Delivery (الدفع عند الاستلام)** is a first-class method.
- The COD amount sent to the carrier equals the order total (`items + delivery`).
- A refused or failed delivery sets the shipment status to `Returned` and restores product stock.
- Per-buyer count of refused deliveries tracked dynamically.
- `IPaymentProvider` interface defined for future online payments (Cards, Mobile Wallets / InstaPay, Fawry).

### 7. Egyptian Data Privacy (PDPL 151/2020)
- Explicit user consent checkbox at sign-up with timestamped consent record.
- Data export endpoint: `GET /api/users/me/export-data` (Right to Data Portability).
- Account deletion endpoint: `DELETE /api/users/me` (Right to erasure/anonymization).
- Strict zero-PII logging: no phone numbers, emails, addresses, or full names in server logs or push notifications.
- Production hosting and database located inside Egypt.
