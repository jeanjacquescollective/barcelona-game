import multer from 'multer';

// Memory storage — bestanden worden in het RAM gehouden,
// niet naar schijf geschreven (ze gaan naar Cloudinary)
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});
