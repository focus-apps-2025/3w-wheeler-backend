import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

function loadEnv() {
  const envPath = '.env';
  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};
  
  envContent.split('\n').forEach(line => {
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  
  return env;
}

async function testEmail() {
  const env = loadEnv();
  
  console.log('🧪 Testing Email Configuration...\n');
  
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    }
  });

  try {
    console.log('📧 SMTP Configuration:');
    console.log(`  Host: ${env.SMTP_HOST}`);
    console.log(`  Port: ${env.SMTP_PORT}`);
    console.log(`  User: ${env.SMTP_USER}`);
    console.log(`  From: ${env.SMTP_USER}`);
    console.log('');

    console.log('🔗 Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection verified!\n');

    console.log('📨 Sending test email to: smtsrimathii@gmail.com');
    const mailOptions = {
      from: env.SMTP_USER,
      to: 'smtsrimathii@gmail.com',
      subject: '✅ Hi! - Test Email from Focus Engineering',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">
            Test Email - Email System Working!
          </h2>
          
          <p style="font-size: 16px; color: #374151; line-height: 1.6;">
            Hi! 👋<br><br>
            This is a test email to verify that the email system is working correctly.
            If you're receiving this, the SMTP configuration is properly set up and emails can be sent successfully.
          </p>

          <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
            <h3 style="color: #166534; margin-top: 0;">✅ Configuration Status:</h3>
            <ul style="color: #374151; margin: 0;">
              <li><strong>Email Service:</strong> Active and working</li>
              <li><strong>SMTP Server:</strong> Connected successfully</li>
              <li><strong>Sender:</strong> ${env.SMTP_USER}</li>
              <li><strong>Timestamp:</strong> ${new Date().toLocaleString()}</li>
            </ul>
          </div>

          <div style="background: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #1d4ed8; margin-top: 0;">📋 Next Steps:</h3>
            <p style="color: #374151; margin: 0;">
              Your email system is now ready to send:<br>
              ✓ Service request notifications<br>
              ✓ Status updates<br>
              ✓ Response reports with attachments
            </p>
          </div>

          <div style="text-align: center; margin-top: 30px; padding: 20px; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; margin: 0;">
              Focus Engineering - Email System Test<br>
              <small>This is an automated test message</small>
            </p>
          </div>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully!');
    console.log(`📬 Message ID: ${result.messageId}\n`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error testing email:');
    console.error('Error:', error.message);
    console.error('\n🔍 Troubleshooting:');
    
    if (error.code === 'ENOTFOUND') {
      console.error('  - SMTP host not found. Check SMTP_HOST in .env');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('  - Connection refused. Check SMTP_PORT and firewall settings');
    } else if (error.response && error.response.includes('Invalid credentials')) {
      console.error('  - Invalid email credentials. Check SMTP_USER and SMTP_PASS');
    } else if (error.message.includes('getaddrinfo')) {
      console.error('  - Network error. Check internet connection');
    }
    
    process.exit(1);
  }
}

testEmail();
