import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  throw new Error('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, en CLOUDINARY_API_SECRET zijn verplicht in .env');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log('✅ Cloudinary configured');

/**
 * Upload bestand naar Cloudinary
 * @param {Buffer} fileBuffer - Bestand buffer
 * @param {string} fileName - Originele bestandsnaam
 * @param {string} folderPath - Pad in Cloudinary (bijv. "barcelona/uploads")
 * @returns {Promise<{url: string, publicId: string}>}
 */
export async function uploadToCloudinary(fileBuffer, fileName, folderPath = 'barcelona/uploads') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: folderPath,
        resource_type: 'auto',
        public_id: fileName.replace(/\.[^.]+$/, ''), // verwijder extensie
        overwrite: false,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );

    Readable.from(fileBuffer).pipe(stream);
  });
}

export default cloudinary;
