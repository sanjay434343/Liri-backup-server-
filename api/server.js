// api/server.js
import axios from "axios";

export default async function handler(req, res) {
  // --- CORS SUPPORT (REQUIRED) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // Hardcoded credentials
    const KEY_ID = "0056eab733f02450000000004";
    const APP_KEY = "K005yQ1MrQJffnqhZf2XmPAubbv0ltM";
    const BUCKET_ID = "e6fe9aeb97f3838f90a20415";

    // --- AUTHORIZE FIRST (needed for all operations) ---
    const auth = await axios.get(
      "https://api.backblazeb2.com/b2api/v2/b2_authorize_account",
      {
        headers: {
          Authorization: "Basic " + Buffer.from(`${KEY_ID}:${APP_KEY}`).toString("base64"),
        },
      }
    );
    
    const authData = auth.data;

    // ===== ROUTE: LIST FILES =====
    if (req.method === "GET" && !req.query.fileId) {
      console.log("📋 Listing files in user/ folder...");

      // First, get bucket info to retrieve bucket name
      const bucketInfoResponse = await axios.post(
        `${authData.apiUrl}/b2api/v2/b2_list_buckets`,
        {
          accountId: authData.accountId,
          bucketId: BUCKET_ID
        },
        {
          headers: {
            Authorization: authData.authorizationToken,
          },
        }
      );

      const bucketName = bucketInfoResponse.data.buckets[0]?.bucketName;
      console.log(`📦 Bucket name: ${bucketName}`);

      // Now list files
      const listResponse = await axios.post(
        `${authData.apiUrl}/b2api/v2/b2_list_file_names`,
        {
          bucketId: BUCKET_ID,
          prefix: "user/",
          maxFileCount: 1000
        },
        {
          headers: {
            Authorization: authData.authorizationToken,
          },
        }
      );

      const files = listResponse.data.files.map(file => ({
        fileName: file.fileName,
        fileId: file.fileId,
        size: file.contentLength,
        uploadTimestamp: file.uploadTimestamp,
        sha1: file.contentSha1,
        contentType: file.contentType || 'application/octet-stream'
      }));

      console.log(`✅ Found ${files.length} files`);

      return res.status(200).json({
        success: true,
        files: files,
        count: files.length,
        bucketName: bucketName
      });
    }

    // ===== ROUTE: DOWNLOAD FILE (PROXY) =====
    if (req.method === "GET" && req.query.fileId) {
      const fileId = req.query.fileId;
      console.log(`📥 Proxying download for file: ${fileId}`);

      // Download file from B2
      const downloadUrl = `${authData.downloadUrl}/b2api/v2/b2_download_file_by_id?fileId=${fileId}`;
      
      const fileResponse = await axios.get(downloadUrl, {
        headers: {
          Authorization: authData.authorizationToken,
        },
        responseType: 'arraybuffer'
      });

      // Get content type from B2 response
      const contentType = fileResponse.headers['content-type'] || 'application/octet-stream';
      const contentDisposition = fileResponse.headers['content-disposition'] || '';
      
      // Set headers for browser
      res.setHeader('Content-Type', contentType);
      if (contentDisposition) {
        res.setHeader('Content-Disposition', contentDisposition);
      }
      res.setHeader('Content-Length', fileResponse.data.length);

      // Send file data
      return res.status(200).send(fileResponse.data);
    }

    // ===== ROUTE: UPLOAD FILE =====
    if (req.method === "POST") {
      console.log("🔐 Starting B2 upload process...");

      const { fileName, fileData, sha1 } = req.body;
      
      if (!fileName || !fileData || !sha1) {
        return res.status(400).json({
          error: "Missing required fields: fileName, fileData, sha1"
        });
      }

      console.log(`📁 File: ${fileName}, SHA1: ${sha1}`);

      // --- GET UPLOAD URL ---
      console.log("🔗 Getting upload URL...");
      const upload = await axios.post(
        `${authData.apiUrl}/b2api/v2/b2_get_upload_url`,
        { bucketId: BUCKET_ID },
        {
          headers: {
            Authorization: authData.authorizationToken,
          },
        }
      );

      console.log("✅ Upload URL obtained");

      // --- UPLOAD FILE TO B2 ---
      const b2FileName = `user/${fileName}`;
      console.log(`📤 Uploading to B2 as: ${b2FileName}`);

      const fileBuffer = Buffer.from(fileData, 'base64');

      const uploadResponse = await axios.post(
        upload.data.uploadUrl,
        fileBuffer,
        {
          headers: {
            Authorization: upload.data.authorizationToken,
            "X-Bz-File-Name": encodeURIComponent(b2FileName),
            "Content-Type": "b2/x-auto",
            "Content-Length": fileBuffer.length,
            "X-Bz-Content-Sha1": sha1
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity
        }
      );

      console.log("✅ Upload successful!");

      return res.status(200).json({
        success: true,
        file: uploadResponse.data,
        message: `File uploaded successfully to user/${fileName}`
      });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (error) {
    console.error("💥 Server Error:", error.response?.data || error.message);
    return res.status(500).json({
      error: "Request failed",
      details: error.response?.data || error.message,
    });
  }
}
