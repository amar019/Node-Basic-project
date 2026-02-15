import { v2 as cloudinary } from "cloudinary";
import fs from "fs";

// Configure Cloudinary - ensure it's set every time before upload
const configureCloudinary = () => {
  cloudinary.config({
    cloud_name: process.env.cloud_name,
    api_key: process.env.api_key,
    api_secret: process.env.api_secret,
  });
};

const uploadOnCloudinary = async (localFilePath) => {
  try {
    if (!localFilePath) return null;

    // Ensure Cloudinary is configured before uploading
    configureCloudinary();

    const result = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto",
    });

    // delete temp file after upload
    fs.unlinkSync(localFilePath);

    return result;
  } catch (error) {
    fs.unlinkSync(localFilePath);
    console.log("Cloudinary upload error:", error);
    return null;
  }
};

export { uploadOnCloudinary };
