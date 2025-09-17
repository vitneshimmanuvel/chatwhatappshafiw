// index.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JSONFilePreset } = require('lowdb/node');

// --------- Google Sheets Setup ----------
const SHEET_ID = '1AcgkJrU7M4u943Pj8KbCdK3UX-najLdEzNlVVfnYwBc'; // Your Sheet ID
const doc = new GoogleSpreadsheet(SHEET_ID);

async function initSheets() {
  try {
    await doc.useServiceAccountAuth(require('./credentials.json'));
    await doc.loadInfo();
    console.log('✅ Google Sheets connected:', doc.title);
  } catch (error) {
    console.error('❌ Sheets connection failed:', error.message);
    console.log('Make sure credentials.json is in your project folder!');
  }
}

// Save data to Google Sheets
async function saveToSheets(data) {
  try {
    const sheet = doc.sheetsByIndex[0]; // first sheet
    await sheet.addRow({
      Phone: data.phone.replace('@c.us', ''), // clean phone number
      Name: data.name || 'Unknown',
      Choice: data.choice,
      Message: data.message,
      Timestamp: new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'}),
      Status: data.status || 'Active'
    });
    console.log('📝 Saved to sheets:', data.choice);
  } catch (error) {
    console.error('❌ Sheets save error:', error.message);
  }
}

// --------- Local DB Setup ----------
let db;

async function initDB() {
  const defaultData = { users: {} };
  db = await JSONFilePreset('users.json', defaultData);
  console.log('✅ Local database initialized');
}

// --------- WhatsApp Client Setup ----------
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "sheets-bot" }),
  puppeteer: { 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', qr => {
  console.log('\n🔥 WhatsApp Bot Starting...\n');
  qrcode.generate(qr, { small: true });
  console.log('\n📱 Scan QR above with your WhatsApp Business app\n');
});

client.on('ready', async () => {
  console.log('🚀 WhatsApp bot is ready!');
  await initSheets();
  await initDB();
  console.log('💬 Send "hi" to your bot to test!');
});

client.on('authenticated', () => {
  console.log('✅ Authentication successful!');
});

client.on('auth_failure', msg => {
  console.error('❌ Authentication failed:', msg);
});

// --------- Menu & Response Functions ----------
async function sendMainMenu(to) {
  const message = `🔥 *Welcome to Your Business!*\n\n` +
    `Please choose an option:\n\n` +
    `1️⃣ *Product Catalog*\n` +
    `2️⃣ *Pricing & Plans*\n` +
    `3️⃣ *Schedule Demo*\n` +
    `4️⃣ *Contact Support*\n` +
    `5️⃣ *Download Brochure*\n\n` +
    `💬 Reply with number (1-5) or type *menu* anytime`;
  
  await client.sendMessage(to, message);
  
  // Save to sheets
  await saveToSheets({
    phone: to,
    choice: 'Main Menu Sent',
    message: 'User received main menu',
    status: 'Engaged'
  });
  
  // Update user state
  db.data.users[to] = { step: 'MENU_SENT', lastActive: Date.now() };
  await db.write();
}

async function handleMenuChoice(choice, from) {
  const responses = {
    '1': {
      text: `📦 *Product Catalog*\n\nOur top products:\n• Premium Service A - ₹2999\n• Standard Service B - ₹1499\n• Basic Service C - ₹999\n\nWant detailed specs? Reply *specs*\nReady to buy? Reply *buy*\nOr type *menu* to go back`,
      logChoice: 'Product Catalog Requested'
    },
    '2': {
      text: `💰 *Pricing & Plans*\n\n🌟 *Starter* - ₹999/month\n• Feature 1, 2, 3\n\n🚀 *Pro* - ₹2999/month\n• All Starter + Premium features\n\n🔥 *Enterprise* - Custom pricing\n• Full suite + support\n\nReady to start? Reply *buy*\nOr type *menu* to go back`,
      logChoice: 'Pricing Requested'
    },
    '3': {
      text: `📅 *Schedule Demo*\n\nGreat choice! To book your demo:\n\nShare your preferred:\n• Date (DD-MM-YYYY)\n• Time (HH:MM)\n• Your name\n\nExample: "25-09-2025 15:00 John"\n\nOr type *menu* to go back`,
      logChoice: 'Demo Requested'
    },
    '4': {
      text: `🎧 *Contact Support*\n\nOur team is here to help!\n\n📞 Call: +91-XXXXX-XXXXX\n📧 Email: support@yourcompany.com\n⏰ Hours: 9 AM - 6 PM (Mon-Sat)\n\nFor urgent issues, reply *urgent*\nOr type *menu* to go back`,
      logChoice: 'Support Requested'
    },
    '5': {
      text: `📄 *Download Brochure*\n\nHere's our company brochure with all details!\n\n[PDF would be attached here]\n\nNeed more info? Reply *call* for callback\nWant to buy? Reply *buy*\nOr type *menu* for more options`,
      logChoice: 'Brochure Downloaded'
    }
  };

  const response = responses[choice];
  if (response) {
    await client.sendMessage(from, response.text);
    
    // Save to sheets with user choice
    await saveToSheets({
      phone: from,
      choice: response.logChoice,
      message: `User selected option ${choice}`,
      status: 'Interested'
    });
    
    // Update user state
    db.data.users[from].step = `SENT_OPTION_${choice}`;
    db.data.users[from].lastChoice = choice;
    await db.write();
    
  } else {
    await client.sendMessage(from, `❌ Invalid choice. Please reply 1-5 or type *menu*`);
  }
}

// --------- Message Handler ----------
client.on('message', async msg => {
  const from = msg.from;
  const body = msg.body ? msg.body.trim().toLowerCase() : '';
  
  // Skip group messages and status updates
  if (msg.from.includes('@g.us') || msg.isStatus) return;
  
  console.log(`📩 Message from ${from.replace('@c.us', '')}: ${body}`);
  
  await db.read();
  db.data.users = db.data.users || {};
  
  // Initialize user
  if (!db.data.users[from]) {
    db.data.users[from] = { step: null, joinedAt: Date.now() };
  }
  
  const user = db.data.users[from];
  
  // Trigger words for main menu
  const menuTriggers = ['hi', 'hello', 'start', 'menu', 'help', 'options'];
  if (menuTriggers.includes(body)) {
    return await sendMainMenu(from);
  }
  
  // Handle menu choices (1-5)
  if (user.step === 'MENU_SENT' && ['1','2','3','4','5'].includes(body)) {
    return await handleMenuChoice(body, from);
  }
  
  // Handle follow-up keywords
  if (body === 'buy' || body === 'purchase') {
    await client.sendMessage(from, `💳 *Ready to Purchase?*\n\nWhatsApp us your requirements:\n+91-XXXXX-XXXXX\n\nOr visit: www.yourwebsite.com\n\nAfter order, we'll send payment link!`);
    await saveToSheets({
      phone: from,
      choice: 'Purchase Intent',
      message: 'User wants to buy',
      status: '🔥 HOT LEAD'
    });
    return;
  }
  
  if (body === 'urgent' || body === 'emergency') {
    await client.sendMessage(from, `🚨 *Urgent Support*\n\nConnecting you to our priority team...\nYou'll receive a call within 15 minutes.\n\nCallback number: ${from.replace('@c.us', '')}`);
    await saveToSheets({
      phone: from,
      choice: 'Urgent Support',
      message: 'User needs immediate help',
      status: '⚡ PRIORITY'
    });
    return;
  }
  
  if (body.includes('call') || body.includes('callback')) {
    await client.sendMessage(from, `📞 *Callback Requested*\n\nWe'll call you within 2 hours!\nPhone: ${from.replace('@c.us', '')}\n\nFor faster response, WhatsApp us directly.`);
    await saveToSheets({
      phone: from,
      choice: 'Callback Requested',
      message: 'User wants a callback',
      status: '📞 CALL BACK'
    });
    return;
  }
  
  // Collect user details if they provide name/info
  if (body.includes('my name is') || body.includes('i am')) {
    const nameMatch = body.match(/(?:name is|i am) ([a-zA-Z\s]+)/);
    if (nameMatch) {
      const userName = nameMatch[1].trim();
      db.data.users[from].name = userName;
      await db.write();
      
      await client.sendMessage(from, `Nice to meet you, *${userName}*! 👋\n\nHow can I help you today? Type *menu* for options.`);
      await saveToSheets({
        phone: from,
        name: userName,
        choice: 'Name Provided',
        message: `User introduced as ${userName}`,
        status: '✅ QUALIFIED LEAD'
      });
      return;
    }
  }
  
  // Handle demo booking format
  if (body.includes('-') && body.includes(':')) {
    const demoMatch = body.match(/(\d{1,2}-\d{1,2}-\d{4})\s+(\d{1,2}:\d{2})\s*(.+)?/);
    if (demoMatch) {
      const [, date, time, name] = demoMatch;
      await client.sendMessage(from, `✅ *Demo Scheduled!*\n\n📅 Date: ${date}\n⏰ Time: ${time}\n👤 Name: ${name || 'Not provided'}\n\nWe'll call you 10 mins before the demo.\nCalendar invite will be sent shortly!`);
      await saveToSheets({
        phone: from,
        name: name || 'Unknown',
        choice: 'Demo Scheduled',
        message: `Demo: ${date} at ${time}`,
        status: '📅 DEMO BOOKED'
      });
      return;
    }
  }
  
  // Default: show menu for new users
  if (!user.step || user.step === null) {
    await sendMainMenu(from);
    return;
  }
  
  // Fallback response
  await client.sendMessage(from, `🤔 I didn't quite understand that.\n\nType *menu* to see options\nType *support* for help\nOr just tell me what you need!`);
  
  // Log unknown messages
  await saveToSheets({
    phone: from,
    choice: 'Unknown Input',
    message: body,
    status: '❓ NEEDS HELP'
  });
});

// Handle disconnection
client.on('disconnected', (reason) => {
  console.log('❌ Client was logged out:', reason);
});

// Start the bot
console.log('🔄 Starting WhatsApp Bot...');
client.initialize();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down bot...');
  await client.destroy();
  process.exit(0);
});
