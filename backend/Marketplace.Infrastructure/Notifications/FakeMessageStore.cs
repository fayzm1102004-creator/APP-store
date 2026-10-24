using System.Collections.Concurrent;
using Marketplace.Application.Interfaces;

namespace Marketplace.Infrastructure.Notifications;

public class FakeMessageStore : IFakeMessageStore
{
    private readonly ConcurrentDictionary<string, string> _lastCodes = new(StringComparer.OrdinalIgnoreCase);

    public void RecordCode(string target, string code, string purpose)
    {
        _lastCodes[target] = code;
    }

    public string? GetLastCode(string target)
    {
        _lastCodes.TryGetValue(target, out var code);
        return code;
    }

    public IReadOnlyDictionary<string, string> GetAllCodes()
    {
        return _lastCodes;
    }

    public void Clear()
    {
        _lastCodes.Clear();
    }
}
