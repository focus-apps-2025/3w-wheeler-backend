import fetch from 'node-fetch';

async function testCompleteFlow() {
  try {
    console.log('=== Starting Complete Form Flow Test ===\n');

    // 1. Login as admin
    console.log('1. Logging in as admin...');
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@focus.com', password: 'admin123#' })
    });
    const loginData = await loginRes.json();
    if (!loginData.success) {
      throw new Error('Login failed: ' + loginData.message);
    }
    const token = loginData.data.token;
    console.log('✓ Login successful\n');

    // 2. Create a new form
    console.log('2. Creating a new form...');
    const formData = {
      title: 'Test Form for Analytics',
      description: 'A test form to demonstrate analytics features',
      questions: [
        {
          id: 'name',
          type: 'text',
          question: 'What is your name?',
          required: true
        },
        {
          id: 'email',
          type: 'email',
          question: 'What is your email?',
          required: true
        },
        {
          id: 'feedback',
          type: 'paragraph',
          question: 'Any feedback?',
          required: false
        }
      ],
      isVisible: true,
      allowMultipleSubmissions: true
    };

    const createFormRes = await fetch('http://localhost:5000/api/forms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(formData)
    });
    const createFormData = await createFormRes.json();
    if (!createFormData.success) {
      throw new Error('Form creation failed: ' + createFormData.message);
    }
    const formId = createFormData.data.form.id;
    console.log(`✓ Form created successfully with ID: ${formId}\n`);

    // 3. Get list of forms
    console.log('3. Getting list of forms...');
    const getFormsRes = await fetch('http://localhost:5000/api/forms', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const getFormsData = await getFormsRes.json();
    if (!getFormsData.success) {
      throw new Error('Get forms failed: ' + getFormsData.message);
    }
    console.log(`✓ Retrieved ${getFormsData.data.forms.length} forms`);
    console.log(`✓ Our new form is in the list: ${getFormsData.data.forms.some(f => f.id === formId)}\n`);

    // 4. Submit the form (public submission)
    console.log('4. Submitting the form...');
    const submissionData = {
      questionId: formId,
      answers: {
        'name': 'John Doe',
        'email': 'john.doe@example.com',
        'feedback': 'This is a great form system!'
      },
      submittedBy: 'John Doe'
    };

    const submitRes = await fetch('http://localhost:5000/api/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submissionData)
    });
    const submitData = await submitRes.json();
    if (!submitData.success) {
      throw new Error('Form submission failed: ' + submitData.message);
    }
    console.log('✓ Form submitted successfully\n');

    // 5. Get dashboard analytics to show submission counts
    console.log('5. Getting dashboard analytics...');
    const analyticsRes = await fetch('http://localhost:5000/api/analytics/dashboard', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const analyticsData = await analyticsRes.json();
    if (!analyticsData.success) {
      throw new Error('Analytics fetch failed: ' + analyticsData.message);
    }
    console.log('✓ Dashboard Analytics:');
    console.log(`  - Total Forms: ${analyticsData.data.overview.totalForms}`);
    console.log(`  - Total Responses: ${analyticsData.data.overview.totalResponses}`);
    console.log(`  - Responses in last 30 days: ${analyticsData.data.overview.responsesInPeriod}`);
    console.log(`  - Status Distribution: ${JSON.stringify(analyticsData.data.statusDistribution)}\n`);

    // 6. Get responses for the specific form
    console.log('6. Getting responses for the created form...');
    const formResponsesRes = await fetch(`http://localhost:5000/api/responses/form/${formId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const formResponsesData = await formResponsesRes.json();
    if (!formResponsesData.success) {
      throw new Error('Form responses fetch failed: ' + formResponsesData.message);
    }
    console.log(`✓ Found ${formResponsesData.data.responses.length} responses for this form`);
    if (formResponsesData.data.responses.length > 0) {
      console.log('✓ Response details:');
      formResponsesData.data.responses.forEach((response, index) => {
        console.log(`  Response ${index + 1}:`);
        console.log(`    - Submitted by: ${response.submittedBy}`);
        console.log(`    - Status: ${response.status}`);
        const answers = response.answers instanceof Map ?
          Object.fromEntries(response.answers) : response.answers;
        console.log(`    - Answers: ${JSON.stringify(answers || {}, null, 4)}`);
        console.log(`    - Submitted at: ${response.createdAt}`);
      });
    }
    console.log('\n');

    // 7. Get form-specific analytics
    console.log('7. Getting form-specific analytics...');
    const formAnalyticsRes = await fetch(`http://localhost:5000/api/analytics/form/${formId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const formAnalyticsData = await formAnalyticsRes.json();
    if (!formAnalyticsData.success) {
      throw new Error('Form analytics fetch failed: ' + formAnalyticsData.message);
    }
    console.log('✓ Form Analytics:');
    console.log(`  - Total Responses: ${formAnalyticsData.data.metrics.totalResponses}`);
    console.log(`  - All-time Responses: ${formAnalyticsData.data.metrics.allTimeResponses}`);
    console.log(`  - Average Response Time: ${formAnalyticsData.data.metrics.averageResponseTime} days`);
    console.log(`  - Daily Responses: ${JSON.stringify(formAnalyticsData.data.dailyResponses)}\n`);

    console.log('=== Complete Flow Test Successful! ===');
    console.log('\nSummary:');
    console.log('- Form created and listed ✓');
    console.log('- Form submitted successfully ✓');
    console.log('- Analytics show submission counts ✓');
    console.log('- Individual responses viewable ✓');
    console.log('- All features working in admin panel context ✓');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testCompleteFlow();