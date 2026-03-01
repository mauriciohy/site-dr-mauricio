const nodemailer = require('nodemailer');

// Rate limiting simples em memória (por IP, máximo 10 por minuto)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minuto
const RATE_LIMIT_MAX = 10;

function isRateLimited(ip) {
    const now = Date.now();
    const entry = rateLimit.get(ip);
    if (!entry) {
        rateLimit.set(ip, { count: 1, start: now });
        return false;
    }
    if (now - entry.start > RATE_LIMIT_WINDOW) {
        rateLimit.set(ip, { count: 1, start: now });
        return false;
    }
    entry.count++;
    return entry.count > RATE_LIMIT_MAX;
}

// Identificar fonte de tráfego
function identifyTrafficSource(data) {
    if (data.gclid) return 'Google Ads';
    if (data.utm_source) {
        const src = data.utm_source.toLowerCase();
        if (src.includes('google')) return data.utm_medium === 'cpc' ? 'Google Ads' : 'Google Orgânico';
        if (src.includes('facebook') || src.includes('fb')) return 'Facebook';
        if (src.includes('instagram') || src.includes('ig')) return 'Instagram';
        return data.utm_source;
    }
    const ref = (data.referrer || '').toLowerCase();
    if (!ref || ref === 'acesso direto') return 'Acesso Direto';
    if (ref.includes('google')) return 'Google Orgânico';
    if (ref.includes('facebook')) return 'Facebook';
    if (ref.includes('instagram')) return 'Instagram';
    return 'Referral';
}

// Buscar geolocalização por IP
async function getGeoData(ip) {
    try {
        // Ignorar IPs locais/privados
        if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
            return { city: '-', region: '-', country: '-', isp: '-' };
        }
        const res = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country,isp,status&lang=pt-BR`);
        const geo = await res.json();
        if (geo.status === 'success') {
            return { city: geo.city, region: geo.regionName, country: geo.country, isp: geo.isp };
        }
    } catch (e) {}
    return { city: '-', region: '-', country: '-', isp: '-' };
}

// Formatar data em horário de Brasília
function formatDateBR() {
    return new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

// Montar e-mail HTML
function buildEmailHTML(data, geo, ip) {
    const trafficSource = identifyTrafficSource(data);
    const dataBR = formatDateBR();

    return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">

    <!-- Header -->
    <div style="background:#25d366;color:white;padding:20px 24px;">
        <h1 style="margin:0;font-size:20px;">🟢 Novo Lead WhatsApp</h1>
        <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">${data.landing_page || 'Landing Page'}</p>
    </div>

    <div style="padding:24px;">

        <!-- Data e Página -->
        <div style="background:#f0fdf4;border-left:4px solid #25d366;padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:20px;">
            <div style="font-size:14px;color:#333;">
                📅 <strong>${dataBR}</strong> (Brasília)<br>
                📄 <strong>Página:</strong> ${data.page_url || '-'}<br>
                🔘 <strong>Botão:</strong> ${data.button_label || '-'}
            </div>
        </div>

        <!-- Dispositivo -->
        <h3 style="color:#1e3a8a;font-size:13px;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:20px 0 12px;">📱 Dispositivo</h3>
        <table style="width:100%;font-size:14px;color:#333;border-collapse:collapse;">
            <tr><td style="padding:4px 0;width:120px;color:#666;">Tipo</td><td style="padding:4px 0;"><strong>${data.device_type || '-'}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Sistema</td><td style="padding:4px 0;"><strong>${data.os || '-'}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Navegador</td><td style="padding:4px 0;"><strong>${data.browser || '-'}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Tela</td><td style="padding:4px 0;"><strong>${data.screen || '-'}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Viewport</td><td style="padding:4px 0;"><strong>${data.viewport || '-'}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Idioma</td><td style="padding:4px 0;"><strong>${data.language || '-'}</strong></td></tr>
        </table>

        <!-- Localização -->
        <h3 style="color:#1e3a8a;font-size:13px;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:20px 0 12px;">📍 Localização</h3>
        <table style="width:100%;font-size:14px;color:#333;border-collapse:collapse;">
            <tr><td style="padding:4px 0;width:120px;color:#666;">Cidade</td><td style="padding:4px 0;"><strong>${geo.city}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Estado</td><td style="padding:4px 0;"><strong>${geo.region}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">País</td><td style="padding:4px 0;"><strong>${geo.country}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">ISP</td><td style="padding:4px 0;"><strong>${geo.isp}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">IP</td><td style="padding:4px 0;"><strong>${ip}</strong></td></tr>
        </table>

        <!-- Origem do Tráfego -->
        <h3 style="color:#1e3a8a;font-size:13px;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:20px 0 12px;">🔎 Origem do Tráfego</h3>
        <table style="width:100%;font-size:14px;color:#333;border-collapse:collapse;">
            <tr><td style="padding:4px 0;width:120px;color:#666;">Fonte</td><td style="padding:4px 0;"><strong style="color:#1e3a8a;">${trafficSource}</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Referrer</td><td style="padding:4px 0;"><strong>${data.referrer || 'Acesso direto'}</strong></td></tr>
            ${data.gclid ? `<tr><td style="padding:4px 0;color:#666;">GCLID</td><td style="padding:4px 0;"><strong>${data.gclid}</strong></td></tr>` : ''}
        </table>

        <!-- UTMs -->
        ${(data.utm_source || data.utm_medium || data.utm_campaign || data.utm_term || data.utm_content) ? `
        <h3 style="color:#1e3a8a;font-size:13px;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:20px 0 12px;">🎯 Parâmetros UTM</h3>
        <div style="background:#f8fafc;padding:12px 16px;border-radius:8px;font-size:13px;font-family:monospace;color:#334155;">
            ${data.utm_source ? `utm_source: <strong>${data.utm_source}</strong><br>` : ''}
            ${data.utm_medium ? `utm_medium: <strong>${data.utm_medium}</strong><br>` : ''}
            ${data.utm_campaign ? `utm_campaign: <strong>${data.utm_campaign}</strong><br>` : ''}
            ${data.utm_term ? `utm_term: <strong>${data.utm_term}</strong><br>` : ''}
            ${data.utm_content ? `utm_content: <strong>${data.utm_content}</strong>` : ''}
        </div>
        ` : ''}

        <!-- Comportamento -->
        <h3 style="color:#1e3a8a;font-size:13px;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:20px 0 12px;">📊 Comportamento</h3>
        <table style="width:100%;font-size:14px;color:#333;border-collapse:collapse;">
            <tr><td style="padding:4px 0;width:120px;color:#666;">Tempo na página</td><td style="padding:4px 0;"><strong>${data.time_on_page || 0} segundos</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Scroll</td><td style="padding:4px 0;"><strong>${data.scroll_pct || 0}%</strong></td></tr>
            <tr><td style="padding:4px 0;color:#666;">Visita</td><td style="padding:4px 0;"><strong>${data.first_visit ? 'Primeira visita' : 'Retorno'}</strong></td></tr>
        </table>

    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center;">
        Notificação automática — ${data.landing_page || 'Landing Page'}
    </div>

</div>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Obter IP
    const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '').split(',')[0].trim();

    // Rate limiting
    if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

    try {
        // Parse body
        let data;
        if (typeof req.body === 'string') {
            data = JSON.parse(req.body);
        } else {
            data = req.body;
        }

        // Geolocalização
        const geo = await getGeoData(ip);

        // Montar e-mail
        const html = buildEmailHTML(data, geo, ip);
        const subject = `🟢 Novo Lead WhatsApp - ${data.landing_page || 'Landing Page'}`;

        // Enviar e-mail via Gmail SMTP
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD
            }
        });

        await transporter.sendMail({
            from: `"WhatsApp Tracker" <${process.env.GMAIL_USER}>`,
            to: 'msvasculares@gmail.com',
            cc: 'mauriciohy@gmail.com',
            subject: subject,
            html: html
        });

        return res.status(200).json({ ok: true });

    } catch (err) {
        console.error('WhatsApp notify error:', err);
        return res.status(500).json({ error: 'Internal error' });
    }
};
