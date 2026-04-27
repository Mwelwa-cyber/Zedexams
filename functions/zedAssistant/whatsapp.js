/**
 * WhatsApp Cloud API client.
 *
 * Only the bits we use:
 *   - sendMessage    text out
 *   - uploadMedia    POST /{phone-number-id}/media (multipart)
 *   - sendVoiceNote  uploadMedia → sendMessage type=audio, voice=true
 *   - getMedia       GET /{media-id}, returns { url }
 *   - downloadMedia  GET that URL with the access token
 *   - verifyChallenge helper for the GET handshake Meta requires once
 *
 * Meta's API is plain HTTPS + JSON, except media upload (multipart) and
 * media download (binary). Node 22 ships fetch / FormData / Blob globally,
 * so no third-party deps.
 */

const GRAPH_API = "https://graph.facebook.com/v20.0";

function waUrl(path) {
  return `${GRAPH_API}/${path.replace(/^\/+/, "")}`;
}

async function waJsonRequest(token, method, path, body) {
  const res = await fetch(waUrl(path), {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const description = data?.error?.message ||
      data?.error?.error_user_msg ||
      `HTTP ${res.status}`;
    const err = new Error(`WhatsApp ${method} ${path} failed: ${description}`);
    err.waResponse = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

function chunkText(text, limit = 4000) {
  // Meta caps WhatsApp text bodies at 4096 chars; chunk on newline near
  // the limit to avoid mid-sentence cuts.
  const chunks = [];
  let remaining = String(text || "");
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

async function sendMessage(token, phoneNumberId, to, text) {
  const chunks = chunkText(text);
  const results = [];
  for (const chunk of chunks) {
    const result = await waJsonRequest(
      token,
      "POST",
      `${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: String(to),
        type: "text",
        text: {body: chunk, preview_url: false},
      },
    );
    results.push(result);
  }
  return results;
}

async function uploadMedia(token, phoneNumberId, oggBuffer, mimeType = "audio/ogg") {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  const blob = new Blob([oggBuffer], {type: mimeType});
  form.append("file", blob, "zed.ogg");
  const res = await fetch(waUrl(`${phoneNumberId}/media`), {
    method: "POST",
    headers: {Authorization: `Bearer ${token}`},
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) {
    const description = data?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`WhatsApp uploadMedia failed: ${description}`);
    err.waResponse = data;
    err.status = res.status;
    throw err;
  }
  return data.id;
}

async function sendVoiceNote(token, phoneNumberId, to, oggBuffer) {
  const mediaId = await uploadMedia(token, phoneNumberId, oggBuffer, "audio/ogg");
  return waJsonRequest(token, "POST", `${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: String(to),
    type: "audio",
    audio: {id: mediaId, voice: true},
  });
}

async function getMedia(token, mediaId) {
  return waJsonRequest(token, "GET", String(mediaId));
}

async function downloadMedia(token, url) {
  const res = await fetch(url, {
    headers: {Authorization: `Bearer ${token}`},
  });
  if (!res.ok) {
    throw new Error(`WhatsApp media download failed: HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

/**
 * Returns the challenge string if the verification handshake matches our
 * configured token, otherwise null. Caller decides the HTTP response.
 */
function verifyChallenge({mode, verifyToken, challenge}, expected) {
  if (mode === "subscribe" && verifyToken && challenge && verifyToken === expected) {
    return String(challenge);
  }
  return null;
}

module.exports = {
  sendMessage,
  sendVoiceNote,
  uploadMedia,
  getMedia,
  downloadMedia,
  verifyChallenge,
  chunkText,
};
