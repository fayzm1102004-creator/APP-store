# Global Rules for Marketplace Project

## Project Paths
- **Repository Root**: `D:\Backend\marketplace`
- **Backend Project Folder**: `D:\Backend\marketplace\backend`
- **Mobile Project Folder**: `D:\Backend\marketplace\mobile`

## Global Rules
1. **Work only in the single unified project folders**:
   - Backend: `D:\Backend\marketplace\backend`
   - Mobile: `D:\Backend\marketplace\mobile`
2. **NEVER run database commands**:
   - No `dotnet ef database update`, `dotnet ef database drop`, `psql`, or `pg_dump`.
   - Generate migrations only (`dotnet ef migrations add ... --output-dir ...`), show the generated SQL (`dotnet ef migrations script ...`); the user applies it manually.
3. **Tests run only against the database named in the env var `TEST_DB`**:
   - Or in-memory database if configured. Never run against production databases.
4. **Do NOT deploy anything**:
   - The hosting platform is paused. Local work only.
5. **Never print or commit secrets**:
   - Secrets come from environment variables. Never commit or log secrets.
6. **Execute ONE stage at a time**:
   - After each stage report: files changed, endpoints added, raw test output, and what could NOT be verified.
   - STOP and wait for user confirmation before proceeding to the next stage.
7. **Biometric Security & Token Binding**:
   - The biometric authentication gate operates as a UI-level lock (`UnlockScreen`).
   - The refresh token is encrypted in `expo-secure-store` and is NOT cryptographically bound to hardware biometric keys (`requireAuthentication: false`). Adding or removing fingerprints does not invalidate the underlying SecureStore token.
