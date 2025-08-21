namespace IntelliInspect.Api.Models
{
    public record TrainRequest(
        string fileKey,
        string trainStart,
        string trainEnd,
        string testStart,
        string testEnd
    );
}
