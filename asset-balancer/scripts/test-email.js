const { sendTestEmail } = require('../lib/mailer');

sendTestEmail()
  .then(() => {
    console.log('Test email sent.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
