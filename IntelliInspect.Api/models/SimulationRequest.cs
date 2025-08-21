namespace IntelliInspect.Api.Models
{
    public record SimulationRequest(
        string fileKey,
        string trainStart,
        string trainEnd,
        string simStart,
        string simEnd,
        int?   maxRows // optional cap for UI streaming; defaults below
    );
}