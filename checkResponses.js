import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Response from './models/Response.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/focus_forms';

const checkResponses = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const responses = await Response.find({}).limit(5);
    console.log(`Found ${responses.length} responses`);
    
    responses.forEach((response, index) => {
      console.log(`\n--- Response ${index + 1} ---`);
      console.log('ID:', response.id);
      console.log('Answers:', JSON.stringify(response.answers, null, 2));
    });

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

checkResponses();
