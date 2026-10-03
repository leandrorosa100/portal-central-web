using Microsoft.AspNetCore.Mvc;
using Api.Services;

namespace Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class NewsController : ControllerBase
{
    private readonly INewsService _newsService;

    public NewsController(INewsService newsService)
    {
        _newsService = newsService;
    }

    [HttpGet("headlines")]
    public async Task<IActionResult> GetHeadlines([FromQuery] string category = "general")
    {
        try
        {
            var articles = await _newsService.GetTopHeadlinesAsync(category);
            return Ok(articles);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = ex.Message });
        }
    }
}
