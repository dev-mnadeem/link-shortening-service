/**
 * HTTP adapter for the URL service.
 *
 * Controllers here do three things only: pull values off the request, call one
 * service method, and shape the response. No validation, no SQL, no branching
 * on business rules - all of that lives in the service, where it can be tested
 * without an HTTP server.
 */
export const createUrlController = ({ urlService, baseUrl }) => ({
  async createShortUrl(req, res) {
    const { url } = req.body ?? {};
    const { shortCode, originalUrl } = await urlService.createShortUrl(url);

    res.status(201).json({
      shortUrl: `${baseUrl}/${shortCode}`,
      code: shortCode,
      originalUrl,
    });
  },

  async redirectShortUrl(req, res) {
    const { shortUrl } = req.params;

    const urlRecord = await urlService.resolveAndRecordClick(shortUrl, {
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || "unknown",
    });

    // Without this, a browser or intermediary may cache the 302 and every
    // subsequent visit skips the service entirely - along with its analytics.
    res.set("Cache-Control", "private, no-store");
    res.redirect(302, urlRecord.original_url);
  },
});
