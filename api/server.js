// api/get-upload-url.js
import axios from "axios";

const KEY_ID = process.env.B2_KEY_ID || "YOUR_KEY_ID";
const APP_KEY = process.env.B2_APP_KEY || "YOUR_APP_KEY";
const BUCKET_ID = process.env.B2_BUCKET_ID || "YOUR_BUCKET_ID";

let cachedAuth = null;

async function authorize() {
  if (cachedAuth) return cachedAuth;

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

  cachedAuth = authRes.data;
  return cachedAuth;
}

export default async function handler(req, res) {
  try {
    const auth = await authorize();

    const uploadRes = await axios.post(
      auth.apiUrl + "/b2api/v2/b2_get_upload_url",
      { bucketId: BUCKET_ID },
      { headers: { Authorization: auth.authorizationToken } }
    );

    res.status(200).json({
      uploadUrl: uploadRes.data.uploadUrl,
      uploadAuth: uploadRes.data.authorizationToken,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get upload URL" });
  }
}
