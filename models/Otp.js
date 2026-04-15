import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
    mobile: {
        type: String,
        required: true,
        index: true
    },
    otp: {
        type: String,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true,
        index: { expires: '5m' } // TTL index: documents expire 5 minutes after expiresAt
    },
    isVerified: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Ensure expiresAt is set correctly if not provided
otpSchema.pre('save', function(next) {
    if (!this.expiresAt) {
        this.expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
    }
    next();
});

const Otp = mongoose.model('Otp', otpSchema);

export default Otp;
