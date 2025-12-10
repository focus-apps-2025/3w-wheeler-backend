import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Response from './models/Response.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/focus_forms';

const verifyMigration = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    
    const response1 = await Response.findOne({ id: '39ab5c5b-1567-482e-beb5-0d655029c84f' });
    const response2 = await Response.findOne({ id: '64c6243e-d829-4443-bf46-b38c73b6abae' });
    
    console.log('\n=== Response 1 ===');
    if (response1 && response1.answers) {
      const answers = response1.answers instanceof Map ? Object.fromEntries(response1.answers) : response1.answers;
      console.log(JSON.stringify(answers, null, 2));
    }
    
    console.log('\n=== Response 2 ===');
    if (response2 && response2.answers) {
      const answers = response2.answers instanceof Map ? Object.fromEntries(response2.answers) : response2.answers;
      console.log(JSON.stringify(answers, null, 2));
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

verifyMigration();
