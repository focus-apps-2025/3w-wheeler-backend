import dotenv from 'dotenv';
dotenv.config();

import { processGoogleDriveImage } from './services/googleDriveService.js';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const testUrl = 'https://drive.google.com/file/d/1ZdVe8e3YXKQHW-PNAI-T_QCvJ4crrywu/view?usp=sharing';

console.log('Testing Google Drive image processing...');
console.log('Input URL:', testUrl);
console.log('Cloudinary Config:', {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  has_api_key: !!process.env.CLOUDINARY_API_KEY,
  has_api_secret: !!process.env.CLOUDINARY_API_SECRET
});

processGoogleDriveImage(testUrl, 'test-question-id')
  .then(result => {
    console.log('\n✓ Success! Processed URL:');
    console.log(result);
    process.exit(0);
  })
  .catch(error => {
    console.error('\n✗ Error processing image:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  });
