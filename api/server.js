// api/server.js
import axios from "axios";

export default async function handler(req, res) {
  // ⭐ Allow CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const KEY_ID = process.env.B2_KEY_ID;
    const APP_KEY = process.env.B2_APP_KEY;
    const BUCKET_ID = process.env.B2_BUCKET_ID;

    // Authorize Backblaze
    const authRes = await axios.get(
      "https://api.backblazeb2.com/b2api/v2/b2_authorize_account",
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${KEY_ID}:${APP_KEY}`).toString("base64"),
        },
      }
    );

    const auth = authRes.data;

    // Request upload URL
    const uploadRes = await axios.post(
      auth.apiUrl + "/b2api/v2/b2_get_upload_url",
      { bucketId: BUCKET_ID },
      { headers: { Authorization: auth.authorizationToken } }
    );

    return res.status(200).json({
      uploadUrl: uploadRes.data.uploadUrl,
      uploadAuth: uploadRes.data.authorizationToken,
    });

  } catch (error) {
    console.error("Server Error:", error.response?.data || error.message);
    return res.status(500).json({ error: "Failed to get upload URL" });
  }
}
