const nodemailer = require("nodemailer");

/**
 * Creates and returns a Nodemailer transporter using Gmail SMTP.
 * Uses App Password — not the regular Gmail password.
 */
function createTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASSWORD
    }
  });
}

/**
 * Generates a random 6-digit OTP code.
 */
function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Sends OTP email to the user.
 * Works for both registration and password reset.
 */
async function sendOtpEmail({
  to,
  name,
  otp,
  subject = "Your DevSure Verification Code",
  heading = "Verify your email address"
}) {
  const transporter = createTransporter();

  const mailOptions = {
    from: `"DevSure" <${process.env.SMTP_EMAIL}>`,
    to,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0f172a; color: #f8fafc; border-radius: 16px;">
        <h2 style="color: #22c55e; margin-bottom: 8px;">DevSure</h2>
        <h3 style="margin-top: 0;">${heading}</h3>
        <p style="color: #94a3b8;">Hi <strong style="color: #f8fafc;">${name}</strong>,</p>
        <p style="color: #94a3b8;">Use the code below to verify your email and complete your registration.</p>

        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
          <p style="margin: 0; color: #94a3b8; font-size: 13px;">Your verification code</p>
          <h1 style="margin: 12px 0 0; font-size: 42px; letter-spacing: 10px; color: #22c55e;">${otp}</h1>
        </div>

        <p style="color: #64748b; font-size: 13px;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <p style="color: #64748b; font-size: 13px;">If you did not request this, you can safely ignore this email.</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

module.exports = {
  generateOtpCode,
  sendOtpEmail
};
