import mongoose from 'mongoose';
import Form from './models/Form.js';
import dotenv from 'dotenv';

dotenv.config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    const form = await Form.findOne().select('sections followUpQuestions -_id');
    
    if (form && form.sections) {
      console.log('\n=== SECTION QUESTIONS STRUCTURE ===');
      form.sections.forEach((section, sIdx) => {
        console.log(`\nSection ${sIdx}: ${section.title}`);
        console.log(`Total questions: ${section.questions.length}`);
        
        section.questions.forEach((q, qIdx) => {
          const parentId = q.parentId ? `parentId=${q.parentId}` : 'no parentId';
          const showWhen = q.showWhen?.questionId ? `showWhen=${q.showWhen.questionId}` : 'no showWhen';
          console.log(`  Q${qIdx}: ${q.text?.substring(0, 50)} [${parentId}] [${showWhen}]`);
        });
      });
    }
    
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
