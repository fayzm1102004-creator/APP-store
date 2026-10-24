namespace Marketplace.Application.Interfaces;

public interface IFakeMessageStore
{
    void RecordCode(string target, string code, string purpose);
    string? GetLastCode(string target);
    IReadOnlyDictionary<string, string> GetAllCodes();
    void Clear();
}
