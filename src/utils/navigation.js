const getSafeRedirectPath = (req, fallback = '/discover') => {
  const explicitTarget = req.body?.redirectTo || req.query?.redirectTo;
  if (typeof explicitTarget === 'string' && explicitTarget.startsWith('/')) {
    return explicitTarget;
  }

  const referer = req.get('referer');
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const host = req.get('host');
      if (refererUrl.host === host) {
        return refererUrl.pathname + refererUrl.search;
      }
    } catch (error) {
      // Ignore malformed referer headers
    }
  }

  return fallback;
};

module.exports = {
  getSafeRedirectPath,
};
