import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

class SMSService {
    constructor() {
        this.accountSid = process.env.TWILIO_ACCOUNT_SID;
        this.authToken = process.env.TWILIO_AUTH_TOKEN;
        this.smsNumber = process.env.TWILIO_SMS_NUMBER;

        this.isConfigured = !!(this.accountSid && this.authToken && this.smsNumber);

        if (this.isConfigured) {
            this.client = twilio(this.accountSid, this.authToken);
            console.log('✅ SMS Service initialized');
            console.log(`   SMS Number: ${this.smsNumber}`);
        } else {
            console.log('⚠️  SMS Service not configured - missing credentials');
        }
    }

    formatPhoneNumber(phone) {
        if (!phone) return null;

        // Remove all non-digit characters
        let cleaned = phone.replace(/\D/g, '');

        // If it starts with 91 (India) and has 12 digits, add +
        if (cleaned.startsWith('91') && cleaned.length === 12) {
            return `+${cleaned}`;
        }

        // If it starts with 1 (US) and has 11 digits, add +
        if (cleaned.startsWith('1') && cleaned.length === 11) {
            return `+${cleaned}`;
        }

        // If it has 10 digits, assume India and add +91
        if (cleaned.length === 10) {
            return `+91${cleaned}`;
        }

        // If it already starts with +, return as is
        if (phone.startsWith('+')) {
            return phone;
        }

        // Otherwise, add + and return
        return `+${cleaned}`;
    }

    async sendFormInvite(phone, formTitle, inviteLink, tenantName) {
        try {
            if (!this.isConfigured) {
                return { success: false, error: 'Twilio SMS service not configured' };
            }

            const customerPhone = this.formatPhoneNumber(phone);
            if (!customerPhone) {
                return { success: false, error: 'Invalid phone number' };
            }

            console.log('📱 Sending SMS Invite...');
            console.log(`   From: ${this.smsNumber}`);
            console.log(`   To: ${customerPhone}`);

            // SMS message (160 characters limit for single SMS, 1600 for concatenated)
            // Keep it concise to avoid multiple SMS charges
            const message = `Hello! ${tenantName} invites you to fill: ${formTitle}. Link: ${inviteLink}`;

            console.log(`   Message: ${message}`);
            console.log(`   Length: ${message.length} characters`);

            const result = await this.client.messages.create({
                from: this.smsNumber,
                to: customerPhone,
                body: message
            });

            console.log('✅ SMS sent successfully!');
            console.log(`   SID: ${result.sid}`);
            console.log(`   Status: ${result.status}`);

            return {
                success: true,
                messageSid: result.sid,
                status: result.status,
                to: customerPhone
            };

        } catch (error) {
            console.error('❌ Failed to send SMS:', error);
            return {
                success: false,
                error: error.message,
                code: error.code
            };
        }
    }

    async checkMessageStatus(messageSid) {
        try {
            if (!this.isConfigured) {
                return { success: false, error: 'Twilio SMS service not configured' };
            }

            const message = await this.client.messages(messageSid).fetch();

            return {
                success: true,
                status: message.status,
                to: message.to,
                from: message.from,
                dateSent: message.dateSent,
                price: message.price,
                priceUnit: message.priceUnit,
                errorCode: message.errorCode,
                errorMessage: message.errorMessage
            };

        } catch (error) {
            console.error('❌ Failed to check SMS status:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Export singleton instance
const smsService = new SMSService();
export default smsService;
