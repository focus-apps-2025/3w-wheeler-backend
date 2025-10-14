import mongoose from 'mongoose';
import Form from './models/Form.js';

mongoose.connect('mongodb://localhost:27017/form-builder').then(async () => {
  console.log('Connected to MongoDB');
  
  const forms = await Form.find({});
  
  forms.forEach(f => {
    console.log('\n=== FORM:', f.title, '(ID:', f._id, ') ===');
    if(f.sections) {
      f.sections.forEach((s, si) => {
        console.log(`\nSection ${si}: ${s.title}`);
        if(s.questions) {
          s.questions.forEach((q, qi) => {
            const questionText = q.text ? q.text.substring(0, 60) : 'No text';
            console.log(`  Q${qi}: ${questionText}`);
            console.log(`       correctAnswer: "${q.correctAnswer || '(not set)'}"`);
            if(q.options) {
              console.log(`       options: ${JSON.stringify(q.options)}`);
            }
          });
        }
      });
    }
  });
  
  await mongoose.disconnect();
  console.log('\n\nDisconnected from MongoDB');
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
