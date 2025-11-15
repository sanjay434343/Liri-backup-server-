// api/server.js
import axios from "axios";

export default async function handler(req, res) {
  // --- CORS SUPPORT (REQUIRED) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // Hardcoded credentials (no env variables)
    const KEY_ID = "0056eab733f02450000000004";
    const APP_KEY = "K005yQ1MrQJffnqhZf2XmPAubbv0ltM";
    const BUCKET_ID = "262e6adb3733838f90a20415";

    // --- STEP 1: AUTHORIZE ---
    const auth = await axios.get(
      "https://api.backblazeb2.com/b2api/v2/b2_authorize_account",
      {
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${KEY_ID}:${APP_KEY}`).toString("base64"),
        },
      }
    );
    
    const authData = auth.data;

    // --- STEP 2: GET UPLOAD URL ---
    const upload = await axios.post(
      `${authData.apiUrl}/b2api/v2/b2_get_upload_url`,
      { bucketId: BUCKET_ID },
      {
        headers: {
          Authorization: authData.authorizationToken,
        },
      }
    );

    return res.status(200).json({
      uploadUrl: upload.data.uploadUrl,
      uploadAuth: upload.data.authorizationToken,
    });
  } catch (error) {
    console.error("💥 Server Error:", error.response?.data || error.message);
    return res.status(500).json({
      error: "Backblaze request failed",
      details: error.response?.data || error.message,
    });
  }
}
