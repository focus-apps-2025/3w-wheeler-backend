import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Response from './models/Response.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/focus_forms';

const checkResponses = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const responses = await Response.find({})
      .sort({ createdAt: -1 })
      .limit(3);

    console.log(`Found ${responses.length} latest responses:\n`);

    responses.forEach((response, index) => {
      console.log(`--- Response ${index + 1} ---`);
      console.log('ID:', response.id);
      console.log('Created:', response.createdAt);
      
      const answers = response.answers instanceof Map ? Object.fromEntries(response.answers) : response.answers;
      
      Object.entries(answers).forEach(([questionId, answer]) => {
        const answerStr = String(answer);
        if (answerStr.includes('drive.google.com')) {
          console.log(`  ✗ GOOGLE DRIVE: ${questionId}`);
          console.log(`    ${answerStr.substring(0, 80)}...`);
        } else if (answerStr.includes('cloudinary.com')) {
          console.log(`  ✓ CLOUDINARY: ${questionId}`);
          console.log(`    ${answerStr.substring(0, 80)}...`);
        }
      });
      console.log();
    });

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

checkResponses();
