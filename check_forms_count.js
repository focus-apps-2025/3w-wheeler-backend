import mongoose from 'mongoose';
import Form from './models/Form.js';

mongoose.connect('mongodb://localhost:27017/form-builder').then(async () => {
  console.log('Connected to MongoDB');
  
  const totalForms = await Form.countDocuments({});
  const parentForms = await Form.countDocuments({ parentFormId: { $exists: false } });
  const childForms = await Form.countDocuments({ parentFormId: { $exists: true, $ne: null } });
  
  console.log('✓ Total forms in DB:', totalForms);
  console.log('✓ Parent forms (no parentFormId):', parentForms);
  console.log('✓ Child forms (with parentFormId):', childForms);
  
  const forms = await Form.find({}).select('_id id title parentFormId createdAt');
  console.log('\n=== All Forms ===');
  forms.forEach((f, i) => {
    console.log(`${i + 1}. "${f.title}" | ID: ${f._id} | parentFormId: ${f.parentFormId || 'none'}`);
  });
  
  await mongoose.disconnect();
  console.log('\nDisconnected from MongoDB');
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
