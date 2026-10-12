/**
 * Clean, lightweight class utility for combining class names without external dependencies.
 */
export function cn(...inputs) {
  return inputs
    .flat()
    .filter(Boolean)
    .join(" ");
}

/**
 * Formats server error messages with actionable advice and local timestamp formatting.
 */
export function formatActionableErrorMessage(err, fallback = "An unexpected error occurred.") {
  const rawMsg =
    err?.customMessage ||
    err?.response?.data?.error?.message ||
    err?.message ||
    fallback;

  // Detect ISO timestamp in rate limit messages and format to user's local time
  const isoMatch = rawMsg.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/);
  if (isoMatch) {
    try {
      const localTimeStr = new Date(isoMatch[0]).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const localDateStr = new Date(isoMatch[0]).toLocaleDateString();
      return rawMsg.replace(
        isoMatch[0],
        `${localDateStr} at ${localTimeStr} (local time)`
      );
    } catch {
      // Return raw message if date parsing fails
    }
  }

  // Actionable guidance for GitHub authentication
  if (/rate limit/i.test(rawMsg)) {
    return `${rawMsg} Tip: Configure a server GITHUB_TOKEN in server/.env to increase rate limits to 5,000 requests/hour.`;
  }

  if (/GITHUB_AUTH_FAILED|invalid or expired token/i.test(rawMsg)) {
    return `${rawMsg} Tip: Update your personal access token in server/.env.`;
  }

  if (/quota exhausted/i.test(rawMsg)) {
    return `${rawMsg} You can retry indexing to resume progress or use OpenRouter LiquidAI embeddings.`;
  }

  return rawMsg;
}

