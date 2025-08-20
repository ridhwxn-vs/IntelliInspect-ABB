using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader());
});

builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = long.MaxValue;
});

var app = builder.Build();

app.UseCors("AllowAll");

app.MapPost("/upload-dataset", () =>
{
    var result = new
    {
        FileName = "mock.csv",
        Records = 14704,
        Columns = 5,
        PassRate = 70.5,
        StartDate = "2021-01-01 00:00:00",
        EndDate = "2021-12-31 23:59:59"
    };

    return Results.Ok(result);
});

app.Run();
