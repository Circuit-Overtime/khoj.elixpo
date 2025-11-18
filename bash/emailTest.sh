node -e "
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

transporter.sendMail({
  from: process.env.MAIL_USER,
  to: 'ayushbhatt633@gmail.com',
  subject: 'Test Email',
  text: 'This is a test email'
}, (err, info) => {
  if (err) {
    console.error('Error:', err.message);
  } else {
    console.log('✓ Email sent:', info.response);
  }
  process.exit();
});
"