import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Response from './models/Response.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/focus_forms';

const findImageResponses = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const responses = await Response.find({});
    console.log(`Found ${responses.length} total responses`);
    
    let imageResponses = 0;
    responses.forEach((response) => {
      const answers = response.answers || {};
      Object.entries(answers).forEach(([questionId, answer]) => {
        const answerStr = String(answer).toLowerCase();
        
        if (answerStr.includes('drive.google.com') || 
            answerStr.includes('cloudinary.com') ||
            answerStr.includes('upload') ||
            answerStr.endsWith('.jpg') ||
            answerStr.endsWith('.png') ||
            answerStr.endsWith('.jpeg') ||
            answerStr.endsWith('.gif')) {
          imageResponses++;
          console.log(`\n✓ Response ${response.id} - Question ${questionId}:`);
          console.log(`  Value: ${answer}`);
        }
      });
    });

    console.log(`\n\nTotal image-like answers found: ${imageResponses}`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

findImageResponses();
