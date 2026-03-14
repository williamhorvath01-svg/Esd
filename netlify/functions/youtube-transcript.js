const { YoutubeTranscript } = require("youtube-transcript");

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const urlParam =
    event.queryStringParameters && event.queryStringParameters.url;

  if (!urlParam) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing ?url= query parameter" }),
    };
  }

  const videoId = extractVideoId(urlParam);
  if (!videoId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Could not extract video ID from URL" }),
    };
  }

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    const fullText = transcript.map((entry) => entry.text).join(" ");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        videoId,
        url: urlParam,
        entries: transcript,
        fullText,
        totalEntries: transcript.length,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err.message || "Failed to fetch transcript",
      }),
    };
  }
};
