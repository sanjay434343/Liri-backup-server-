// api/server.js
import axios from "axios";

export default async function handler(req, res) {
  // --- CORS SUPPORT (REQUIRED) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS, PUT");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Debug logging
  console.log(`Request: ${req.method} ${req.url}`);
  console.log('Query params:', req.query);

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

    // ===== ROUTE: LIST FOLDERS =====
    if (req.method === "GET" && req.query.action === "folders") {
      console.log("📁 Listing user folders...");

      const listResponse = await axios.post(
        `${authData.apiUrl}/b2api/v2/b2_list_file_names`,
        {
          bucketId: BUCKET_ID,
          prefix: "user/",
          delimiter: "/",
          maxFileCount: 10000
        },
        {
          headers: {
            Authorization: authData.authorizationToken,
          },
        }
      );

      // Extract unique folder names from file paths
      const folders = new Set();
      
      listResponse.data.files.forEach(file => {
        const path = file.fileName.replace('user/', '');
        const folderMatch = path.match(/^([^/]+)\//);
        if (folderMatch) {
          folders.add(folderMatch[1]);
        }
      });

      const folderList = Array.from(folders).sort();
      console.log(`✅ Found ${folderList.length} folders:`, folderList);

      return res.status(200).json({
        success: true,
        folders: folderList
      });
    }

    // ===== ROUTE: LIST FILES (with optional folder filter) =====
    if (req.method === "GET" && !req.query.fileId && req.query.action !== "folders") {
      const folder = req.query.folder || '';
      const prefix = folder ? `user/${folder}/` : 'user/';
      
      console.log(`📋 Listing files in: ${prefix}`);

      // Get bucket info
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

      // List files
      const listResponse = await axios.post(
        `${authData.apiUrl}/b2api/v2/b2_list_file_names`,
        {
          bucketId: BUCKET_ID,
          prefix: prefix,
          maxFileCount: 1000
        },
        {
          headers: {
            Authorization: authData.authorizationToken,
          },
        }
      );

      const files = listResponse.data.files
        .filter(file => {
          // Only include files directly in the folder (not in subfolders)
          const relativePath = file.fileName.replace(prefix, '');
          return !relativePath.includes('/');
        })
        .map(file => ({
          fileName: file.fileName,
          fileId: file.fileId,
          size: file.contentLength,
          uploadTimestamp: file.uploadTimestamp,
          sha1: file.contentSha1,
          contentType: file.contentType || 'application/octet-stream'
        }));

      console.log(`✅ Found ${files.length} files in ${prefix}`);

      return res.status(200).json({
        success: true,
        files: files,
        count: files.length,
        bucketName: bucketName,
        currentFolder: folder
      });
    }

    // ===== ROUTE: DOWNLOAD FILE (PROXY) =====
    if (req.method === "GET" && req.query.fileId) {
      const fileId = req.query.fileId;
      console.log(`📥 Proxying download for file: ${fileId}`);

      try {
        const downloadUrl = `${authData.downloadUrl}/b2api/v2/b2_download_file_by_id?fileId=${fileId}`;
        
        const fileResponse = await axios.get(downloadUrl, {
          headers: {
            Authorization: authData.authorizationToken,
          },
          responseType: 'arraybuffer'
        });

        const contentType = fileResponse.headers['content-type'] || 'application/octet-stream';
        const contentDisposition = fileResponse.headers['content-disposition'] || '';
        
        res.setHeader('Content-Type', contentType);
        if (contentDisposition) {
          res.setHeader('Content-Disposition', contentDisposition);
        }
        res.setHeader('Content-Length', fileResponse.data.length);

        console.log(`✅ File downloaded successfully, size: ${fileResponse.data.length}`);
        return res.status(200).send(fileResponse.data);
      } catch (downloadError) {
        console.error('Download error:', downloadError.response?.data || downloadError.message);
        return res.status(500).json({
          error: 'File download failed',
          details: downloadError.response?.data || downloadError.message
        });
      }
    }

    // ===== ROUTE: DELETE FILE OR FOLDER =====
    if (req.method === "DELETE") {
      const { fileId, fileName, folder } = req.body;
      
      console.log("🗑️ Delete request received:", { fileId, fileName, folder });

      // Delete entire folder
      if (folder && !fileId && !fileName) {
        console.log(`📁 Deleting entire folder: user/${folder}/`);
        
        const prefix = `user/${folder}/`;
        
        // List all files in folder
        const listResponse = await axios.post(
          `${authData.apiUrl}/b2api/v2/b2_list_file_names`,
          {
            bucketId: BUCKET_ID,
            prefix: prefix,
            maxFileCount: 10000
          },
          {
            headers: {
              Authorization: authData.authorizationToken,
            },
          }
        );

        const filesToDelete = listResponse.data.files;
        console.log(`Found ${filesToDelete.length} files to delete`);

        if (filesToDelete.length === 0) {
          return res.status(404).json({
            error: "Folder not found or already empty"
          });
        }

        // Delete all files in folder
        const deletePromises = filesToDelete.map(file =>
          axios.post(
            `${authData.apiUrl}/b2api/v2/b2_delete_file_version`,
            {
              fileId: file.fileId,
              fileName: file.fileName
            },
            {
              headers: {
                Authorization: authData.authorizationToken,
              },
            }
          )
        );

        await Promise.all(deletePromises);

        console.log(`✅ Successfully deleted folder: ${folder}`);
        return res.status(200).json({
          success: true,
          message: `Folder '${folder}' deleted successfully`,
          filesDeleted: filesToDelete.length
        });
      }

      // Delete single file
      if (fileId && fileName) {
        console.log(`🗑️ Deleting single file: ${fileName} (${fileId})`);

        await axios.post(
          `${authData.apiUrl}/b2api/v2/b2_delete_file_version`,
          {
            fileId: fileId,
            fileName: fileName
          },
          {
            headers: {
              Authorization: authData.authorizationToken,
            },
          }
        );

        console.log(`✅ Successfully deleted file: ${fileName}`);
        return res.status(200).json({
          success: true,
          message: `File '${fileName}' deleted successfully`
        });
      }

      return res.status(400).json({
        error: "Invalid delete request. Provide either 'folder' OR both 'fileId' and 'fileName'"
      });
    }

    // ===== ROUTE: UPLOAD FILE =====
    if (req.method === "POST") {
      console.log("🔐 Starting B2 upload process...");

      const { fileName, fileData, sha1, folder } = req.body;
      
      if (!fileName || !fileData || !sha1 || !folder) {
        return res.status(400).json({
          error: "Missing required fields: fileName, fileData, sha1, folder"
        });
      }

      console.log(`📁 File: ${fileName}, Folder: ${folder}, SHA1: ${sha1}`);

      // Get upload URL
      const upload = await axios.post(
        `${authData.apiUrl}/b2api/v2/b2_get_upload_url`,
        { bucketId: BUCKET_ID },
        {
          headers: {
            Authorization: authData.authorizationToken,
          },
        }
      );

      // Upload file to B2 with folder path
      const b2FileName = `user/${folder}/${fileName}`;
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
        message: `File uploaded successfully to user/${folder}/${fileName}`
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
