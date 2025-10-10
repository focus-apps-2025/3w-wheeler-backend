import fetch from 'node-fetch';

async function test() {
  try {
    // Login
    console.log('Logging in...');
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@focus.com', password: 'admin123#' })
    });
    const loginData = await loginRes.json();
    const token = loginData.data.token;
    console.log('Login successful');

    // Get forms
    console.log('Getting forms...');
    const formsRes = await fetch('http://localhost:5000/api/forms', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const formsData = await formsRes.json();
    console.log('Forms count:', formsData.data.forms.length);

    // Get responses
    console.log('Getting responses...');
    const responsesRes = await fetch('http://localhost:5000/api/responses', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const responsesData = await responsesRes.json();
    console.log('Responses count:', responsesData.data.responses.length);

    // Submit a response if there's a form
    if (formsData.data.forms.length > 0) {
      const form = formsData.data.forms[0];
      console.log('Submitting response to form:', form.id);
      const submitRes = await fetch('http://localhost:5000/api/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          questionId: form.id,
          answers: { 'name': 'Test User' },
          submittedBy: 'Test User'
        })
      });
      const submitData = await submitRes.json();
      console.log('Submit response:', submitData.success ? 'Success' : 'Failed');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

test();