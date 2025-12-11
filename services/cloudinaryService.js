import { v2 as cloudinary } from 'cloudinary';


export const uploadToCloudinary = async (fileBuffer, filename, folder = 'focus_forms') => {
  // IMPORTANT: Configure Cloudinary each time to ensure credentials are loaded
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });

 

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        folder: folder,
        public_id: filename.replace(/\.[^/.]+$/, ''),
        overwrite: true,
        quality: 80,
        fetch_format: 'auto',
        transformation: [
          {
            quality: 'auto',
            fetch_format: 'auto'
          }
        ],
        timeout: 60000
      },
      (error, result) => {
        if (error) {
          console.error('[CLOUDINARY] Upload error:', error);
          reject(error);
        } else {
          console.log('[CLOUDINARY] Upload successful:', result.secure_url);
          resolve(result);
        }
      }
    );

    stream.on('error', (error) => {
      console.error('[CLOUDINARY] Stream error:', error);
      reject(error);
    });

    stream.end(fileBuffer);
  });
};

export const deleteFromCloudinary = async (publicId) => {
  try {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });

    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw error;
  }
};

export const generateCloudinarySignature = (params) => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });

  return cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);
};