import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Response from './models/Response.js';

async function fixCorruptDates() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('No MONGODB_URI found in .env');
      process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB successfully.');

    // Find all responses
    const responses = await Response.find({});
    console.log(`Found ${responses.length} total responses in database.`);

    let fixedCount = 0;

    for (const doc of responses) {
      let updated = false;

      const fixDateField = (val) => {
        if (!val) return null;
        const d = new Date(val);
        if (isNaN(d.getTime())) return null;

        const year = d.getFullYear();
        if (year > 20000 && year < 100000) {
          // Excel serial number converted as Year 46097, 46034, etc.
          const realDate = new Date(Math.round((year - 25569) * 86400 * 1000));
          if (!isNaN(realDate.getTime())) {
            return realDate;
          }
        }
        return null;
      };

      // Check createdAt
      const fixedCreatedAt = fixDateField(doc.createdAt);
      if (fixedCreatedAt) {
        console.log(`Fixing doc ${doc._id} createdAt: ${doc.createdAt} -> ${fixedCreatedAt.toISOString()}`);
        doc.createdAt = fixedCreatedAt;
        updated = true;
      }

      // Check submittedAt
      const fixedSubmittedAt = fixDateField(doc.submittedAt);
      if (fixedSubmittedAt) {
        console.log(`Fixing doc ${doc._id} submittedAt: ${doc.submittedAt} -> ${fixedSubmittedAt.toISOString()}`);
        doc.submittedAt = fixedSubmittedAt;
        updated = true;
      }

      // Check submissionMetadata.submittedAt
      if (doc.submissionMetadata?.submittedAt) {
        const fixedMetaSub = fixDateField(doc.submissionMetadata.submittedAt);
        if (fixedMetaSub) {
          console.log(`Fixing doc ${doc._id} submissionMetadata.submittedAt: ${doc.submissionMetadata.submittedAt} -> ${fixedMetaSub.toISOString()}`);
          doc.submissionMetadata.submittedAt = fixedMetaSub;
          updated = true;
        }
      }

      if (updated) {
        await doc.save({ timestamps: false });
        fixedCount++;
      }
    }

    console.log(`✅ Successfully repaired ${fixedCount} corrupted response(s) in MongoDB.`);
    process.exit(0);
  } catch (err) {
    console.error('Error repairing dates:', err);
    process.exit(1);
  }
}

fixCorruptDates();
