import mongoose from 'mongoose';

mongoose.connect('mongodb://localhost:27017/formbuilder')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    const Form = mongoose.model('Form', new mongoose.Schema({}, { strict: false }));
    const form = await Form.findOne({}).sort({updatedAt: -1});
    
    if (form && form.sections) {
      console.log('\n=== Checking Form:', form.title, '===\n');
      form.sections.forEach((section, si) => {
        if (section.questions) {
          section.questions.forEach((q, qi) => {
            if (q.options && q.options.length > 0) {
              console.log(`Section ${si}, Question ${qi}:`);
              console.log(`  Text: ${q.text}`);
              console.log(`  correctAnswer: "${q.correctAnswer}"`);
              console.log(`  Options: ${JSON.stringify(q.options)}`);
              console.log('');
            }
          });
        }
      });
    } else {
      console.log('No form found or no sections');
    }
    
    await mongoose.connection.close();
    console.log('Done');
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });