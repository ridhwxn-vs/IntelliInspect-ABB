using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);

// Allow big uploads
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = long.MaxValue);

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader());
});

// Multipart limits
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = long.MaxValue;
});

var app = builder.Build();

app.UseCors("AllowAll");

// In-memory index of uploaded augmented files for the current app lifetime
// key => absolute path to the (possibly augmented) CSV persisted to temp
var fileIndex = new ConcurrentDictionary<string, string>();
var tempRoot = Path.Combine(Path.GetTempPath(), "miniml_uploads");
Directory.CreateDirectory(tempRoot);

app.MapPost("/upload-dataset", async (HttpRequest request) =>
{
    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0)
        return Results.BadRequest(new { message = "No file uploaded." });

    var fileName = file.FileName ?? "dataset.csv";
    var isCsv = fileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(file.ContentType, "text/csv", StringComparison.OrdinalIgnoreCase);
    if (!isCsv)
        return Results.BadRequest(new { message = "Only .csv files are supported." });

    // Save original to temp
    var key = Guid.NewGuid().ToString("N");
    var originalPath = Path.Combine(tempRoot, $"{key}_orig.csv");
    await using (var fs = new FileStream(originalPath, FileMode.CreateNew))
    {
        await file.CopyToAsync(fs);
    }

    // Parse header & rows (streaming)
    string[] headers;
    int columns;
    int tsIdx = -1;
    int responseIdx = -1;
    long records = 0;
    long passCount = 0;
    bool hasTimestamp = false;

    DateTime? minTs = null;
    DateTime? maxTs = null;

    // First pass: read and compute stats; also detect timestamp/response columns
    using (var sr = new StreamReader(originalPath, Encoding.UTF8, true, 1024 * 64))
    {
        var headerLine = await sr.ReadLineAsync();
        if (headerLine == null)
            return Results.BadRequest(new { message = "CSV appears to be empty." });

        headers = SplitCsv(headerLine);
        columns = headers.Length;

        // locate columns (case-insensitive)
        tsIdx = Array.FindIndex(headers, h => string.Equals(h?.Trim(), "timestamp", StringComparison.OrdinalIgnoreCase));
        responseIdx = Array.FindIndex(headers, h => string.Equals(h?.Trim(), "response", StringComparison.OrdinalIgnoreCase));
        hasTimestamp = tsIdx >= 0;

        string? line;
        while ((line = await sr.ReadLineAsync()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var fields = SplitCsv(line);

            // keep count even if row is short/long
            records++;

            // pass rate (Response == "1")
            if (responseIdx >= 0 && responseIdx < fields.Length)
            {
                var resp = fields[responseIdx].Trim();
                if (resp == "1") passCount++;
            }

            // track date range (if timestamp exists)
            if (tsIdx >= 0 && tsIdx < fields.Length)
            {
                if (DateTime.TryParse(fields[tsIdx], CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dt))
                {
                    if (!minTs.HasValue || dt < minTs.Value) minTs = dt;
                    if (!maxTs.HasValue || dt > maxTs.Value) maxTs = dt;
                }
            }
        }
    }

    // If timestamp missing, create an augmented file with synthetic timestamps
    var finalPath = originalPath;
    if (!hasTimestamp)
    {
        var augmentedPath = Path.Combine(tempRoot, $"{key}.csv");
        var start = DateTime.UtcNow; // synthetic start
        minTs = start;

        long rowIndex = 0;
        using var sr = new StreamReader(originalPath, Encoding.UTF8, true, 1024 * 64);
        using var sw = new StreamWriter(augmentedPath, false, new UTF8Encoding(false));

        // write new header with Timestamp appended
        var headerLine = await sr.ReadLineAsync();
        await sw.WriteLineAsync($"{headerLine},Timestamp");

        string? line;
        while ((line = await sr.ReadLineAsync()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var ts = start.AddSeconds(rowIndex++);
            await sw.WriteLineAsync($"{line},{ts:yyyy-MM-dd HH:mm:ss}");
        }

        maxTs = start.AddSeconds(Math.Max(rowIndex - 1, 0));
        finalPath = augmentedPath;
        columns += 1; // we added Timestamp
        hasTimestamp = true;
    }

    var passRate = records > 0 ? (double)passCount * 100.0 / records : 0.0;

    // Index the final (augmented or original) path for the session
    fileIndex[key] = finalPath;

    var result = new
    {
        fileKey = key,
        fileName,
        records,
        columns,
        passRate = Math.Round(passRate, 1),
        startDate = (minTs ?? DateTime.UtcNow).ToString("yyyy-MM-dd HH:mm:ss"),
        endDate = (maxTs ?? DateTime.UtcNow).ToString("yyyy-MM-dd HH:mm:ss"),
        hasTimestamp
    };

    return Results.Ok(result);
});

// (Optional) simple ping to verify server is running
app.MapGet("/", () => Results.Ok("MiniML API running."));

app.Run();


// -------- Helpers --------
static string[] SplitCsv(string line)
{
    // Minimal CSV splitter supporting quotes and commas inside quotes
    var fields = new List<string>();
    var sb = new StringBuilder();
    bool inQuotes = false;

    for (int i = 0; i < line.Length; i++)
    {
        var ch = line[i];

        if (ch == '\"')
        {
            if (inQuotes && i + 1 < line.Length && line[i + 1] == '\"')
            {
                // escaped quote
                sb.Append('\"');
                i++;
            }
            else
            {
                inQuotes = !inQuotes;
            }
        }
        else if (ch == ',' && !inQuotes)
        {
            fields.Add(sb.ToString());
            sb.Clear();
        }
        else
        {
            sb.Append(ch);
        }
    }
    fields.Add(sb.ToString());
    return fields.ToArray();
}
