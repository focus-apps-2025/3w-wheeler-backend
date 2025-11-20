import File from '../models/File.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getGfsBucket } from '../middleware/upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { associatedType: bodyAssociatedType, associatedId: bodyAssociatedId } = req.body;
    const { associatedType: queryAssociatedType, associatedId: queryAssociatedId } = req.query;

    const normalizeValue = (value) => {
      if (!value) {
        return undefined;
      }
      return Array.isArray(value) ? value[0] : value;
    };

    const rawAssociatedType = (normalizeValue(bodyAssociatedType) || normalizeValue(queryAssociatedType) || 'form').toString().toLowerCase();
    const typeMap = {
      form: 'form',
      response: 'response',
      profile: 'profile',
      logo: 'logo',
      tenant_logo: 'logo',
      general: 'form'
    };
    const associatedType = typeMap[rawAssociatedType] || 'form';
    const associatedIdentifier = normalizeValue(bodyAssociatedId) || normalizeValue(queryAssociatedId);

    // Store file in GridFS with proper error handling
    const gfs = getGfsBucket();
    const uploadStream = gfs.openUploadStream(req.file.originalname, {
      contentType: req.file.mimetype,
      metadata: {
        originalName: req.file.originalname,
        uploadedBy: req.user ? req.user._id : null,
        associatedType: associatedType,
        associatedId: associatedIdentifier
      }
    });

    return new Promise((resolve, reject) => {
      uploadStream.on('error', (error) => {
        console.error('GridFS upload stream error:', error);
        reject(new Error('Failed to upload file to storage'));
      });

      uploadStream.on('finish', async () => {
        try {
          const fileUrl = `/api/files/${uploadStream.id}`;

          const associatedWith = { type: associatedType };
          if (associatedIdentifier) {
            associatedWith.id = associatedIdentifier;
          }

          const fileRecord = new File({
            filename: req.file.originalname,
            originalName: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            gridfsId: uploadStream.id,
            url: fileUrl,
            uploadedBy: req.user ? req.user._id : null,
            associatedWith,
            isPublic: true
          });

          await fileRecord.save();

          const fileData = fileRecord.toObject();

          res.json({
            success: true,
            message: 'File uploaded successfully',
            data: {
              file: fileData,
              url: fileData.url
            }
          });

          resolve();
        } catch (error) {
          console.error('Error saving file record:', error);
          res.status(500).json({
            success: false,
            message: 'Failed to save file record'
          });
          reject(error);
        }
      });

      uploadStream.end(req.file.buffer);
    }).catch((error) => {
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: error.message || 'File upload failed'
        });
      }
    });

  } catch (error) {
    console.error('Upload file error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
};

export const getFile = async (req, res) => {
  try {
    const { filename } = req.params;

    // Check if filename is a valid ObjectId (GridFS file ID)
    const mongoose = (await import('mongoose')).default;
    let fileRecord;

    if (mongoose.Types.ObjectId.isValid(filename)) {
      // If it's an ObjectId, find by gridfsId
      fileRecord = await File.findOne({ gridfsId: filename });
    } else {
      // Otherwise, find by filename
      fileRecord = await File.findOne({ filename });
    }

    if (!fileRecord) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Stream file from GridFS
    const gfs = getGfsBucket();
    const downloadStream = gfs.openDownloadStream(fileRecord.gridfsId);

    downloadStream.on('error', (error) => {
      console.error('GridFS download error:', error);
      return res.status(404).json({
        success: false,
        message: 'File not found in database'
      });
    });

    // Set appropriate headers
    res.setHeader('Content-Type', fileRecord.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${fileRecord.originalName}"`);

    // Pipe the file stream to response
    downloadStream.pipe(res);

  } catch (error) {
    console.error('Get file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const deleteFile = async (req, res) => {
  try {
    const { id } = req.params;

    const fileRecord = await File.findById(id);

    if (!fileRecord) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Check permissions
    const isOwner = fileRecord.uploadedBy && fileRecord.uploadedBy.toString() === req.user._id.toString();

    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own files.'
      });
    }

    // Delete file from GridFS
    const gfs = getGfsBucket();
    try {
      await gfs.delete(fileRecord.gridfsId);
    } catch (gridfsError) {
      console.warn('GridFS delete warning:', gridfsError);
      // Continue with database deletion even if GridFS delete fails
    }

    // Delete record from database
    await File.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getFilesByUser = async (req, res) => {
  try {
    const { page = 1, limit = 10, type } = req.query;
    
    const query = { uploadedBy: req.user._id };
    
    if (type) {
      query['associatedWith.type'] = type;
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const files = await File.find(query)
      .sort(options.sort)
      .limit(options.limit * 1)
      .skip((options.page - 1) * options.limit);

    const total = await File.countDocuments(query);

    res.json({
      success: true,
      data: {
        files,
        pagination: {
          currentPage: options.page,
          totalPages: Math.ceil(total / options.limit),
          totalFiles: total,
          hasNextPage: options.page < Math.ceil(total / options.limit),
          hasPrevPage: options.page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get files by user error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getFileInfo = async (req, res) => {
  try {
    const { id } = req.params;

    const fileRecord = await File.findById(id)
      .populate('uploadedBy', 'username firstName lastName email');

    if (!fileRecord) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    res.json({
      success: true,
      data: { file: fileRecord }
    });

  } catch (error) {
    console.error('Get file info error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};