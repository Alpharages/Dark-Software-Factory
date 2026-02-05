import { registerAs } from '@nestjs/config';

export default registerAs('notifications', () => ({
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
  },
  email: {
    apiKey: process.env.SENDGRID_API_KEY,
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@darksoftwarefactory.com',
  },
}));
