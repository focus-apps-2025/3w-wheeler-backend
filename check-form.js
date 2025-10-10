import mongoose from 'mongoose';
import Form from './models/Form.js';

async function checkForm() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/littleflower');
    const form = await Form.findOne({ id: 'fbdc9708-be34-446b-a5b7-b47aa538a42d' });
    console.log('Form found:', form ? 'YES' : 'NO');
    if (form) {
      console.log('Form details:', {
        _id: form._id.toString(),
        id: form.id,
        title: form.title,
        isVisible: form.isVisible,
        createdBy: form.createdBy.toString()
      });
    } else {
      // Also check if there are any forms at all
      const allForms = await Form.find({}).limit(5);
      console.log('Total forms in DB:', allForms.length);
      if (allForms.length > 0) {
        console.log('Sample form IDs:', allForms.map(f => ({ id: f.id, title: f.title })));
      }
    }
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkForm();